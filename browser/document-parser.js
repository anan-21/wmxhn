// Runs only inside a disposable browser Worker. Original files never leave it.
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 80;
const MAX_CHARS = 120000;
const SUPPORTED = new Set(['pdf', 'docx', 'txt', 'md', 'csv']);

function normalizeText(text) {
  return String(text || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
}

async function parsePDF(buffer) {
  if (typeof globalThis.Iterator === 'undefined' || typeof URL.parse !== 'function') {
    throw new Error('当前浏览器暂不支持 PDF 解析，请更新 Chrome、Edge、Firefox 或 Safari（18.4 及以上），也可以改传 TXT / DOCX。');
  }
  if (!new TextDecoder().decode(buffer.slice(0, 1024)).includes('%PDF-')) {
    throw new Error('文件不是有效的 PDF，请检查文件是否损坏或扩展名是否正确。');
  }
  const { getDocumentProxy } = await import('unpdf');
  let pdf;
  try {
    self.postMessage({ kind: 'gaokao-document-progress', label: '正在解析 PDF…' });
    pdf = await getDocumentProxy(new Uint8Array(buffer), {
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      maxImageSize: 16777216,
      verbosity: 0,
    });
    if (pdf.numPages > MAX_PAGES) throw new Error(`PDF 共 ${pdf.numPages} 页，超过 80 页限制，请拆分后添加。`);
    const pages = [];
    let characters = 0;
    let emptyPages = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '';
      let lastY;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform?.[5];
        if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 3 && !text.endsWith('\n')) text += '\n';
        text += item.str + (item.hasEOL ? '\n' : ' ');
        lastY = y;
      }
      text = normalizeText(text);
      characters += text.length;
      if (characters > MAX_CHARS) throw new Error('文档正文超过 12 万字符限制，请拆分后添加；没有截断或发送正文。');
      if (!text) emptyPages++;
      pages.push({ pageNumber, text });
      page.cleanup();
      self.postMessage({ kind: 'gaokao-document-progress', percent: Math.round(pageNumber / pdf.numPages * 100),
        label: `正在解析 PDF · ${pageNumber} / ${pdf.numPages} 页` });
    }
    if (!characters) throw new Error('PDF 没有可提取的文字，可能是扫描件或图片。此版本不含 OCR，请先识别文字或改传可复制文字的文件。');
    return { pages, warnings: emptyPages ? [`${emptyPages} 页未提取到文字，可能是空白页或扫描内容；未执行 OCR。`] : [] };
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('PDF 已加密，请先解除密码保护后再添加。');
    if (error.name === 'InvalidPDFException') throw new Error('PDF 已损坏或格式无效，请重新导出后再添加。');
    throw error;
  } finally {
    if (pdf) await pdf.loadingTask.destroy().catch(() => {});
  }
}

async function parseFile({ buffer, type, size }) {
  if (!SUPPORTED.has(type)) throw new Error('暂支持 PDF、DOCX、TXT、MD、CSV；XLSX 请先另存为 CSV。');
  if (!size) throw new Error('文件为空，请选择包含文字的文件。');
  if (size > MAX_BYTES || buffer.byteLength > MAX_BYTES) throw new Error('单个文件不能超过 5 MB，请压缩或拆分后添加。');
  if (type === 'pdf') return parsePDF(buffer);
  let text;
  const warnings = [];
  if (type === 'docx') {
    self.postMessage({ kind: 'gaokao-document-progress', label: '正在提取 Word 正文…' });
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('文件不是有效的 DOCX，请重新导出后再添加。');
    const { default: mammoth } = await import('mammoth/mammoth.browser.js');
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      text = result.value;
      if (result.messages?.length) warnings.push('DOCX 的图片、复杂表格及部分格式可能未保留，请核对引用文字。');
    } catch {
      throw new Error('DOCX 解析失败，文件可能损坏、受密码保护或格式不受支持。');
    }
  } else {
    self.postMessage({ kind: 'gaokao-document-progress', label: '正在提取文本…' });
    try {
      const bytes = new Uint8Array(buffer);
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
      if (/\u0000/.test(text)) throw new Error('binary');
    } catch {
      throw new Error('文本编码无法识别，请另存为 UTF-8 编码的 TXT、MD 或 CSV 后添加。');
    }
    if (type === 'csv') warnings.push('CSV 按文本读取，回答中的位置为文本块，不保证表格计算精度。');
  }
  text = normalizeText(text);
  if (!text) throw new Error('文档没有可提取的文字，请检查内容。');
  if (text.length > MAX_CHARS) throw new Error('文档正文超过 12 万字符限制，请拆分后添加；没有截断或发送正文。');
  return { pages: [{ pageNumber: 1, text }], warnings };
}

self.onmessage = async ({ data }) => {
  try {
    const result = await parseFile(data);
    self.postMessage({ kind: 'gaokao-document-result', ok: true, ...result });
  } catch (error) {
    self.postMessage({ kind: 'gaokao-document-result', ok: false, error: error.message || '解析失败，请检查文件后重试。' });
  }
};
