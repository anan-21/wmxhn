// server.js
// V3: 高考志愿决策系统 · 启发式AI规划师
// 支持 Claude / OpenAI / DeepSeek / 月之暗面 / 智谱 / 通义千问 / 豆包 等

require('dotenv').config();
const express = require('express');
const path = require('path');
const runEngine = require('./engine/engine');
const { querySchools, queryAllMajors, rankQuery, rankQueryAllMajors } = require('./engine/admissionQuery');
const { recommend } = require('./engine/recommender');
const {
  buildSystemPrompt,
  buildUserPrompt,
  buildFallbackResponse
} = require('./prompt/system-prompt');
const {
  isProfileReady,
  isProfileHalfReady,
  getCompleteness,
  mergeProfile,
  mapToEngineInput
} = require('./engine/profileValidator');
const { getKnowledgeContext } = require('./knowledge/loader');
const { getUserData, loadUserData, queryUserData, hasUserDataForProvince } = require('./engine/userDataLoader');
const { webSearch } = require('./engine/webSearch');
const { TOOLS, toClaudeTools, executeTool } = require('./engine/tools');
const { warmup: warmupRAG } = require('./engine/rag/index');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== AI Provider 注册表 ==========

const PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    type: 'anthropic',
    keyPrefix: 'sk-ant-',
    defaultModel: 'claude-sonnet-4-6',
    envKey: 'ANTHROPIC_API_KEY',
    envBaseURL: 'ANTHROPIC_BASE_URL',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai-compatible',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    keyPrefix: 'sk-',
    envKey: 'DEEPSEEK_API_KEY',
    envModel: 'DEEPSEEK_MODEL',
    envBaseURL: 'DEEPSEEK_BASE_URL',
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    type: 'openai-compatible',
    baseURL: 'https://api.openai.com',
    defaultModel: 'gpt-4o',
    keyPrefix: 'sk-proj-',
    envKey: 'OPENAI_API_KEY',
    envModel: 'OPENAI_MODEL',
    envBaseURL: 'OPENAI_BASE_URL',
  },
  {
    id: 'moonshot',
    name: '月之暗面 (Kimi)',
    type: 'openai-compatible',
    baseURL: 'https://api.moonshot.cn',
    defaultModel: 'moonshot-v1-8k',
    keyPrefix: 'sk-',
    envKey: 'MOONSHOT_API_KEY',
    envModel: 'MOONSHOT_MODEL',
    envBaseURL: 'MOONSHOT_BASE_URL',
  },
  {
    id: 'zhipu',
    name: '智谱 (GLM)',
    type: 'openai-compatible',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    keyPrefix: '',
    envKey: 'ZHIPU_API_KEY',
    envModel: 'ZHIPU_MODEL',
    envBaseURL: 'ZHIPU_BASE_URL',
  },
  {
    id: 'qwen',
    name: '通义千问 (阿里云)',
    type: 'openai-compatible',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    keyPrefix: 'sk-',
    envKey: 'QWEN_API_KEY',
    envModel: 'QWEN_MODEL',
    envBaseURL: 'QWEN_BASE_URL',
  },
  {
    id: 'doubao',
    name: '豆包 (字节跳动)',
    type: 'openai-compatible',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-pro-32k',
    keyPrefix: '',
    envKey: 'DOUBAO_API_KEY',
    envModel: 'DOUBAO_MODEL',
    envBaseURL: 'DOUBAO_BASE_URL',
  },
  {
    id: 'custom',
    name: '自定义 (OpenAI 兼容)',
    type: 'openai-compatible',
    baseURL: '',
    defaultModel: '',
    keyPrefix: '',
    envKey: 'CUSTOM_API_KEY',
    envModel: 'CUSTOM_MODEL',
    envBaseURL: 'CUSTOM_BASE_URL',
  },
];

// ========== AI Provider 解析 ==========

function getProviderById(id) {
  return PROVIDERS.find(p => p.id === id) || null;
}

function getProviderByKey(apiKey) {
  if (!apiKey) return null;
  if (apiKey.startsWith('sk-ant-')) return getProviderById('claude');
  for (const p of PROVIDERS) {
    if (p.keyPrefix && p.keyPrefix.length > 0 && apiKey.startsWith(p.keyPrefix) && p.id !== 'claude') {
      return p;
    }
  }
  return null;
}

