const { test, expect } = require('@playwright/test');
const { pdf, docx } = require('./fixtures.cjs');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#providerSelect')).toHaveValue('custom');
});

test('specific OpenAI key prefixes select the right provider and prevent mismatched sends', async ({ page }) => {
  const requests = [];
  await page.route('**/api/chat', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { data: { message: 'mock' } } });
  });
  await page.locator('#providerSelect').selectOption('deepseek');
  await page.locator('#apiKeyInput').fill('sk-proj-browser-placeholder');
  await page.locator('#chatInput').fill('测试');
  await expect(page.locator('#providerSelect')).toHaveValue('openai');
  await page.locator('#providerSelect').selectOption('deepseek');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#attachmentNotice')).toContainText('对应 OpenAI');
  expect(requests).toHaveLength(0);
  await page.locator('#providerSelect').selectOption('custom');
  await page.locator('#apiKeyInput').fill('sk-proj-custom-placeholder');
  await page.locator('#chatInput').fill('使用已选择的自定义入口');
  await expect(page.locator('#providerSelect')).toHaveValue('custom');
});

async function add(page, name, buffer, mimeType = 'text/plain') {
  await page.locator('#documentInput').setInputFiles({ name, mimeType, buffer });
  await expect(page.locator('.attachment-item.parsing')).toHaveCount(0);
}
async function ask(page, text) {
  await page.locator('#chatInput').fill(text);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.pending-row')).toHaveCount(0);
  await expect(page.locator('#chatInput')).toBeEnabled();
}
async function removeAll(page) {
  while (await page.locator('.attachment-item').count()) await page.locator('.attachment-item button').first().click();
  if (await page.locator('#sessionDocumentList .session-document').count()) {
    if ((await page.locator('#sessionDocuments').getAttribute('open')) === null) await page.locator('#sessionDocuments summary').click();
    while (await page.locator('#sessionDocumentList .session-document').count()) {
      await page.locator('#sessionDocumentList .session-document button').first().click();
    }
  }
}

test('text document, source excerpts, multiple turns, removal and consultation isolation', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().endsWith('/api/chat')) requests.push(request.postDataJSON()); });
  await add(page, '招生要求.txt', Buffer.from('招生要求：必须选考物理。学费每年5000元。'));
  await expect(page.locator('.attachment-item.ready')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/attachment-pending-desktop.png', animations: 'disabled' });
  await ask(page, '这份文件的选科要求是什么？');
  await expect(page.locator('#attachmentList .attachment-item')).toHaveCount(0);
  await expect(page.locator('.user-row .message-attachment')).toHaveCount(1);
  await expect(page.locator('.user-row .message-attachment')).toContainText('招生要求.txt');
  await expect(page.locator('.user-row .message-attachment button')).toHaveCount(0);
  await expect(page.locator('#sessionDocumentList .session-document')).toHaveCount(1);
  await expect(page.locator('.message-copy').last()).toContainText('必须选考物理');
  await expect(page.locator('.tool-event').last()).toContainText('阅读上传文档');
  await page.locator('.document-source summary').first().click();
  await expect(page.locator('.document-source blockquote').first()).toContainText('5000元');
  await page.locator('.user-row .message-attachment').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/attachment-sent-desktop.png', animations: 'disabled' });
  await ask(page, '再说说学费');
  expect(requests[1].documents).toHaveLength(1);
  expect(requests[1].clientMessages.map(item => item.role)).toEqual(['user', 'assistant']);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('gaokao_agent_history_v1')));
  expect(history[0].documents).toBeUndefined();
  expect(history[0].attachments).toBeUndefined();
  const savedFile = history[0].messages.find(item => item.role === 'user').attachments[0];
  expect(savedFile.name).toBe('招生要求.txt');
  expect(savedFile.size).toBeGreaterThan(0);
  expect(savedFile.pages).toBeUndefined();
  expect(savedFile.text).toBeUndefined();
  expect(savedFile.document).toBeUndefined();
  const firstTitle = history[0].title;
  await page.getByRole('button', { name: /新建咨询/ }).click();
  await expect(page.locator('.attachment-item')).toHaveCount(0);
  await ask(page, '新咨询');
  expect(requests.at(-1).documents).toEqual([]);
  await page.locator('.history-item button').filter({ hasText: firstTitle }).first().click();
  await expect(page.locator('#attachmentList .attachment-item')).toHaveCount(0);
  await expect(page.locator('#sessionDocumentList .session-document')).toHaveCount(1);
  await expect(page.locator('.user-row .message-attachment')).toHaveCount(1);
  await removeAll(page);
  await expect(page.locator('.user-row .message-attachment')).toHaveCount(1);
  await ask(page, '移除之后还能读到文件吗');
  expect(requests.at(-1).documents).toEqual([]);
  await expect(page.locator('.message-copy').last()).toContainText('没有可用附件');
  await page.reload();
  await page.locator('.history-item button').filter({ hasText: firstTitle }).first().click();
  await expect(page.locator('.attachment-item')).toHaveCount(0);
  await expect(page.locator('#sessionDocumentList .session-document')).toHaveCount(0);
  await expect(page.locator('.user-row .message-attachment')).toHaveCount(1);
  await expect(page.locator('.user-row .message-attachment')).toContainText('招生要求.txt');
  await expect(page.locator('#attachmentNotice')).toContainText('重新添加');
});

