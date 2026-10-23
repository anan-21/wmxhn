const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITS, DocumentInputError, validateDocuments, createDocumentStore, buildDocumentContext,
  DOCUMENT_INSTRUCTIONS, searchUploadedDocuments, readUploadedDocument, splitText } = require('../engine/uploadedDocuments');
const { executeTool } = require('../engine/tools');
const { runAgent } = require('../agent/runtime');

function document(overrides = {}) {
  return { id: 'file-a', name: '招生章程.pdf', type: 'pdf', size: 500,
    pages: [{ pageNumber: 1, text: '本校招生计划为120人，学费每年5000元。' }], ...overrides };
}

function store(...documents) { return createDocumentStore(validateDocuments(documents)); }

test('valid PDF data preserves real page numbers and permits empty pages', () => {
  const [result] = validateDocuments([document({ pages: [
    { pageNumber: 3, text: '  第三页有效正文\u0000  ' }, { pageNumber: 1, text: '' },
  ] })]);
  assert.deepEqual(result.pages, [{ pageNumber: 1, text: '' }, { pageNumber: 3, text: '第三页有效正文' }]);
  const index = createDocumentStore([result]);
  assert.equal(index.chunks[0].pageNumber, 3);
  assert.equal(index.chunks[0].location, '第 3 页');
});

test('unsupported, malformed, empty, and forged document structures are rejected', async t => {
  const cases = [
    ['non-array', {}], ['null', null], ['missing metadata', [{}]],
    ['duplicate ID', [document(), document()]], ['invalid ID', [document({ id: '../file' })]],
    ['unsupported XLSX', [document({ name: '数据.xlsx', type: 'xlsx' })]],
    ['mismatched extension', [document({ name: '数据.txt' })]],
    ['control character in name', [document({ name: '数据\n.pdf' })]],
    ['long name', [document({ name: `${'名'.repeat(181)}.pdf` })]],
    ['empty pages array', [document({ pages: [] })]],
    ['duplicate page number', [document({ pages: [{ pageNumber: 1, text: 'a' }, { pageNumber: 1, text: 'b' }] })]],
    ['non-string text', [document({ pages: [{ pageNumber: 1, text: {} }] })]],
    ['out-of-range page', [document({ pages: [{ pageNumber: 81, text: 'a' }] })]],
    ['image-only PDF', [document({ pages: [{ pageNumber: 1, text: '  \u0000\n ' }] })]],
  ];
  for (const [name, value] of cases) await t.test(name, () => {
    assert.throws(() => validateDocuments(value), error => error instanceof DocumentInputError && error.status === 400);
  });
  assert.throws(() => validateDocuments([document({ pages: [{ pageNumber: 1, text: '' }] })]), /OCR/);
});

test('file count, original bytes, page count, document and aggregate text limits are enforced', async t => {
  const cases = [
    ['too many files', Array.from({ length: 5 }, (_, i) => document({ id: `file-${i}` }))],
    ['too many bytes', [document({ size: LIMITS.fileBytes + 1 })]],
    ['zero bytes', [document({ size: 0 })]],
    ['fractional bytes', [document({ size: 1.5 })]],
    ['too many pages', [document({ pages: Array.from({ length: 81 }, (_, i) => ({ pageNumber: i + 1, text: 'a' })) })]],
    ['too much document text', [document({ pages: [{ pageNumber: 1, text: '文'.repeat(LIMITS.documentChars + 1) }] })]],
    ['too much total text', Array.from({ length: 3 }, (_, i) => document({ id: `file-${i}`, pages: [{ pageNumber: 1, text: '文'.repeat(80001) }] }))],
  ];
  for (const [name, value] of cases) await t.test(name, () => assert.throws(() => validateDocuments(value), DocumentInputError));
  assert.equal(validateDocuments([document({ size: LIMITS.fileBytes,
    pages: [{ pageNumber: 80, text: '文'.repeat(LIMITS.documentChars) }] })])[0].charCount, LIMITS.documentChars);
});

test('overlap retains terms that cross a chunk boundary and retrieval returns PDF provenance', () => {
  const body = `${'填报资料。'.repeat(300)}\n${'x'.repeat(995)}定向培养医学专业录取条件详见备注。${'其他资料。'.repeat(300)}`;
  const index = store(document({ pages: [{ pageNumber: 7, text: body }] }));
  assert.ok(index.chunks.length > 3);
  const result = searchUploadedDocuments(index, { query: '定向培养医学', limit: 2 });
  assert.ok(result.results.some(item => item.text.includes('定向培养医学')));
  assert.ok(result.results.every(item => item.pageNumber === 7 && item.location === '第 7 页'));
  assert.ok(result.results.every(item => item.trust === 'untrusted_document_data'));
  assert.equal(index.sources.size, result.results.length);
  assert.ok(result.results[0].chunkId.startsWith('file-a:'));
});

