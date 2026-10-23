// Real app and SDK, fake upstream only. Never read local credentials or call a real model.
const http = require('node:http');
require('dotenv').config = () => ({ parsed: {} });
for (const key of ['ANTHROPIC', 'DEEPSEEK', 'OPENAI', 'MOONSHOT', 'ZHIPU', 'QWEN', 'DOUBAO', 'CUSTOM']) {
  delete process.env[`${key}_API_KEY`];
}

const upstream = http.createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const payload = JSON.parse(raw);
  const last = payload.messages.at(-1);
  let message;
  if (last.role === 'tool') {
    const result = JSON.parse(last.content);
    const source = result.results?.[0];
    message = { role: 'assistant', content: source
      ? `文件说明：${source.text}\n【${source.name} · ${source.location}】`
      : '当前文件没有找到相关片段。' };
  } else if (payload.messages.some(item => item.content?.includes?.('untrusted_uploaded_documents'))) {
    const dataMessage = payload.messages.findLast(item => item.content?.includes?.('untrusted_uploaded_documents'));
    const doc = JSON.parse(dataMessage.content.slice(dataMessage.content.indexOf('{'))).manifest[0];
    message = { role: 'assistant', content: null, tool_calls: [{ id: 'read-browser-doc', type: 'function',
      function: { name: 'read_uploaded_document', arguments: JSON.stringify({ documentId: doc.id, limit: 2 }) } }] };
  } else message = { role: 'assistant', content: '当前咨询没有可用附件。可以继续提供学生情况。' };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'browser-test', object: 'chat.completion', created: 1, model: 'mock-model',
    choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
});
upstream.listen(0, '127.0.0.1', () => {
  process.env.CUSTOM_API_KEY = 'browser-test-placeholder';
  process.env.CUSTOM_BASE_URL = `http://127.0.0.1:${upstream.address().port}/v1`;
  process.env.CUSTOM_MODEL = 'mock-model';
  require('../../server').listen(3197, '127.0.0.1');
});
