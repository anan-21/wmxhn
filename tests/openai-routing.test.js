const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const PLACEHOLDER_KEY = 'sk-proj-OFFLINE_TEST_NOT_A_REAL_KEY';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const student = { score: 600, province: '广东', subject: 'science', family_income: 'medium' };

function completion(content = '离线模拟回答') {
  return new Response(JSON.stringify({
    id: 'offline-openai-completion', object: 'chat.completion', created: 1, model: 'gpt-4o',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { headers: { 'content-type': 'application/json' } });
}

function providerFailure(status, code, message) {
  return new Response(JSON.stringify({ error: { code, type: code, message } }), {
    status, headers: { 'content-type': 'application/json', 'retry-after': '0' },
  });
}

test('OpenAI HTTP routing and safe provider errors use only offline mock credentials', { timeout: 120000 }, async t => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const dotenv = require('dotenv');
  const originalDotenvConfig = dotenv.config;
  // Do not read .env or inherited credential values. Restore the original object at teardown.
  process.env = { NODE_ENV: 'test' };
  dotenv.config = () => ({ parsed: {} });
  let server;
  t.after(async () => {
    global.fetch = originalFetch;
    dotenv.config = originalDotenvConfig;
    process.env = originalEnv;
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });

  const requests = [];
  let upstream = () => completion();
  // Every supplier request is intercepted here. Native fetch is used only by post() below
  // for this test's own loopback HTTP server; no supplier network request is possible.
  global.fetch = async (input, options = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const payload = JSON.parse(options.body);
    requests.push({ url, payload });
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${PLACEHOLDER_KEY}`);
    return upstream(url, payload);
  };
  const app = require('../server');
  dotenv.config = originalDotenvConfig;
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let sessionNumber = 0;
  const routes = [
    { name: 'ordinary V3 conversation', path: '/api/chat', extra: {} },
    { name: 'V2 quick profile', path: '/api/chat', extra: { student } },
    { name: 'legacy follow-up', path: '/api/chat/followup', extra: {} },
  ];
  const post = async (route, extra = {}) => {
    const response = await originalFetch(`${base}${route.path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: `openai_offline_session_${++sessionNumber}`, providerId: 'openai',
        apiKey: PLACEHOLDER_KEY, message: '请介绍高考志愿咨询流程', ...route.extra, ...extra,
      }),
    });
    return { status: response.status, body: await response.json() };
  };

  for (const route of routes) {
    await t.test(`${route.name} sends the versioned OpenAI URL`, async () => {
      requests.length = 0;
      upstream = () => completion();
      const result = await post(route);
      assert.equal(result.status, 200);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, OPENAI_CHAT_URL);
      assert.equal(requests[0].payload.model, 'gpt-4o');
      assert.match(result.body.data.message, /离线模拟回答/);
    });
  }

  await t.test('sk-proj key detection selects OpenAI without an explicit providerId', async () => {
    requests.length = 0;
    upstream = () => completion();
    const result = await post(routes[0], { providerId: undefined });
    assert.equal(result.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, OPENAI_CHAT_URL);
    assert.equal(requests[0].payload.model, 'gpt-4o');
  });

  await t.test('V3 automatic profile analysis uses the same versioned OpenAI URL', async () => {
    requests.length = 0;
    upstream = () => completion(requests.length === 1
      ? `已了解你的情况。<!--PROFILE\n${JSON.stringify(student)}\n-->`
      : '离线模拟追加分析');
    const result = await post(routes[0]);
    assert.equal(result.status, 200);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(item => item.url), [OPENAI_CHAT_URL, OPENAI_CHAT_URL]);
    assert.match(result.body.data.message, /离线模拟追加分析/);
  });

  for (const route of routes) {
    await t.test(`${route.name} honors OPENAI_BASE_URL before the built-in URL`, async () => {
      requests.length = 0;
      upstream = () => completion();
      process.env.OPENAI_BASE_URL = 'https://offline-proxy.example.test/compatible/v1/';
      try {
        const result = await post(route);
        assert.equal(result.status, 200);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, 'https://offline-proxy.example.test/compatible/v1/chat/completions');
      } finally {
        delete process.env.OPENAI_BASE_URL;
      }
    });
  }

  const errorCases = [
    { name: '401 authentication', expected: /API Key/, make: () => providerFailure(401, 'invalid_api_key', `Invalid ${PLACEHOLDER_KEY}`) },
    { name: '429 exhausted quota', expected: /额度/, make: () => providerFailure(429, 'insufficient_quota', `Quota exhausted ${PLACEHOLDER_KEY}`) },
    { name: '429 rate limit', expected: /频繁|限流|稍后/, make: () => providerFailure(429, 'rate_limit_exceeded', `Rate exceeded ${PLACEHOLDER_KEY}`) },
    { name: '404 unavailable model', expected: /模型/, make: () => providerFailure(404, 'model_not_found', `Unknown model ${PLACEHOLDER_KEY}`) },
    { name: 'network failure in nested cause', expected: /连接|网络/, make: () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(`DNS failure ${PLACEHOLDER_KEY}`), { code: 'ENOTFOUND' }) });
    } },
    { name: 'network failure in nested lastError', expected: /连接|网络/, make: () => {
      const error = new Error(`Retry wrapper ${PLACEHOLDER_KEY}`);
      error.lastError = { cause: { code: 'ECONNREFUSED', message: `Connection refused ${PLACEHOLDER_KEY}` } };
      throw error;
    } },
  ];
  for (const route of routes) {
    for (const scenario of errorCases) {
      await t.test(`${route.name}: ${scenario.name} returns a safe, useful Chinese error`, async () => {
        upstream = scenario.make;
        const result = await post(route);
        assert.equal(result.status, 500);
        assert.equal(result.body.error, 'AI 调用失败');
        assert.match(result.body.detail, scenario.expected);
        assert.ok(!JSON.stringify(result.body).includes(PLACEHOLDER_KEY), 'provider messages must not expose the supplied key');
      });
    }
  }
});
