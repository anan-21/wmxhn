// engine/rag/index.js
// 知识库全文检索 — flexsearch Index
// 启动时加载索引，提供 searchKnowledge(query) 给 LLM function calling

const fs = require('fs');
const path = require('path');
const FlexSearch = require('flexsearch');

const INDEX_PATH = path.join(__dirname, '..', '..', 'data', 'rag-index.json');

let _index = null;
let _docs = [];

function loadIndex() {
  if (_index) return _index;
  try {
    if (!fs.existsSync(INDEX_PATH)) {
      console.log('[rag] 索引不存在，请先运行: node engine/rag/build.js');
      return null;
    }

    const raw = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));

    _index = new FlexSearch.Index({
      tokenize: 'forward',
    });

    // flexsearch 0.8.x: import expects (key, data) per chunk
    for (const chunk of raw.index) {
      _index.import(chunk.key, chunk.data);
    }
    _docs = raw.docs;
    console.log('[rag] 知识库索引已加载');
    return _index;
  } catch (e) {
    console.log('[rag] 加载失败:', e.message);
    return null;
  }
}

/**
 * 搜索知识库
 * @param {string} query - 搜索关键词
 * @param {number} limit - 返回片段数
 * @returns {{title: string, content: string}[]}
 */
function searchKnowledge(query, limit = 3) {
  const index = loadIndex();
  if (!index) return [];

  const ids = index.search(query, { limit });
  const results = [];

  for (const id of ids) {
    const doc = _docs.find(d => d.id === id);
    if (doc) {
      results.push({ title: doc.title, content: doc.content.slice(0, 500) });
    }
    if (results.length >= limit) break;
  }

  return results;
}

function warmup() {
  loadIndex();
}

module.exports = { searchKnowledge, warmup, loadIndex };
