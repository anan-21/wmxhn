// engine/tools.js
// V4 Function Calling — LLM 可自主调用的工具
// search_admission: 查录取数据库
// web_search: 联网搜索

const { rankQuery } = require('./admissionQuery');
const { webSearch } = require('./webSearch');
const { searchKnowledge } = require('./rag/index');
const fs = require('fs');
const path = require('path');

// ============ Tool Definitions (OpenAI format) ============

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_admission',
      description: '查询高考录取数据库，返回匹配的学校、专业、分数线、位次。当用户问"我能上什么学校""XX分能去哪""XX专业多少分"时调用。',
      parameters: {
        type: 'object',
        properties: {
          province: { type: 'string', description: '省份，如 山东、浙江、河北' },
          rank: { type: 'integer', description: '位次，如 15000' },
          score: { type: 'integer', description: '分数，如 600' },
          subject: { type: 'string', description: '科类：science(理科/物理类) 或 arts(文科/历史类)', enum: ['science', 'arts'] },
          keyword: { type: 'string', description: '搜索关键词，匹配学校名或专业名，如"计算机""口腔医学"' },
          limit: { type: 'integer', description: '返回条数上限，默认15', default: 15 },
        },
        required: ['province'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索最新信息。当用户问"张雪峰近况""今年政策""最新录取线"等需要实时数据时调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          n: { type: 'integer', description: '返回条数，默认3', default: 3 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: '搜索本地知识库，获取就业数据、专业劝退指南、省份志愿政策等信息。当用户问"XX专业好就业吗""XX专业怎么样""学XX要注意什么""XX省志愿怎么填"等需要专业知识的问题时优先调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，如"计算机就业""法学劝退""浙江志愿"' },
          limit: { type: 'integer', description: '返回条数，默认3', default: 3 },
        },
        required: ['query'],
      },
    },
  },
];

// ============ Tool Implementations ============

function searchAdmission({ province, rank, score, subject = 'science', keyword, limit = 15 }) {
  const raw = rankQuery({ rank, score, province, subject });

  if (!raw || !raw.meta || raw.meta.total_matched === 0) {
    return { total: 0, message: `${province}暂无录取数据`, results: [] };
  }

  let results = [...raw.reach, ...raw.match, ...raw.safety];

  // 关键词过滤
  if (keyword) {
    const kw = keyword.toLowerCase();
    results = results.filter(r =>
      (r.school_name && r.school_name.includes(kw)) ||
      (r.major_name && r.major_name.includes(kw))
    );
  }

  results.sort((a, b) => b.admission_probability - a.admission_probability);
  const sliced = results.slice(0, limit);

  return {
    total: results.length,
    query: { province, rank, score, subject, keyword },
    results: sliced.map(r => ({
      school: r.school_name,
      major: r.major_name,
      score: r.min_score,
      rank: r.min_rank,
      probability: `${r.admission_probability}%`,
      tier: { safety: '保底', match: '稳妥', reach: '冲刺', risky: '风险' }[r.tier] || r.tier,
      batch: r.plan_count ? `招${r.plan_count}人` : '',
    })),
  };
}

async function searchWeb({ query, n = 3 }) {
  const results = await webSearch(query, n);
  if (!results.length) return { results: [], message: '未搜到结果' };
  return {
    results: results.map(r => ({
      title: r.title,
      snippet: r.snippet.slice(0, 300),
      url: r.url,
    })),
  };
}

function searchKnowledgeTool({ query, limit = 3 }) {
  const results = searchKnowledge(query, limit);
  if (!results.length) return { results: [], message: `知识库未找到"${query}"相关内容` };
  return {
    results: results.map(r => ({
      title: r.title,
      content: r.content.slice(0, 600),
    })),
  };
}

// ============ Tool Dispatcher ============

async function executeTool(name, args) {
  switch (name) {
    case 'search_admission': return searchAdmission(args);
    case 'web_search': return await searchWeb(args);
    case 'search_knowledge': return searchKnowledgeTool(args);
    default: return { error: `未知工具: ${name}` };
  }
}

/**
 * Convert our TOOLS to Claude's tool format
 */
function toClaudeTools() {
  return TOOLS.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

module.exports = { TOOLS, toClaudeTools, executeTool };