test('plus opens file picker, pending attachments can be removed and file-only messages can be sent', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().endsWith('/api/chat')) requests.push(request.postDataJSON()); });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#attachBtn').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: '待移除.txt', mimeType: 'text/plain', buffer: Buffer.from('待移除资料') });
  await expect(page.locator('#attachmentList .attachment-item.ready')).toContainText('待移除.txt');
  await page.locator('#attachmentList .attachment-item button').click();
  await expect(page.locator('#attachmentList .attachment-item')).toHaveCount(0);
  await expect(page.locator('.user-row .message-attachment')).toHaveCount(0);
  await add(page, '只发文件.md', Buffer.from('材料重点：选考物理和化学。'));
  await expect(page.locator('#chatInput')).toHaveValue('');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.pending-row')).toHaveCount(0);
  await expect(page.locator('#chatInput')).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(requests[0].message).toBe('请概括这些文档的主要内容，并告诉我可以继续问哪些问题。');
  await expect(page.locator('.user-row .message-attachment')).toContainText('只发文件.md');
  await expect(page.locator('.user-row .message-attachment button')).toHaveCount(0);
  await expect(page.locator('#attachmentList .attachment-item')).toHaveCount(0);
  await expect(page.locator('.message-copy').last()).toContainText('物理和化学');
});

test('request failure restores draft text and pending files without duplicate sent cards', async ({ page }) => {
  await add(page, '重试材料.txt', Buffer.from('重试材料：招生60人。'));
  await page.route('**/api/chat', route => route.fulfill({ status: 503, json: { error: '测试失败：请重试' } }));
  await ask(page, '请查招生人数');
  await expect(page.locator('#attachmentNotice')).toContainText('测试失败');
  await expect(page.locator('#chatInput')).toHaveValue('请查招生人数');
  await expect(page.locator('#attachmentList .attachment-item.ready')).toContainText('重试材料.txt');
  await expect(page.locator('.user-row')).toHaveCount(0);
  await expect(page.locator('.message-attachment')).toHaveCount(0);
  await expect(page.locator('#sessionDocumentList .session-document')).toHaveCount(0);
  await page.unroute('**/api/chat');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.pending-row')).toHaveCount(0);
  await expect(page.locator('#chatInput')).toBeEnabled();
  await expect(page.locator('.user-row')).toHaveCount(1);
  await expect(page.locator('.user-row .message-attachment')).toHaveCount(1);
  await expect(page.locator('#attachmentList .attachment-item')).toHaveCount(0);
});