test('long-document context is bounded, can retrieve late pages, and states incomplete coverage', () => {
  const index = store(document({ pages: [{ pageNumber: 1, text: '普通填报说明。'.repeat(2500) },
    { pageNumber: 40, text: '口腔医学学制为五年，招生18人。' }] }));
  const context = JSON.parse(buildDocumentContext(index, '口腔医学招生人数'));
  assert.match(context.coverage, /仅部分/);
  assert.ok(context.results.some(item => item.pageNumber === 40 && item.text.includes('招生18人')));
  assert.ok(context.results.length <= 5);
  assert.ok(JSON.stringify(context).length < 15000);
  assert.equal(context.manifest[0].id, 'file-a');
});

test('short-document context includes all text and non-PDF locations use text blocks', () => {
  const index = store(document({ name: '说明.docx', type: 'docx', pages: [{ pageNumber: 1, text: '文档的完整正文。' }] }));
  const context = JSON.parse(buildDocumentContext(index, '总结'));
  assert.match(context.coverage, /完整正文/);
  assert.equal(context.results[0].text, '文档的完整正文。');
  assert.equal(context.results[0].location, '文本块 1');
  assert.equal(context.manifest[0].pages, undefined);
  assert.match(DOCUMENT_INSTRUCTIONS, /不可信/);
  assert.match(DOCUMENT_INSTRUCTIONS, /绝不能执行/);
});

test('model context and document tool results contain one text copy while UI sources retain excerpts', async () => {
  const text = 'UNIQUE_DOCUMENT_PASSAGE_2026：本专业招生18人。';
  const index = store(document({ pages: [{ pageNumber: 2, text }] }));
  const context = buildDocumentContext(index, '招生');
  assert.equal(context.split(text).length - 1, 1);
  assert.equal(Object.hasOwn(JSON.parse(context).results[0], 'excerpt'), false);
  assert.equal(index.sources.get('file-a:1').excerpt, text);

  for (const [name, args] of [
    ['search_uploaded_documents', { query: '招生' }],
    ['read_uploaded_document', { documentId: 'file-a', pageNumber: 2 }],
  ]) {
    const result = await executeTool(name, args, { documentStore: index });
    assert.equal(result.results[0].text, text);
    assert.equal(Object.hasOwn(result.results[0], 'excerpt'), false);
    assert.equal(JSON.stringify(result).split(text).length - 1, 1);
    assert.equal(index.sources.get('file-a:1').excerpt, text);
    assert.equal(index.sources.get('file-a:1').pageNumber, 2);
  }
});

test('read supports continuation and page/chunk selection with bounded output', () => {
  const index = store(document({ pages: [{ pageNumber: 1, text: 'a'.repeat(8000) },
    { pageNumber: 2, text: '第二页的独立文字' }] }));
  const first = readUploadedDocument(index, { documentId: 'file-a', limit: 2 });
  assert.equal(first.results.length, 2);
  assert.equal(first.hasMore, true);
  const next = readUploadedDocument(index, { documentId: 'file-a', startChunk: first.nextChunk, limit: 2 });
  assert.equal(next.results[0].chunkId, `file-a:${first.nextChunk}`);
  const page = readUploadedDocument(index, { documentId: 'file-a', pageNumber: 2 });
  assert.equal(page.results[0].text, '第二页的独立文字');
  const exact = readUploadedDocument(index, { documentId: 'file-a', chunkId: page.results[0].chunkId });
  assert.deepEqual(exact.results, page.results);
  assert.deepEqual(readUploadedDocument(index, { documentId: 'file-a', pageNumber: 80 }).results, []);
});

