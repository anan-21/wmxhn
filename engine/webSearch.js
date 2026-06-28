// engine/webSearch.js
// V4 联网搜索兜底 — 数据库查不到时联网搜
// 策略: Tavily API > 百度 (国内直连)

const https = require('https');
const querystring = require('querystring');

const TAVILY_KEY = process.env.TAVILY_API_KEY || '';

/**
 * 百度搜索 (国内免代理)
 */
function searchBaidu(query, n = 5) {
  return new Promise((resolve) => {
    const qs = querystring.stringify({ wd: query, rn: n });
    const url = `https://www.baidu.com/s?${qs}`;

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: 8000,
    }, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        const results = [];
        // 提取搜索结果: <div class="c-container"> 中的标题+摘要
        const blocks = html.split(/<div[^>]*class="[^"]*c-container[^"]*"[^>]*>/).slice(1);
        for (const block of blocks) {
          if (results.length >= n) break;
          // 标题
          const titleMatch = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
          // 摘要
          const snippetMatch = block.match(/<span[^>]*class="[^"]*content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/) ||
                               block.match(/<span[^>]*class="[^"]*c-abstract[^"]*"[^>]*?>([\s\S]*?)<\/span>/);
          if (titleMatch) {
            const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
            if (title) results.push({ title, snippet: snippet.slice(0, 300), url: '' });
          }
        }
        resolve(results);
      });
      res.on('error', () => resolve([]));
    });
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
  });
}

/**
 * Tavily search (if API key configured, better quality)
 */
function searchTavily(query, n = 5) {
  return new Promise((resolve) => {
    if (!TAVILY_KEY) return resolve(null);

    const body = JSON.stringify({
      api_key: TAVILY_KEY, query, max_results: n, search_depth: 'basic',
    });

    const req = https.request({
      hostname: 'api.tavily.com', path: '/search', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve((json.results || []).map(r => ({
            title: r.title, snippet: r.content, url: r.url,
          })));
        } catch { resolve([]); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
    req.write(body);
    req.end();
  });
}

/**
 * 主搜索接口
 * @param {string} query 搜索关键词
 * @param {number} n 返回条数
 */
async function webSearch(query, n = 5) {
  if (TAVILY_KEY) {
    const results = await searchTavily(query, n);
    if (results && results.length) return results;
  }
  return searchBaidu(query, n);
}

/**
 * 高考信息搜索
 */
async function searchGaokao(keyword, province = '') {
  const q = province ? `${province} 高考 ${keyword}` : `高考 ${keyword}`;
  const results = await webSearch(q, 3);
  if (!results.length) return [];
  return results.map(r => `[联网搜索] ${r.title}: ${r.snippet.slice(0, 200)}`);
}

module.exports = { webSearch, searchGaokao };