test('nested file dragging stays highlighted until the file leaves or drops', async ({ page }) => {
  await page.evaluate(() => {
    const files = new DataTransfer();
    files.items.add(new File(['拖拽材料'], '拖入.txt', { type: 'text/plain' }));
    const zone = document.getElementById('documentDropZone');
    const input = document.getElementById('chatInput');
    zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: files, bubbles: true, cancelable: true }));
    input.dispatchEvent(new DragEvent('dragenter', { dataTransfer: files, bubbles: true, cancelable: true }));
    zone.dispatchEvent(new DragEvent('dragleave', { dataTransfer: files, relatedTarget: input, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#documentDropZone')).toHaveClass(/dragging/);
  await page.evaluate(() => {
    const files = new DataTransfer();
    files.items.add(new File(['拖拽材料'], '拖入.txt', { type: 'text/plain' }));
    document.getElementById('chatInput').dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#documentDropZone')).not.toHaveClass(/dragging/);
  await expect(page.locator('#attachmentList .attachment-item.ready')).toContainText('拖入.txt');
  await page.evaluate(() => {
    const files = new DataTransfer();
    files.items.add(new File(['unused'], 'unused.txt', { type: 'text/plain' }));
    document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: files, bubbles: true, cancelable: true }));
    document.dispatchEvent(new DragEvent('dragleave', { dataTransfer: files, relatedTarget: null, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#documentDropZone')).not.toHaveClass(/dragging/);
  await expect(page.locator('#attachmentList .attachment-item')).toHaveCount(1);
});

test('real PDF and DOCX extract in browser Worker and keep correct locations', async ({ page }) => {
  await add(page, 'plan.pdf', pdf(['Physics required. Admission plan 120.', 'Tuition 5000 CNY.']), 'application/pdf');
  await expect(page.locator('.attachment-item.ready')).toContainText('2 页');
  await ask(page, '概括这份招生文件');
  await expect(page.locator('.document-source summary').filter({ hasText: '第 2 页' })).toHaveCount(1);
  await removeAll(page);
  await add(page, '章程.docx', docx('报考医学专业需要选考化学。'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await expect(page.locator('.attachment-item.ready')).toHaveCount(1);
  await ask(page, '报考要求是什么');
  await expect(page.locator('.message-copy').last()).toContainText('需要选考化学');
  await expect(page.locator('.document-source summary').last()).toContainText('文本块 1');
});

test('empty, broken, oversized, long and image-only files fail clearly', async ({ page }) => {
  for (const [name, buffer, expected] of [
    ['空白.txt', Buffer.from('   '), '没有可提取'],
    ['broken.pdf', Buffer.from('not a PDF'), '不是有效'],
    ['broken.docx', Buffer.from('PKbroken'), '解析失败'],
    ['large.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 65), '5 MB'],
    ['long.txt', Buffer.from('字'.repeat(120001)), '12 万'],
    ['image.pdf', pdf(['']), 'OCR'],
    ['pages.pdf', pdf(Array(81).fill('test')), '80 页'],
  ]) {
    await add(page, name, buffer);
    await expect(page.locator('.attachment-item.error')).toContainText(expected);
    await removeAll(page);
  }
  await page.locator('#documentInput').setInputFiles(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from('test') })));
  await expect(page.locator('.attachment-item.parsing')).toHaveCount(0);
  await expect(page.locator('.attachment-item')).toHaveCount(4);
  await expect(page.locator('#attachmentNotice')).toContainText('4 个');
});

test('drag/drop, no-key message and mobile layout preserve usable composer', async ({ page }) => {
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['专业,选科\n计算机,物理'], '计划.csv', { type: 'text/csv' }));
    document.getElementById('documentDropZone').dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.attachment-item.ready')).toHaveCount(1);
  await page.locator('#providerSelect').selectOption('deepseek');
  await page.locator('#chatInput').fill('读一下文件');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#attachmentNotice')).toContainText('API Key');
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator('#documentDropZone').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await expect(page.locator('#attachBtn')).toBeVisible();
  await expect(page.locator('#sendBtn')).toBeVisible();
  await expect.poll(async () => Math.round((await page.locator('#contextPanel').boundingBox()).x)).toBeGreaterThanOrEqual(390);
  await page.screenshot({ path: 'test-results/document-mobile.png', animations: 'disabled' });
});

test('slow parsing blocks switching and can be cancelled or timed out', async ({ page }) => {
  await page.route('**/document-parser.js', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {};' }));
  await page.clock.install();
  const file = { name: 'waiting.txt', mimeType: 'text/plain', buffer: Buffer.from('will not parse') };
  await page.locator('#documentInput').setInputFiles(file);
  await expect(page.locator('.attachment-item.parsing')).toHaveCount(1);
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('#sendBtn')).toBeDisabled();
  await page.getByRole('button', { name: /新建咨询/ }).click();
  await expect(page.locator('#attachmentNotice')).toContainText('等待完成或移除');
  await page.locator('.attachment-item button').click();
  await expect(page.locator('.attachment-item')).toHaveCount(0);
  await expect(page.locator('#sendBtn')).toBeEnabled();
  await page.locator('#documentInput').setInputFiles(file);
  await expect(page.locator('.attachment-item.parsing')).toHaveCount(1);
  await page.clock.fastForward(31000);
  await expect(page.locator('.attachment-item.error')).toContainText('30 秒');
});

test('storage quota failure does not misreport a model failure and active history can be deleted', async ({ page }) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'gaokao_agent_history_v1') throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await ask(page, '你好');
  await expect(page.locator('.message-copy').last()).not.toContainText('这轮没有完成');
  await expect(page.locator('#attachmentNotice')).toContainText('存储空间不足');
  await page.reload();
  await ask(page, '删除这次咨询记录');
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.locator('.history-delete').click();
  await expect(page.locator('.history-item')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gaokao_agent_history_v1')))).toEqual([]);
});