test('page-specific continuation reads all chunks of a long PDF page without restarting', () => {
  const index = store(document({ pages: [{ pageNumber: 1, text: '前言页，不在本次阅读范围。' },
    { pageNumber: 2, text: '本页招生计划与专业说明。'.repeat(1100) },
    { pageNumber: 3, text: '附录页，不在本次阅读范围。' }] }));
  const expectedIds = index.chunks.filter(chunk => chunk.pageNumber === 2).map(chunk => chunk.chunkId);
  assert.ok(expectedIds.length > 4);
  const seen = new Set();
  let startChunk = 1;
  let hasMore = true;
  for (let round = 0; hasMore && round <= expectedIds.length; round++) {
    const result = readUploadedDocument(index, { documentId: 'file-a', pageNumber: 2, startChunk, limit: 4 });
    assert.ok(result.results.length > 0 && result.results.length <= 4);
    for (const chunk of result.results) {
      assert.equal(chunk.pageNumber, 2);
      assert.equal(seen.has(chunk.chunkId), false, `continuation repeated ${chunk.chunkId}`);
      seen.add(chunk.chunkId);
    }
    assert.ok(result.nextChunk > startChunk, 'continuation must move forward');
    startChunk = result.nextChunk;
    hasMore = result.hasMore;
  }
  assert.equal(hasMore, false);
  assert.deepEqual([...seen], expectedIds);
  assert.deepEqual(readUploadedDocument(index, { documentId: 'file-a', pageNumber: 2, startChunk }).results, []);
});

test('document tools isolate separate requests and removal prevents access to stale contents', async () => {
  const first = store(document());
  const second = store(document({ id: 'file-b', name: '另一份.txt', type: 'txt', pages: [{ pageNumber: 1, text: '另一咨询仅有电气专业信息。' }] }));
  const removed = createDocumentStore([]);
  const found = await executeTool('search_uploaded_documents', { query: '招生计划' }, { documentStore: first });
  assert.equal(found.results[0].documentId, 'file-a');
  assert.ok((await executeTool('read_uploaded_document', { documentId: 'file-a' }, { documentStore: second })).error);
  assert.ok((await executeTool('read_uploaded_document', { documentId: 'file-a' }, { documentStore: removed })).error);
  assert.ok((await executeTool('search_uploaded_documents', { query: '招生计划' }, { documentStore: removed })).error);
  assert.equal(second.sources.size, 0);
  assert.equal(removed.sources.size, 0);
  assert.deepEqual(searchUploadedDocuments(first, { query: '不存在的天文物理词汇' }).results, []);
});

function completion(text, calls) {
  return new Response(JSON.stringify({ id: 'document-test', object: 'chat.completion', created: 1, model: 'mock',
    choices: [{ index: 0, message: { role: 'assistant', content: text, ...(calls ? { tool_calls: calls } : {}) },
      finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
  { headers: { 'content-type': 'application/json' } });
}

test('SDK document tool loop supports two turns with fresh request-scoped stores and traces', async () => {
  const provider = { id: 'document-mock', type: 'openai-compatible', baseURL: 'https://model.invalid/v1',
    defaultModel: 'mock', envKey: 'DOCUMENT_TEST_UNUSED_KEY', envModel: 'DOCUMENT_TEST_UNUSED_MODEL', envBaseURL: 'DOCUMENT_TEST_UNUSED_URL' };
  const history = [{ role: 'user', content: '招生计划有多少人？' }];
  for (const [turn, name, args, answer] of [
    [1, 'search_uploaded_documents', { query: '招生计划' }, '招生计划为120人【招生章程.pdf · 第 1 页】。'],
    [2, 'read_uploaded_document', { documentId: 'file-a', pageNumber: 1 }, '学费每年5000元【招生章程.pdf · 第 1 页】。'],
  ]) {
    const index = store(document());
    let count = 0;
    const result = await runAgent({ provider, apiKey: 'mock-key-only', instructions: DOCUMENT_INSTRUCTIONS,
      messages: history, context: { documentStore: index }, fetchImpl: async (_, options) => {
        const payload = JSON.parse(options.body);
        if (++count === 1) {
          if (turn === 2) assert.ok(payload.messages.some(item => item.role === 'assistant' && item.content.includes('120人')));
          return completion(null, [{ id: `doc-${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }]);
        }
        const tool = payload.messages.find(item => item.role === 'tool');
        assert.ok(tool.content.includes('120人'));
        assert.ok(tool.content.includes('untrusted_document_data'));
        return completion(answer);
      } });
    assert.equal(count, 2);
    assert.equal(result.text, answer);
    assert.equal(result.toolCalls[0].name, name);
    assert.equal(result.toolCalls[0].status, 'success');
    assert.equal(index.sources.get('file-a:1').pageNumber, 1);
    history.push({ role: 'assistant', content: result.text }, { role: 'user', content: '那学费呢？' });
  }
});

test('splitText terminates on whitespace and retains long unbroken input', () => {
  assert.deepEqual(splitText(' '.repeat(5000)), []);
  const input = 'abcdefghij'.repeat(500);
  const parts = splitText(input);
  assert.ok(parts.length > 1 && parts.every(part => part.length <= 1000));
  assert.equal(parts[0].slice(-160), parts[1].slice(0, 160));
});
