// Never return raw provider messages: some echo credentials or request content.
function getProviderErrorMessage(error) {
  const nodes = [];
  const queue = [error];
  while (queue.length && nodes.length < 6) {
    const item = queue.shift();
    if (!item || nodes.includes(item)) continue;
    nodes.push(item);
    queue.push(item.lastError, item.cause);
  }
  const codes = [];
  for (const item of nodes) {
    codes.push(item.code, item.type, item.data?.error?.code, item.data?.error?.type);
    try {
      const body = JSON.parse(item.responseBody || '{}');
      codes.push(body.error?.code, body.error?.type);
    } catch {}
  }
  const status = nodes.map(item => item.status || item.statusCode).find(Boolean);
  const labels = codes.filter(Boolean).join(' ');
  const messages = nodes.map(item => item.message || '').join(' ');
  if (/insufficient_quota|credit_balance_exhausted|spend_limit|usage_limit|billing_hard_limit/.test(labels)
    || (status === 429 && /quota|billing|credit balance/i.test(messages))) {
    return '模型 API 余额不足或已达到用量额度，请检查所选服务商的 API 账户额度。';
  }
  if (status === 401) return 'API Key 无效或权限不足，请检查所选服务商与 Key 是否匹配。';
  if (status === 403) return '模型 API 访问被拒绝，请检查账户权限和服务地区限制。';
  if (status === 404 || /model_not_found/.test(labels)) return '模型不存在或当前 Key 无访问权限，请检查模型配置。';
  if (status === 429) return 'API 调用太频繁，请稍后再试。';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/.test(labels)
    || /fetch failed|failed to fetch/i.test(messages)) return '无法连接到模型 API 服务器，请检查网络或代理设置。';
  if (/ETIMEDOUT|TimeoutError/.test(labels) || nodes.some(item => /Timeout/.test(item.name || ''))) {
    return '模型响应超时，请稍后重试。';
  }
  if (status === 400) return '模型接口拒绝了请求，请检查模型配置及工具调用支持。';
  return '模型服务调用失败，请稍后重试或检查模型配置。';
}

module.exports = { getProviderErrorMessage };