function getDefaultProvider() {
  for (const p of PROVIDERS) {
    if (p.envKey && process.env[p.envKey]) return p;
  }
  return null;
}

function resolveProvider(providerId, apiKey) {
  if (providerId) return getProviderById(providerId);
  if (apiKey) return getProviderByKey(apiKey);
  return getDefaultProvider();
}

function hasProviderCredentials(provider, apiKey) {
  return !!(provider && (apiKey || (provider.envKey && process.env[provider.envKey])));
}

// ========== OpenAI-Compatible API ==========

async function callOpenAICompatible(provider, apiKey, systemPrompt, messages, maxTokens = 4096) {
  const baseURL = (provider.baseURL || process.env[provider.envBaseURL] || '').replace(/\/+$/, '');
  const model = process.env[provider.envModel] || provider.defaultModel;
  const realKey = apiKey || (provider.envKey ? process.env[provider.envKey] : '');

  if (!baseURL) {
    throw new Error(`Provider ${provider.name}: 未配置 baseURL`);
  }
  if (!realKey) {
    throw new Error(`Provider ${provider.name}: 未提供 API Key`);
  }

  const url = `${baseURL}/chat/completions`;

  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    max_tokens: maxTokens,
    temperature: 0.7
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${realKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err.error?.message || `${provider.name} API ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ========== Claude API (Anthropic SDK) ==========

let Anthropic = null;
try {
  Anthropic = require('@anthropic-ai/sdk');
} catch (e) {}

async function callClaudeWithProvider(provider, apiKey, systemPrompt, messages, maxTokens = 4096) {
  if (!Anthropic) {
    throw new Error('未安装 @anthropic-ai/sdk，无法调用 Claude。请运行 npm install');
  }

  const realKey = apiKey || (provider.envKey ? process.env[provider.envKey] : '');
  if (!realKey) {
    throw new Error('未提供 Claude API Key');
  }

  const options = { apiKey: realKey };
  const baseURL = provider.baseURL || (provider.envBaseURL ? process.env[provider.envBaseURL] : '');
  if (baseURL) {
    options.baseURL = baseURL;
  }

  const client = new Anthropic(options);
  const model = process.env.CLAUDE_MODEL || provider.defaultModel;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.7,
    system: systemPrompt,
    messages
  });

  return response.content[0].text;
}

// ========== 统一 AI 调用 ==========

async function callAI(providerId, apiKey, systemPrompt, messages, maxTokens = 4096) {
  const provider = resolveProvider(providerId, apiKey);

  if (!hasProviderCredentials(provider, apiKey)) {
    console.log('  ⚠️ 未检测到可用的 AI Provider');
    return null;
  }

  console.log(`  🤖 ${provider.name}`);

  if (provider.type === 'anthropic') {
    return await callClaudeWithProvider(provider, apiKey, systemPrompt, messages, maxTokens);
  }

  return await callOpenAICompatible(provider, apiKey, systemPrompt, messages, maxTokens);
}

// ========== Function Calling (V4) ==========

const TOOL_LABELS = {
  update_student_profile: '更新学生画像',
  generate_recommendation: '生成志愿方案',
  search_admission: '查询录取数据库',
  search_knowledge: '检索专业知识库',
  web_search: '搜索最新公开信息',
};

function summarizeToolResult(name, result) {
  if (result?.error) return result.error;
  if (name === 'update_student_profile') {
    return result.changed?.length ? `已更新 ${result.changed.length} 项信息` : '画像无变化';
  }
  if (name === 'generate_recommendation') return result.summary || '方案已生成';
  if (name === 'search_admission') return `找到 ${result.total || 0} 条匹配记录`;
  return `找到 ${result.results?.length || 0} 条结果`;
}

async function callAIWithTools(providerId, apiKey, systemPrompt, messages, maxTokens = 4096, context = {}) {
  const provider = resolveProvider(providerId, apiKey);
  if (!hasProviderCredentials(provider, apiKey)) return { text: null, toolCalls: [] };

  const MAX_ROUNDS = 6;
  let round = 0;
  const allToolCalls = [];

  while (round < MAX_ROUNDS) {
    round++;
    let text, toolCalls;

    if (provider.type === 'anthropic') {
      const result = await callClaudeWithTools(provider, apiKey, systemPrompt, messages, TOOLS, maxTokens);
      text = result.text;
      toolCalls = result.toolCalls;
    } else {
      const result = await callOpenAIWithTools(provider, apiKey, systemPrompt, messages, TOOLS, maxTokens);
      text = result.text;
      toolCalls = result.toolCalls;
    }

    // No tool calls → return text
    if (!toolCalls || toolCalls.length === 0) {
      return { text, toolCalls: allToolCalls };
    }

    // Execute tools
    console.log(`  🔧 LLM调用工具 (round ${round}/${MAX_ROUNDS}):`, toolCalls.map(t => t.name).join(', '));

    // Add assistant message with tool_calls
    if (provider.type === 'anthropic') {
      // Claude format
      const toolUseBlocks = toolCalls.map(tc => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.args,
      }));
      messages.push({
        role: 'assistant',
        content: [...(text ? [{ type: 'text', text }] : []), ...toolUseBlocks],
      });
      // Execute and add tool results
      const toolResults = [];
      for (const tc of toolCalls) {
        const startedAt = Date.now();
        let result;
        try {
          result = await executeTool(tc.name, tc.args, context);
        } catch (error) {
          result = { error: error.message };
        }
        allToolCalls.push({
          id: tc.id,
          name: tc.name,
          label: TOOL_LABELS[tc.name] || tc.name,
          args: tc.args,
          status: result?.error ? 'error' : 'success',
          summary: summarizeToolResult(tc.name, result),
          durationMs: Date.now() - startedAt,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      // OpenAI format
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      });
      for (const tc of toolCalls) {
        const startedAt = Date.now();
        let result;
        try {
          result = await executeTool(tc.name, tc.args, context);
        } catch (error) {
          result = { error: error.message };
        }
        allToolCalls.push({
          id: tc.id,
          name: tc.name,
          label: TOOL_LABELS[tc.name] || tc.name,
          args: tc.args,
          status: result?.error ? 'error' : 'success',
          summary: summarizeToolResult(tc.name, result),
          durationMs: Date.now() - startedAt,
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
    }
  }

  // Final call after tool results
  const finalResult = await callAI(providerId, apiKey, systemPrompt, messages, maxTokens);
  return { text: finalResult, toolCalls: allToolCalls };
}

async function callOpenAIWithTools(provider, apiKey, systemPrompt, messages, tools, maxTokens = 4096) {
  const baseURL = (provider.baseURL || process.env[provider.envBaseURL] || '').replace(/\/+$/, '');
  const model = process.env[provider.envModel] || provider.defaultModel;
  const realKey = apiKey || (provider.envKey ? process.env[provider.envKey] : '');

  if (!baseURL) throw new Error(`Provider ${provider.name}: 未配置 baseURL`);
  if (!realKey) throw new Error(`Provider ${provider.name}: 未提供 API Key`);

  const payload = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: maxTokens,
    temperature: 0.7,
    tools,
    tool_choice: 'auto',
  };

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${realKey}` },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err.error?.message || `${provider.name} API ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const msg = data.choices[0].message;

  const toolCalls = [];
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      try {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        });
      } catch (e) {
        console.log('  ⚠️ tool_calls parse error:', e.message);
      }
    }
  }

  return { text: msg.content || '', toolCalls };
}

async function callClaudeWithTools(provider, apiKey, systemPrompt, messages, tools, maxTokens = 4096) {
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch (e) { throw new Error('未安装 @anthropic-ai/sdk'); }

  const realKey = apiKey || (provider.envKey ? process.env[provider.envKey] : '');
  const options = { apiKey: realKey };
  const baseURL = provider.baseURL || (provider.envBaseURL ? process.env[provider.envBaseURL] : '');
  if (baseURL) options.baseURL = baseURL;

  const client = new Anthropic(options);
  const model = process.env.CLAUDE_MODEL || provider.defaultModel;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.7,
    system: systemPrompt,
    messages,
    tools: toClaudeTools(tools),
  });

  const textBlocks = response.content.filter(b => b.type === 'text');
  const toolBlocks = response.content.filter(b => b.type === 'tool_use');

  const text = textBlocks.map(b => b.text).join('\n');
  const toolCalls = toolBlocks.map(b => ({
    id: b.id,
    name: b.name,
    args: b.input || {},
  }));

  return { text, toolCalls };
}

// ========== 会话管理 ==========

const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function createProfile() {
  return {
    score: null,
    province: null,
    rank: null,
    subject: null,
    family_income: null,
    interest: null,
    city_preference: null,
    postgraduate: null
  };
}

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      messages: [],
      studentProfile: createProfile(),
      phase: 'greeting',
      engineResult: null,
      createdAt: Date.now()
    });
  }
  const s = sessions.get(id);
  s.lastAccess = Date.now();
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > SESSION_TTL) sessions.delete(id);
  }
}, 10 * 60 * 1000);

// ========== AI 回复解析 ==========

function parseProfileFromResponse(text) {
  const match = text.match(/<!--PROFILE\s*\n([\s\S]*?)\n\s*-->/);
  if (!match) return { updates: {}, cleanText: text };

  let updates = {};
  try {
    updates = JSON.parse(match[1].trim());
  } catch (e) {
    console.log('[parse] PROFILE JSON 解析失败:', e.message);
  }

  const cleanText = text.replace(/<!--PROFILE[\s\S]*?-->/g, '').trim();
  return { updates, cleanText };
}

function parseSuggestions(text) {
  const lines = text.split('\n');
  const suggestions = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('→')) {
      const content = trimmed.slice(1).trim();
      if (content) {
        suggestions.push(content);
      }
    }
  }
  return suggestions;
}

function buildAgentRuntimePrompt(profile) {
  return `## Agent 运行规则

你不是被动问答机器人，而是能自主使用工具完成任务的志愿规划 Agent。

- 当前服务端画像：${JSON.stringify(profile)}
- 用户说出任何新的画像信息时，先调用 update_student_profile，再继续回答。
- 涉及专业适配、就业风险或省份政策时，主动调用 search_knowledge。
- 涉及学校、分数线、位次和冲稳保时，主动调用 search_admission；信息齐全且用户要方案时调用 generate_recommendation。
- 涉及 2026 年政策、最新动态或本地库没有的数据时，调用 web_search，并在正文保留可点击来源链接。
- 工具无结果时明确说明数据边界，不编造学校、分数、位次、政策和就业数字。
- 每轮可以连续调用多个工具，拿到结果后再综合作答。
- 不要输出 HTML 注释、PROFILE JSON、工具参数或内部思考过程。正文直接给用户结论、依据和下一步。`;
}

// ========== V3 引擎触发 ==========

function runEngineForProfile(profile) {
  try {
    const engineInput = mapToEngineInput(profile);
    const engineResult = runEngine(engineInput);
    const recommenderResult = recommend({
      score: profile.score || 0,
      rank: profile.rank || 0,
      province: profile.province || '',
      subject: profile.subject || 'science',
      family_income: profile.family_income || 'medium',
      interest: profile.interest || '',
      city_preference: profile.city_preference !== false,
      postgraduate: !!profile.postgraduate
    });

    return { engine: engineResult, recommender: recommenderResult };
  } catch (e) {
    console.error('[engine] 引擎运行失败:', e.message);
    return null;
  }
}

// ========== API: 主对话（V3 对话模式 + V2 快速模式兼容）==========

app.post('/api/chat', async (req, res) => {
  try {
    const { student, message, sessionId, apiKey, providerId } = req.body;

    // ---- V2 快速模式：收到完整 student 对象，走原有流程 ----
    if (student && student.score && student.province && student.subject) {
      return handleV2Chat(req, res);
    }

    // ---- V3 对话模式 ----
    return handleV3Chat(req, res);
  } catch (error) {
    console.error('[chat] 错误:', error.message);
    res.status(500).json({ error: '服务异常', detail: error.message });
  }
});

// V2 快速模式（完整 student 对象 → 立即分析）
async function handleV2Chat(req, res) {
  try {
    const { student, sessionId, apiKey, providerId } = req.body;
    const session = getSession(sessionId || 'default');

    // 用表单数据一次性填充画像
    session.studentProfile = {
      score: student.score,
      province: student.province,
      rank: student.rank || null,
      subject: student.subject,
      family_income: student.family_income,
      interest: student.interest || null,
      city_preference: student.city_preference !== false,
      postgraduate: !!student.postgraduate
    };
    session.phase = 'analyzing';

    const engineResult = runEngineForProfile(session.studentProfile);
    if (!engineResult) {
      return res.status(500).json({ error: '引擎分析失败' });
    }
    session.engineResult = engineResult;

    const systemPrompt = buildSystemPrompt('analyzing', session.studentProfile);
    const knowledgeContext = getKnowledgeContext(session.studentProfile, engineResult.engine);
    const userContent = buildUserPrompt(session.studentProfile, engineResult.engine, knowledgeContext);

    session.messages.push({ role: 'user', content: userContent });

    const result = await callAI(providerId || null, apiKey, systemPrompt, session.messages.slice(-10), 4096);

    let aiMessage;
    if (result) {
      aiMessage = result;
    } else {
      aiMessage = buildFallbackResponse(session.studentProfile, engineResult.engine);
    }

    session.messages.push({ role: 'assistant', content: aiMessage });

    const topMajors = [
      ...engineResult.engine.ranked.reach,
      ...engineResult.engine.ranked.match
    ].slice(0, 3);

    const schoolsByMajor = {};
    for (const m of topMajors) {
      try {
        const schoolResult = querySchools({
          major: m.id,
          score: student.score,
          province: student.province,
          subject: student.subject
        });
        schoolsByMajor[m.id] = {
          major_name: m.name,
          reach: schoolResult.reach,
          match: schoolResult.match,
          safety: schoolResult.safety
        };
      } catch (e) {}
    }

    res.json({
      status: 'success',
      data: {
        message: aiMessage,
        engine: engineResult.engine.ranked,
        recommendations: engineResult.recommender,
        schools: schoolsByMajor,
        profileStatus: getCompleteness(session.studentProfile),
        phase: 'analyzing',
        suggestions: parseSuggestions(aiMessage),
        profile: session.studentProfile,
        agentTrace: [{
          id: `quick_${Date.now()}`,
          name: 'generate_recommendation',
          label: TOOL_LABELS.generate_recommendation,
          args: {},
          status: 'success',
          summary: '已根据快速画像生成完整方案',
          durationMs: 0,
        }]
      }
    });
  } catch (error) {
    console.error('[V2 chat] 错误:', error.message);

    let userMsg = '服务器内部错误';
    if (error.status === 401) userMsg = 'API Key 无效，请检查 Key 是否正确';
    else if (error.status === 403) userMsg = 'API 访问被拒绝。可能原因：Key 无效、账户欠费、或网络限制';
    else if (error.status === 429) userMsg = 'API 调用太频繁，请稍后再试';
    else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') userMsg = '无法连接到 API 服务器，请检查网络或代理设置';

    res.status(500).json({ error: 'AI 调用失败', detail: userMsg });
  }
}

// V3 对话模式（逐条消息 → 渐进式画像）
async function handleV3Chat(req, res) {
  try {
    const { message, sessionId, apiKey, providerId, clientProfile } = req.body;
    const session = getSession(sessionId || 'default');

    // Browser history can outlive an in-memory server session. Restore validated profile fields.
    if (clientProfile && typeof clientProfile === 'object') {
      session.studentProfile = mergeProfile(session.studentProfile, clientProfile);
    }

    // 如果没有任何消息且没有画像 → 初始打招呼
    const isFirstMessage = session.messages.length === 0;

    if (message) {
      session.messages.push({ role: 'user', content: message });
    } else if (!isFirstMessage) {
      return res.status(400).json({ error: '缺少 message' });
    }

    // 确定阶段
    let phase = session.phase;
    if (isFirstMessage && !message) {
      phase = 'greeting';
      session.phase = 'greeting';
    } else if (isProfileReady(session.studentProfile) && session.phase !== 'followup') {
      phase = 'analyzing';
    } else if (isProfileHalfReady(session.studentProfile) && !isProfileReady(session.studentProfile) && session.phase !== 'half_analyzing' && session.phase !== 'analyzing') {
      // V4: 半分析阶段 — 3/4 核心字段齐全但不满足完整分析条件
      phase = 'half_analyzing';
      session.phase = 'half_analyzing';
    } else if (session.phase === 'analyzing' && session.engineResult) {
      phase = 'followup';
      session.phase = 'followup';
    } else if (phase === 'greeting') {
      phase = 'gathering';
      session.phase = 'gathering';
    }

    // 构建 prompt
    const systemPrompt = `${buildSystemPrompt(phase, session.studentProfile)}\n\n${buildAgentRuntimePrompt(session.studentProfile)}`;

    let userContent = message || '';
    if (phase === 'gathering' || phase === 'greeting' || phase === 'half_analyzing') {
      const knowledgeCtx = getKnowledgeContext(session.studentProfile, null);
      const gatheringCtx = buildUserPrompt(session.studentProfile, null, knowledgeCtx);
      if (gatheringCtx) {
        userContent = userContent
          ? `${gatheringCtx}\n\n用户刚说：${userContent}`
          : gatheringCtx;
      }
    }

    // 构建 messages（不含 system，system 单独传）
    const chatMessages = [];
    for (const msg of session.messages) {
      chatMessages.push(msg);
    }
    // 如果有 gathering context，追加
    if (userContent && userContent !== (message || '')) {
      // 替换最后一条 user message
      if (chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'user') {
        chatMessages[chatMessages.length - 1].content = userContent;
      }
    }

    // AI 调用（V4: 带 function calling，LLM 可自主查数据、搜网络）
    const maxTokens = phase === 'analyzing' ? 4096 : 2048;
    const profileWasReady = isProfileReady(session.studentProfile);
    const { text: result, toolCalls: agentTrace } = await callAIWithTools(
      providerId || null,
      apiKey,
      systemPrompt,
      chatMessages,
      maxTokens,
      { session, runEngineForProfile }
    );

    if (!result) {
      const fallback = buildFallbackResponse(session.studentProfile, session.engineResult?.engine || null);
      session.messages.push({ role: 'assistant', content: fallback });
      return res.json({
        status: 'success',
        data: {
          message: fallback,
          profileStatus: getCompleteness(session.studentProfile),
          phase: session.phase,
          suggestions: [],
          engineReady: !!session.engineResult,
          profile: session.studentProfile,
          agentTrace: []
        }
      });
    }

    // 解析 AI 回复
    const { updates, cleanText } = parseProfileFromResponse(result);
    const suggestions = parseSuggestions(cleanText);

    // 更新画像
    if (updates && Object.keys(updates).length > 0) {
      const profileUpdates = {};
      for (const [key, value] of Object.entries(updates)) {
        if (key !== '__ready') {
          profileUpdates[key] = value;
        }
      }
      session.studentProfile = mergeProfile(session.studentProfile, profileUpdates);
    }
    const newReady = isProfileReady(session.studentProfile);

    // 画像刚刚齐全 → 运行引擎
    let engineResult = session.engineResult;
    let aiMessage = cleanText;

    if (!profileWasReady && newReady && !session.engineResult) {
      console.log('[V3] 画像齐全，运行引擎...');
      const startedAt = Date.now();
      engineResult = runEngineForProfile(session.studentProfile);
      if (engineResult) {
        agentTrace.push({
          id: `auto_${Date.now()}`,
          name: 'generate_recommendation',
          label: TOOL_LABELS.generate_recommendation,
          args: {},
          status: 'success',
          summary: '画像已完整，自动生成基础志愿方案',
          durationMs: Date.now() - startedAt,
        });
        session.engineResult = engineResult;
        session.phase = 'analyzing';

        // 追加分析生成
        try {
          const analysisPrompt = buildSystemPrompt('analyzing', session.studentProfile);
          const analysisKnowledgeCtx = getKnowledgeContext(session.studentProfile, engineResult.engine);
          const analysisUserMsg = buildUserPrompt(session.studentProfile, engineResult.engine, analysisKnowledgeCtx);
          const analysisMessages = [
            { role: 'user', content: analysisUserMsg }
          ];
          const analysisText = await callAI(providerId || null, apiKey, analysisPrompt, analysisMessages, 4096);
          if (analysisText) {
            aiMessage = cleanText + '\n\n' + analysisText;
          }
          session.engineResult._delivered = true;
        } catch (e) {
          console.log('[V3] 分析生成失败，使用基础回复:', e.message);
        }
      }
    } else if (phase === 'analyzing' && session.engineResult && !session.engineResult._delivered) {
      // 已经运行过引擎但还没在对话中输出 → 这次补充分析
      const analysisPrompt = buildSystemPrompt('analyzing', session.studentProfile);
      const analysisKnowledgeCtx2 = getKnowledgeContext(session.studentProfile, session.engineResult.engine);
      const analysisUserMsg = buildUserPrompt(session.studentProfile, session.engineResult.engine, analysisKnowledgeCtx2);
      const analysisMessages = [
        { role: 'user', content: analysisUserMsg }
      ];
      try {
        const analysisText = await callAI(providerId || null, apiKey, analysisPrompt, analysisMessages, 4096);
        if (analysisText) {
          aiMessage = analysisText;
        }
      } catch (e) {
        console.log('[V3] 分析生成失败:', e.message);
      }
      session.engineResult._delivered = true;
      session.phase = 'followup';
    }

    session.messages.push({ role: 'assistant', content: aiMessage });

    // 收集学校数据（如果有引擎结果）
    let schoolsByMajor = null;
    if (session.engineResult) {
      const topMajors = [
        ...session.engineResult.engine.ranked.reach,
        ...session.engineResult.engine.ranked.match
      ].slice(0, 3);
      schoolsByMajor = {};
      for (const m of topMajors) {
        try {
          const schoolResult = querySchools({
            major: m.id,
            score: session.studentProfile.score || 0,
            province: session.studentProfile.province || '',
            subject: session.studentProfile.subject || 'science'
          });
          schoolsByMajor[m.id] = {
            major_name: m.name,
            reach: schoolResult.reach,
            match: schoolResult.match,
            safety: schoolResult.safety
          };
        } catch (e) {}
      }
    }

    res.json({
      status: 'success',
      data: {
        message: aiMessage,
        profileStatus: getCompleteness(session.studentProfile),
        phase: session.phase,
        suggestions,
        engineReady: !!session.engineResult,
        engine: session.engineResult?.engine?.ranked || null,
        recommendations: session.engineResult?.recommender || null,
        schools: schoolsByMajor,
        profile: session.studentProfile,
        agentTrace
      }
    });
  } catch (error) {
    console.error('[V3 chat] 错误:', error.message);

    let userMsg = '服务器内部错误';
    if (error.status === 401) userMsg = 'API Key 无效';
    else if (error.status === 403) userMsg = 'API 访问被拒绝';
    else if (error.status === 429) userMsg = 'API 调用太频繁，请稍后再试';
    else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') userMsg = '无法连接到 API 服务器';

    res.status(500).json({ error: 'AI 调用失败', detail: userMsg });
  }
}

// ========== API: 追问 ==========

app.post('/api/chat/followup', async (req, res) => {
  try {
    const { message, sessionId, apiKey, providerId } = req.body;

    if (!message) {
      return res.status(400).json({ error: '缺少 message' });
    }

    const session = getSession(sessionId || 'default');
    const phase = session.engineResult ? 'followup' : 'gathering';
    const systemPrompt = buildSystemPrompt(phase, session.studentProfile);
    session.messages.push({ role: 'user', content: message });

    const result = await callAI(providerId || null, apiKey, systemPrompt, session.messages.slice(-15), 2048);

    if (!result) {
      return res.json({
        status: 'success',
        data: {
          message: '未配置 API Key。请在左侧边栏输入 DeepSeek 或 Claude 的 API Key。',
          profileStatus: getCompleteness(session.studentProfile),
          phase,
          suggestions: [],
          engineReady: false
        }
      });
    }

    const { updates, cleanText } = parseProfileFromResponse(result);
    const suggestions = parseSuggestions(cleanText);

    if (updates && Object.keys(updates).length > 0) {
      const profileUpdates = {};
      for (const [key, value] of Object.entries(updates)) {
        if (key !== '__ready') {
          profileUpdates[key] = value;
        }
      }
      session.studentProfile = mergeProfile(session.studentProfile, profileUpdates);
    }

    session.messages.push({ role: 'assistant', content: cleanText });

    res.json({
      status: 'success',
      data: {
        message: cleanText,
        profileStatus: getCompleteness(session.studentProfile),
        phase,
        suggestions,
        engineReady: !!session.engineResult
      }
    });
  } catch (error) {
    console.error('[followup] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== API: Provider 列表 ==========

app.get('/api/providers', (req, res) => {
  const list = PROVIDERS.map(p => ({
    id: p.id,
    name: p.name,
    type: p.type,
    defaultModel: p.defaultModel,
    configured: !!(p.envKey && process.env[p.envKey])
  }));
  res.json({ status: 'success', data: list });
});

// ========== API: 画像状态 ==========

app.get('/api/session-profile', (req, res) => {
  const session = getSession(req.query.sessionId || 'default');
  res.json({
    profile: session.studentProfile,
    status: getCompleteness(session.studentProfile),
    ready: isProfileReady(session.studentProfile),
    phase: session.phase,
    engineReady: !!session.engineResult
  });
});

// ========== API: 录取学校查询 ==========

app.post('/api/query-schools', (req, res) => {
  try {
    const { major, score, province, subject } = req.body;

    if (!major || !score || !province) {
      return res.status(400).json({ error: '缺少 major / score / province 参数' });
    }

    const result = querySchools({ major, score, province, subject });
    res.json({ status: 'success', data: result });
  } catch (error) {
    console.error('[query-schools] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== API: 三层推荐 V2 ==========

app.post('/api/recommend-v2', (req, res) => {
  try {
    const { score, rank, province, subject, family_income, interest, city_preference, postgraduate } = req.body;

    if (!province || !subject) {
      return res.status(400).json({ error: '缺少 province / subject 参数' });
    }
    if (!rank && !score) {
      return res.status(400).json({ error: '至少需要 rank 或 score' });
    }

    const user = {
      score: score || 0,
      rank: rank || 0,
      province,
      subject,
      family_income: family_income || 'medium',
      interest: interest || '',
      city_preference: city_preference !== false,
      postgraduate: !!postgraduate
    };

    const result = recommend(user);
    res.json({ status: 'success', data: result });
  } catch (error) {
    console.error('[recommend-v2] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== API: 位次查询 ==========

app.post('/api/rank-query', (req, res) => {
  try {
    const { rank, score, province, subject, major_id, keyword } = req.body;

    if (!province || !subject) {
      return res.status(400).json({ error: '缺少 province / subject' });
    }

    // 优先检查用户自定义数据
    const userResult = queryUserData({ province, rank, score, keyword });
    if (userResult) {
      return res.json({ status: 'success', data: userResult, source: 'user_data' });
    }

    const result = rankQuery({ rank, score, province, subject, major_id });
    res.json({ status: 'success', data: result, source: 'db' });
  } catch (error) {
    console.error('[rank-query] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== API: 联网搜索 ==========

app.get('/api/search', async (req, res) => {
  try {
    const { q, n } = req.query;
    if (!q) return res.status(400).json({ error: '缺少 q 参数' });
    const results = await webSearch(q, parseInt(n) || 5);
    res.json({ status: 'success', results });
  } catch (error) {
    console.error('[search] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== API: 重置会话 ==========

app.post('/api/reload-userdata', (req, res) => {
  const count = loadUserData();
  res.json({ status: 'success', count, message: `已加载 ${count} 条自定义数据` });
});

app.get('/api/userdata', (req, res) => {
  const data = getUserData();
  const provinces = [...new Set(data.map(r => r.province))];
  res.json({ count: data.length, provinces, data });
});

app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body;
  const id = sessionId || 'default';
  sessions.delete(id);
  res.json({ status: 'success', message: '会话已重置' });
});

// ========== 启动 ==========

// 只在本地开发时启动监听，Vercel 走 serverless
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('🧭  高考志愿规划师 V3');
    console.log('    AI 启发式对话 · 主动发现需求 · 动态推荐');
    console.log(`👉  打开浏览器: http://localhost:${PORT}`);
    console.log('');

    const configured = PROVIDERS.filter(p => p.envKey && process.env[p.envKey]);
    if (configured.length > 0) {
      console.log('✅ 已配置的 AI Provider（服务器端）:');
      for (const p of configured) {
        console.log(`   - ${p.name} (${p.id})`);
      }
    } else {
      console.log('💡 未配置服务器端 API Key，在网页左侧边栏输入即可使用');
    }

    console.log('');
    console.log('📌 按 Ctrl+C 停止');
    console.log('');

    // 预热 RAG 知识库索引
    warmupRAG();
  });
}

module.exports = app;
