const test = require('node:test');
const assert = require('node:assert/strict');
const { runAgent } = require('../agent/runtime');

const provider = {
  id: 'test-provider', type: 'openai-compatible',
  baseURL: 'https://model.example/v1', defaultModel: 'user-model',
  envKey: 'GAOKAO_TEST_NO_KEY', envModel: 'GAOKAO_TEST_MODEL', envBaseURL: 'GAOKAO_TEST_BASE_URL',
};

function reply(content, calls) {
  return new Response(JSON.stringify({
    id: 'mock-completion', object: 'chat.completion', created: 1, model: 'user-model',
    choices: [{ index: 0, message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) },
      finish_reason: calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }), { headers: { 'Content-Type': 'application/json' } });
}

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

test('SDK uses the user model and key, executes tools, then synthesizes a response', async () => {
  const requests = [];
  const session = { studentProfile: {}, phase: 'gathering' };
  const result = await runAgent({
    provider, apiKey: 'test-key', instructions: '测试规划师', context: { session },
    messages: [{ role: 'user', content: '广东600分物理类' }],
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      requests.push(payload);
      assert.equal(String(url), 'https://model.example/v1/chat/completions');
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer test-key');
      if (requests.length === 1) return reply(null, [toolCall('profile', 'update_student_profile', {
        province: '广东', score: 600, subject: 'science',
      })]);
      assert.equal(session.studentProfile.score, 600);
      assert.ok(payload.messages.some(message => message.role === 'tool'));
      return reply('还需要了解家庭预算。');
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, 'user-model');
  assert.equal(result.text, '还需要了解家庭预算。');
  assert.equal(result.toolCalls[0].status, 'success');
  assert.equal(result.toolCalls[0].name, 'update_student_profile');
});

test('invalid tool inputs do not mutate the profile and can be corrected next step', async () => {
  const session = { studentProfile: {} };
  let count = 0;
  const result = await runAgent({
    provider, apiKey: 'test-key', context: { session }, messages: [{ role: 'user', content: '测试' }],
    fetchImpl: async () => ++count === 1
      ? reply(null, [toolCall('invalid', 'update_student_profile', { score: '不是数字' })])
      : reply('请提供正确的分数。'),
  });
  assert.deepEqual(session.studentProfile, {});
  assert.equal(result.toolCalls[0].status, 'error');
  assert.equal(result.text, '请提供正确的分数。');
});

test('loop forces a final synthesis after six tool rounds', async () => {
  let count = 0;
  const result = await runAgent({
    provider, apiKey: 'test-key', context: { session: { studentProfile: {} } },
    messages: [{ role: 'user', content: '测试循环' }],
    fetchImpl: async (_, options) => {
      const payload = JSON.parse(options.body);
      count++;
      if (count === 7) {
        assert.equal(payload.tool_choice, 'none');
        return reply('本轮已完成。');
      }
      return reply(null, [toolCall(`profile-${count}`, 'update_student_profile', { score: 600 })]);
    },
  });
  assert.equal(count, 7);
  assert.equal(result.toolCalls.length, 6);
  assert.equal(result.text, '本轮已完成。');
});

test('missing key preserves offline mode without making a request', async () => {
  assert.deepEqual(await runAgent({ provider, messages: [], fetchImpl: () => { throw new Error('unexpected request'); } }),
    { text: null, toolCalls: [] });
});

test('authentication status is preserved for the existing error-avatar flow', async () => {
  await assert.rejects(runAgent({
    provider, apiKey: 'test-key', messages: [{ role: 'user', content: '你好' }],
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    }),
  }), error => error.status === 401);
});

test('Claude adapter handles native tool use and tool results', async () => {
  const session = { studentProfile: {} };
  let count = 0;
  const result = await runAgent({
    provider: { ...provider, id: 'claude-test', type: 'anthropic', defaultModel: 'claude-test-model' },
    apiKey: 'test-key', context: { session }, messages: [{ role: 'user', content: '600分' }],
    fetchImpl: async (_, options) => {
      count++;
      const payload = JSON.parse(options.body);
      if (count === 2) {
        assert.equal(session.studentProfile.score, 600);
        assert.ok(payload.messages.some(message => Array.isArray(message.content)
          && message.content.some(part => part.type === 'tool_result')));
      }
      return new Response(JSON.stringify({
        id: `msg-${count}`, type: 'message', role: 'assistant', model: 'claude-test-model',
        content: count === 1
          ? [{ type: 'tool_use', id: 'profile-claude', name: 'update_student_profile', input: { score: 600 } }]
          : [{ type: 'text', text: '请补充省份。' }],
        stop_reason: count === 1 ? 'tool_use' : 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(result.text, '请补充省份。');
  assert.equal(result.toolCalls[0].status, 'success');
});

test('same-step tools execute sequentially and domain errors return to the model', async () => {
  let count = 0;
  const session = { studentProfile: {} };
  const result = await runAgent({
    provider, apiKey: 'test-key', context: { session }, messages: [{ role: 'user', content: '广东600分' }],
    fetchImpl: async (_, options) => {
      if (++count === 1) return reply(null, [
        toolCall('write', 'update_student_profile', { province: '广东', score: 600 }),
        toolCall('plan', 'generate_recommendation', {}),
      ]);
      const payload = JSON.parse(options.body);
      const planResult = payload.messages.find(message => message.role === 'tool' && message.tool_call_id === 'plan');
      assert.ok(planResult.content.includes('画像核心信息还不完整'));
      return reply('请补充科类和家庭条件。');
    },
  });
  assert.deepEqual(result.toolCalls.map(item => item.id), ['write', 'plan']);
  assert.equal(result.toolCalls[1].status, 'error');
  assert.equal(session.studentProfile.score, 600);
  assert.equal(result.text, '请补充科类和家庭条件。');
});
