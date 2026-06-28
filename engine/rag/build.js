#!/usr/bin/env node
// engine/rag/build.js
// 构建知识库全文索引
// Usage: node engine/rag/build.js

const fs = require('fs');
const path = require('path');
const FlexSearch = require('flexsearch');

const DOCS_DIR = path.join(__dirname, 'documents');
const INDEX_PATH = path.join(__dirname, '..', '..', 'data', 'rag-index.json');

function buildIndex() {
  // Use simple Index (not Document) for reliable search
  const index = new FlexSearch.Index({
    tokenize: 'forward',
  });

  // Store docs separately
  const docs = [];

  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'));
  console.log(`[rag:build] 找到 ${files.length} 个文档`);

  let id = 0;
  for (const file of files) {
    const filepath = path.join(DOCS_DIR, file);
    const raw = fs.readFileSync(filepath, 'utf8');

    // 按 ## 标题切块
    const sections = raw.split(/\n(?=## )/);
    for (const section of sections) {
      const lines = section.trim().split('\n');
      const title = lines[0].replace(/^#+\s*/, '').trim();
      const content = lines.slice(1).join('\n').trim();
      if (!title || !content) continue;

      id++;
      index.add(id, `${title} ${content}`);
      docs.push({ id, title, content });
    }
  }

  console.log(`[rag:build] 索引 ${id} 个片段`);

  // 导出索引（flexsearch 0.8.x 需要callback）
  const chunks = [];
  index.export((key, data) => {
    chunks.push({ key, data });
  });

  const output = {
    index: chunks,
    docs,
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(output), 'utf8');
  console.log(`[rag:build] 索引已保存: ${INDEX_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)}KB)`);
}

buildIndex();
