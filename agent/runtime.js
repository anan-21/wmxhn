// Vercel AI SDK runs the tool loop; domain tools and student state stay in our app.
const Ajv = require('ajv');
const { TOOLS, executeTool } = require('../engine/tools');
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map(TOOLS.map(({ function: fn }) => [fn.name, ajv.compile(fn.parameters)]));

const TOOL_LABELS = {
  search_uploaded_documents: '检索上传文档',
  read_uploaded_document: '阅读上传文档',
  update_student_profile: '更新学生画像',
  generate_recommendation: '生成志愿方案',
  search_admission: '查询录取数据库',
  search_knowledge: '检索专业知识库',
  web_search: '搜索最新公开信息',
};

function summarize(name, result) {
  if (result?.error) return result.error;
  if (name === 'update_student_profile') return `已更新 ${result.changed?.length || 0} 项信息`;
  if (name === 'generate_recommendation') return result.summary || '方案已生成';
  if (name === 'search_admission') return `找到 ${result.total || 0} 条匹配记录`;
  return `找到 ${result.results?.length || 0} 条结果`;
}

async function createModel(provider, apiKey, fetchImpl) {
  const key = apiKey || process.env[provider.envKey];
  if (!key) return null;
  const modelId = process.env[provider.envModel || (provider.type === 'anthropic' ? 'CLAUDE_MODEL' : '')]
    || provider.defaultModel;
  if (!modelId) throw new Error('请配置模型名称');
  // Environment overrides take precedence over the built-in provider URL.
  const baseURL = process.env[provider.envBaseURL] || provider.baseURL;
  if (provider.type === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ apiKey: key, ...(baseURL ? { baseURL } : {}), fetch: fetchImpl })(modelId);
  }
  if (!baseURL) throw new Error('请配置模型 API 地址');
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  let normalized = baseURL.replace(/\/+$/, '');
  // Existing provider settings use API roots; the SDK expects the versioned root.
  if (['https://api.openai.com', 'https://api.deepseek.com'].includes(normalized)) normalized += '/v1';
  return createOpenAICompatible({
    name: provider.id,
    apiKey: key,
    baseURL: normalized,
    fetch: fetchImpl,
  }).chatModel(modelId);
}

async function runAgent({ provider, apiKey, instructions, messages, maxTokens = 4096, context = {}, fetchImpl }) {
  if (!provider) return { text: null, toolCalls: [] };
  const model = await createModel(provider, apiKey, fetchImpl);
  if (!model) return { text: null, toolCalls: [] };
  const { ToolLoopAgent, tool, jsonSchema, isStepCount } = await import('ai');
  const trace = [];
  const tools = Object.fromEntries(TOOLS.map(({ function: fn }) => [fn.name, tool({
    description: fn.description,
    inputSchema: jsonSchema(fn.parameters, {
      validate: value => {
        const validate = validators.get(fn.name);
        return validate(value)
          ? { success: true, value }
          : { success: false, error: new Error(ajv.errorsText(validate.errors)) };
      },
    }),
    execute: async (args, { toolCallId }) => {
      const startedAt = Date.now();
      let result;
      try {
        result = await executeTool(fn.name, args, context);
      } catch (error) {
        result = { error: error.message };
      }
      trace.push({
        id: toolCallId, name: fn.name, label: TOOL_LABELS[fn.name], args,
        status: result?.error ? 'error' : 'success',
        summary: summarize(fn.name, result), durationMs: Date.now() - startedAt,
      });
      return result;
    },
  })]));
  const agent = new ToolLoopAgent({
    id: 'gaokao-planner', model, instructions, tools,
    toolCallConcurrency: 1, // Profile writes must finish before recommendation reads.
    maxOutputTokens: maxTokens,
    maxRetries: 1,
    timeout: { totalMs: 120000, stepMs: 45000 },
    stopWhen: isStepCount(7),
    // Six tool rounds, then one mandatory synthesis step without further tools.
    prepareStep: ({ stepNumber }) => stepNumber >= 6 ? { toolChoice: 'none' } : {},
    onStepFinish: ({ toolCalls = [], toolResults = [] }) => {
      for (const call of toolCalls) {
        if (trace.some(item => item.id === call.toolCallId)) continue;
        const result = toolResults.find(item => item.toolCallId === call.toolCallId);
        trace.push({
          id: call.toolCallId, name: call.toolName,
          label: TOOL_LABELS[call.toolName] || call.toolName,
          args: call.input || {}, status: 'error', durationMs: 0,
          summary: String(call.error?.message || result?.error?.message || '工具参数无效，未执行'),
        });
      }
    },
  });
  try {
    const result = await agent.generate({
      messages: messages.map(({ role, content }) => ({ role, content })),
    });
    return { text: result.text, toolCalls: trace };
  } catch (error) {
    // Preserve the existing HTTP route's authentication/rate-limit error mapping.
    if (error.statusCode) error.status = error.statusCode;
    throw error;
  }
}

module.exports = { runAgent, TOOL_LABELS, createModel };
