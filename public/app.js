const PROVINCES = ['北京','上海','广东','浙江','江苏','山东','河南','河北','湖北','湖南','四川','重庆','福建','安徽','江西','陕西','山西','辽宁','吉林','黑龙江','天津','广西','云南','贵州','甘肃','内蒙古','新疆','海南','宁夏','青海','西藏'];
const PROFILE_META = {
  score: ['分数', value => `${value} 分`],
  rank: ['全省位次', value => `第 ${Number(value).toLocaleString()} 名`],
  province: ['省份', value => value],
  subject: ['科类', value => value === 'science' ? '物理类 / 理科' : '历史类 / 文科'],
  family_income: ['家庭条件', value => ({ low: '压力较大', medium: '普通工薪', high: '支持深造' }[value] || value)],
  interest: ['兴趣方向', value => value],
  city_preference: ['城市偏好', value => value ? '偏好大城市' : '城市不限'],
  postgraduate: ['深造计划', value => value ? '计划考研' : '暂不确定'],
};
const PHASES = { greeting: '准备开始', gathering: '需求梳理', half_analyzing: '初步研判', analyzing: '方案生成', followup: '深度咨询' };
const HISTORY_KEY = 'gaokao_agent_history_v1';
const DOCUMENT_LIMITS = { files: 4, bytes: 5 * 1024 * 1024, characters: 120000, totalCharacters: 240000 };
const SESSION_DOCUMENTS = new Map();

const STATE = {
  sessionId: generateId(),
  messages: [],
  profile: {},
  profileStatus: null,
  phase: 'greeting',
  providerId: localStorage.getItem('gaokao_provider') || '',
  providers: [],
  providerConfigured: false,
  authError: false,
  isProcessing: false,
  activities: [],
  attachments: [],
};

document.addEventListener('DOMContentLoaded', async () => {
  populateProvinces();
  loadApiKey();
  renderStatusAvatars();
  renderProfile();
  renderHistoryList();
  initializeDocumentUpload();
  await loadProviders();
  document.getElementById('chatInput').focus();
});

function generateId() {
  return `sess_${crypto.randomUUID()}`;
}

function populateProvinces() {
  const select = document.getElementById('province');
  PROVINCES.forEach(province => select.add(new Option(province, province)));
}

async function loadProviders() {
  const select = document.getElementById('providerSelect');
  try {
    const response = await fetch('/api/providers');
    const payload = await response.json();
    const providers = payload.data || [];
    STATE.providers = providers;
    providers.forEach(provider => {
      const suffix = provider.configured ? ' · 服务端已配置' : '';
      select.add(new Option(`${provider.name}${suffix}`, provider.id));
    });
    const configured = providers.find(item => item.configured);
    const preferred = providers.find(item => item.id === STATE.providerId);
    const fallback = configured || preferred || providers.find(item => item.id === 'deepseek') || providers[0];
    STATE.providerId = preferred?.id || fallback?.id || '';
    STATE.providerConfigured = !!providers.find(item => item.id === STATE.providerId)?.configured;
    select.value = STATE.providerId;
    renderStatusAvatars();
    updateConnectionStatus(providers.find(item => item.id === STATE.providerId)?.configured);
  } catch (error) {
    select.add(new Option('模型列表不可用', ''));
    updateConnectionStatus(false, '服务未连接');
  }
}

function loadApiKey() {
  const key = localStorage.getItem('gaokao_api_key') || localStorage.getItem('claude_api_key') || '';
  document.getElementById('apiKeyInput').value = key;
}

function getApiKey() {
  return localStorage.getItem('gaokao_api_key') || localStorage.getItem('claude_api_key') || '';
}

function onApiKeyChange(value) {
  const key = value.trim();
  STATE.authError = false;
  if (key) localStorage.setItem('gaokao_api_key', key);
  else localStorage.removeItem('gaokao_api_key');
  renderStatusAvatars();
  updateConnectionStatus(!!key);
}

function onProviderChange(value) {
  STATE.providerId = value;
  STATE.providerConfigured = !!STATE.providers.find(item => item.id === value)?.configured;
  STATE.authError = false;
  renderStatusAvatars();
  localStorage.setItem('gaokao_provider', value);
  updateConnectionStatus(!!getApiKey());
}

function toggleKeyVisibility() {
  const input = document.getElementById('apiKeyInput');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function getAgentAvatarHtml() {
  let src = '/avatar-offline.jpg';
  if (STATE.authError) src = '/avatar-error.jpg';
  else if (getApiKey() || STATE.providerConfigured) src = '/avatar-ai.jpg';
  return `<img src="${src}" alt="启航 Agent">`;
}

function getAgentAvatarSrc() {
  if (STATE.authError) return '/avatar-error.jpg';
  if (getApiKey() || STATE.providerConfigured) return '/avatar-ai.jpg';
  return '/avatar-offline.jpg';
}

function renderStatusAvatars() {
  const src = getAgentAvatarSrc();
  ['brandAvatar', 'welcomeAvatar'].forEach(id => {
    const image = document.querySelector(`#${id} img`);
    if (image) image.src = src;
  });
}

function updateConnectionStatus(available, label) {
  const element = document.getElementById('connectionStatus');
  element.classList.toggle('online', !!available || !!getApiKey());
  element.querySelector('span').textContent = label || (available || getApiKey() ? '模型可用' : '需要 API Key');
}

function selectStarter(text) {
  const input = document.getElementById('chatInput');
  input.value = text;
  resizeComposer(input);
  sendMessage();
}

function handleComposerKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function resizeComposer(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const draftText = input.value;
  const staged = STATE.attachments.filter(item => !item.sent && item.status === 'ready');
  if ((!draftText.trim() && !staged.length) || STATE.isProcessing || isParsingDocuments()) return;
  if (STATE.attachments.some(item => !item.sent && item.status === 'error')) {
    showDocumentNotice('请先移除解析失败的文件，再发送本条消息。');
    return;
  }
  if (getUploadedDocuments().length && !getApiKey() && !STATE.providerConfigured) {
    showDocumentNotice('文档已在浏览器提取文字。请先配置可用模型 API Key，再发送问题以生成文档答案。');
    return;
  }
  const message = draftText.trim() || '请概括这些文档的主要内容，并告诉我可以继续问哪些问题。';
  const clientMessages = getClientMessages();
  let body;
  try {
    body = serializeChatRequest({ message, sessionId: STATE.sessionId, apiKey: getApiKey() || undefined,
      providerId: STATE.providerId || undefined, clientProfile: STATE.profile, clientMessages,
      documents: getUploadedDocuments() });
  } catch (error) {
    showDocumentNotice(error.message);
    return;
  }

  input.value = '';
  resizeComposer(input);
  staged.forEach(item => { item.sent = true; });
  showDocumentNotice('');
  beginProcessing();
  hideWelcome();
  const userMessage = addUserMessage(message, staged.map(attachmentMetadata));
  const pending = addPendingMessage();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || '请求失败');
    STATE.authError = false;
    renderStatusAvatars();
    pending.remove();
    processResponse(payload.data);
  } catch (error) {
    STATE.authError = /API Key|401|403|鉴权|认证/.test(error.message);
    renderStatusAvatars();
    pending.remove();
    userMessage.element.remove();
    STATE.messages = STATE.messages.filter(item => item !== userMessage.record);
    if (!STATE.messages.length) {
      document.getElementById('chatMessages').innerHTML = createWelcomeHtml();
      document.getElementById('threadTitle').textContent = '新咨询';
    }
    staged.forEach(item => { item.sent = false; });
    input.value = draftText;
    resizeComposer(input);
    showDocumentNotice(`发送未完成：${error.message}。文字和文件已保留，可重试。`);
    setAgentStatus('error', '执行失败');
  } finally {
    endProcessing();
  }
}

function beginProcessing() {
  STATE.isProcessing = true;
  document.getElementById('chatInput').disabled = true;
  document.getElementById('sendBtn').disabled = true;
  renderAttachments();
  setAgentStatus('working', 'Agent 运行中');
}

function endProcessing() {
  STATE.isProcessing = false;
  const input = document.getElementById('chatInput');
  input.disabled = false;
  document.getElementById('sendBtn').disabled = isParsingDocuments();
  renderAttachments();
  if (!document.getElementById('chatStatus').classList.contains('error')) setAgentStatus('ready', '就绪');
  input.focus();
}

function setAgentStatus(kind, text) {
  const status = document.getElementById('chatStatus');
  status.className = `agent-status ${kind}`;
  status.querySelector('span').textContent = text;
}

function hideWelcome() {
  const welcome = document.getElementById('welcomeMsg');
  if (welcome) welcome.remove();
}

function addUserMessage(text, attachments = []) {
  const record = { role: 'user', content: text, attachments };
  STATE.messages.push(record);
  const article = document.createElement('article');
  article.className = 'message-row user-row';
  article.innerHTML = renderUserMessage(record);
  appendToConversation(article);
  updateThreadTitle(text);
  return { element: article, record };
}

function attachmentMetadata(entry) {
  const doc = entry.document;
  return { id: entry.id, name: entry.name, type: entry.type, size: entry.size,
    pageCount: entry.type === 'pdf' ? doc.pages.length : undefined,
    charCount: doc.pages.reduce((sum, page) => sum + page.text.length, 0) };
}

function formatFileSize(size) {
  const bytes = Number(size) || 0;
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`;
}

function renderUserMessage(message) {
  const files = (message.attachments || []).map(file => `
    <div class="message-attachment" aria-label="已发送文件：${escapeHtml(file.name)}">
      <span class="attachment-type" aria-hidden="true">${escapeHtml(String(file.type || '').toUpperCase())}</span>
      <div><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${escapeHtml(formatFileSize(file.size))}${file.pageCount ? ` · ${Number(file.pageCount)} 页` : ''} · 已发送</small></div>
    </div>`).join('');
  return `<div class="user-message"><div class="user-message-body"><div class="message-label">你</div>${files ? `<div class="message-attachments">${files}</div>` : ''}<div class="message-bubble">${escapeHtml(message.content)}</div></div><div class="user-avatar"><img src="/avatar-user.jpg" alt="用户头像"></div></div>`;
}

function addPendingMessage() {
  const article = document.createElement('article');
  article.className = 'message-row assistant-row pending-row';
  article.innerHTML = `
      <div class="agent-avatar">${getAgentAvatarHtml()}</div>
    <div class="assistant-content">
      <div class="pending-title">正在分析任务</div>
      <div class="pending-steps"><span></span><span></span><span></span></div>
      <div class="pending-caption">判断是否需要查询数据或更新画像</div>
    </div>`;
  appendToConversation(article);
  return article;
}

function processResponse(data) {
  STATE.profileStatus = data.profileStatus || STATE.profileStatus;
  STATE.profile = data.profile || STATE.profile;
  STATE.phase = data.phase || STATE.phase;
  document.getElementById('phaseLabel').textContent = PHASES[STATE.phase] || STATE.phase;
  renderProfile();
  addActivities(data.agentTrace || []);
  addAssistantMessage(data.message || '本轮没有生成文字回复。', data);
  saveCurrentChat();
}

function addAssistantMessage(text, data = {}) {
  STATE.messages.push({ role: 'assistant', content: text, trace: data.agentTrace || [], documentSources: data.documentSources || [] });
  const article = document.createElement('article');
  article.className = 'message-row assistant-row';

  const trace = renderTrace(data.agentTrace || []);
  const recommendations = renderRecommendationSummary(data.engine);
  article.innerHTML = `
    <div class="agent-avatar">${getAgentAvatarHtml()}</div>
    <div class="assistant-content">
      ${trace}
      <div class="message-copy">${renderMarkdown(text)}</div>
      ${renderDocumentSources(data.documentSources || [])}
      ${recommendations}
      ${renderSuggestions(data.suggestions || [])}
    </div>`;
  appendToConversation(article);
}

function renderTrace(trace) {
  if (!trace.length) return '';
  const items = trace.map(item => `
    <details class="tool-event ${item.status === 'error' ? 'failed' : ''}">
      <summary>
        <i></i><span>${escapeHtml(item.label || item.name)}</span>
        <small>${escapeHtml(item.summary || '')}</small><b>⌄</b>
      </summary>
      <pre>${escapeHtml(JSON.stringify(item.args || {}, null, 2))}</pre>
    </details>`).join('');
  return `<div class="tool-trace"><div class="trace-heading">已完成 ${trace.length} 项操作</div>${items}</div>`;
}

function renderRecommendationSummary(engine) {
  if (!engine) return '';
  const groups = [
    ['冲刺', engine.reach || [], 'reach'],
    ['稳妥', engine.match || [], 'match'],
    ['保底', engine.safety || [], 'safety'],
  ].filter(([, items]) => items.length);
  if (!groups.length) return '';
  return `<div class="decision-grid">${groups.map(([label, items, cls]) => `
    <div class="decision-column ${cls}">
      <span>${label}</span>
      ${items.slice(0, 2).map(item => `<strong>${escapeHtml(item.name)}</strong><small>匹配度 ${item.score}</small>`).join('')}
    </div>`).join('')}</div>`;
}

function renderSuggestions(suggestions) {
  if (!suggestions.length) return '';
  return `<div class="suggestion-row">${suggestions.slice(0, 4).map(text => {
    const title = text.split('——')[0].trim();
    return `<button type="button" onclick="selectStarter(decodeURIComponent('${encodeURIComponent(title)}'))">${escapeHtml(title)}</button>`;
  }).join('')}</div>`;
}

function appendToConversation(element) {
  const container = document.getElementById('chatMessages');
  container.appendChild(element);
  requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }));
}

function addActivities(trace) {
  if (!trace.length) return;
  STATE.activities.push(...trace.map(item => ({ ...item, time: new Date() })));
  STATE.activities = STATE.activities.slice(-20);
  const list = document.getElementById('activityList');
  list.innerHTML = STATE.activities.slice().reverse().map(item => `
    <div class="activity-item ${item.status === 'error' ? 'failed' : ''}">
      <i></i><div><strong>${escapeHtml(item.label || item.name)}</strong><span>${escapeHtml(item.summary || '')}</span></div>
      <time>${item.durationMs || 0}ms</time>
    </div>`).join('');
  document.getElementById('activityCount').textContent = String(STATE.activities.length);
}

function renderProfile() {
  const profile = STATE.profile || {};
  const status = STATE.profileStatus || { percent: 0, filled: [] };
  document.getElementById('profilePercent').textContent = `${status.percent || 0}% 完整`;
  document.getElementById('profileBarFill').style.width = `${status.percent || 0}%`;
  document.getElementById('profileFields').innerHTML = Object.entries(PROFILE_META).map(([key, [label, format]]) => {
    const hasValue = profile[key] !== undefined && profile[key] !== null && profile[key] !== '';
    const value = hasValue ? format(profile[key]) : '待补充';
    return `<div class="profile-row ${hasValue ? 'filled' : ''}"><span>${label}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }).join('');
}

function renderMarkdown(text) {
  const lines = String(text || '').replace(/<!--PROFILE[\s\S]*?-->/g, '').split('\n');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  lines.forEach(raw => {
    const line = raw.trim();
    if (!line) { closeList(); return; }
    if (/^#{1,3}\s/.test(line)) {
      closeList();
      html += `<h3>${formatInline(line.replace(/^#{1,3}\s+/, ''))}</h3>`;
    } else if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${formatInline(line.replace(/^(?:[-*]|\d+\.)\s+/, ''))}</li>`;
    } else if (line.startsWith('→')) {
      closeList();
      html += `<p class="topic-line">${formatInline(line.slice(1).trim())}</p>`;
    } else {
      closeList();
      html += `<p>${formatInline(line)}</p>`;
    }
  });
  closeList();
  return html;
}

function formatInline(text) {
  let safe = escapeHtml(text);
  const links = [];
  safe = safe.replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    return `@@LINK${links.length - 1}@@`;
  });
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  safe = safe.replace(/@@LINK(\d+)@@/g, (_, index) => links[Number(index)]);
  return safe;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function updateThreadTitle(message) {
  if (STATE.messages.filter(item => item.role === 'user').length > 1) return;
  document.getElementById('threadTitle').textContent = message.slice(0, 18) + (message.length > 18 ? '…' : '');
}

function openProfileDialog() {
  Object.keys(PROFILE_META).forEach(key => {
    const input = document.getElementById(key);
    if (input && STATE.profile[key] !== undefined && STATE.profile[key] !== null) input.value = String(STATE.profile[key]);
  });
  document.getElementById('profileDialog').showModal();
}

async function submitQuickMode(event) {
  event.preventDefault();
  if (STATE.isProcessing || isParsingDocuments()) return;
  const student = {
    score: Number(document.getElementById('score').value) || null,
    rank: Number(document.getElementById('rank').value) || null,
    province: document.getElementById('province').value,
    subject: document.getElementById('subject').value,
    family_income: document.getElementById('family_income').value || 'medium',
    interest: document.getElementById('interest').value.trim(),
    city_preference: document.getElementById('city_preference').value === 'true',
    postgraduate: document.getElementById('postgraduate').value === 'true',
  };
  if (!student.score || !student.province || !student.subject) {
    document.getElementById('score').reportValidity();
    return;
  }
  document.getElementById('profileDialog').close();
  hideWelcome();
  beginProcessing();
  addUserMessage(`请按这份画像生成完整方案：${student.province}${student.subject === 'science' ? '物理类' : '历史类'}，${student.score}分${student.rank ? `，位次${student.rank}` : ''}。`);
  const pending = addPendingMessage();
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student, sessionId: STATE.sessionId, apiKey: getApiKey() || undefined, providerId: STATE.providerId || undefined }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || '请求失败');
    pending.remove();
    processResponse(payload.data);
    if (getUploadedDocuments().length) showDocumentNotice('文件已保留，可在聊天中继续提问。');
  } catch (error) {
    pending.remove();
    addAssistantMessage(`画像分析没有完成：${error.message}`, {});
  } finally {
    endProcessing();
  }
}

async function resetChat() {
  if (!canSwitchChat()) return;
  if (STATE.messages.length) saveCurrentChat();
  SESSION_DOCUMENTS.set(STATE.sessionId, STATE.attachments);
  // Switch immediately; a slow reset request must not overwrite a newer consultation.
  const previousSessionId = STATE.sessionId;
  STATE.sessionId = generateId();
  STATE.attachments = [];
  renderAttachments();
  showDocumentNotice('');
  fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: previousSessionId }) }).catch(() => {});
  STATE.messages = [];
  STATE.profile = {};
  STATE.profileStatus = null;
  STATE.activities = [];
  STATE.phase = 'greeting';
  document.getElementById('threadTitle').textContent = '新咨询';
  document.getElementById('phaseLabel').textContent = '需求梳理';
  document.getElementById('activityList').innerHTML = '<div class="activity-empty">工具调用会显示在这里</div>';
  document.getElementById('activityCount').textContent = '0';
  document.getElementById('chatMessages').innerHTML = createWelcomeHtml();
  renderProfile();
  renderHistoryList();
  closeMobilePanels();
}

function createWelcomeHtml() {
  return `<div class="empty-state" id="welcomeMsg"><div class="welcome-avatar" id="welcomeAvatar"><img src="${getAgentAvatarSrc()}" alt="启航 Agent"></div><div class="empty-kicker">GAOKAO DECISION AGENT</div><h1>先说说你的情况</h1><p>分数、位次、省份、选科，知道多少说多少。Agent 会自己补齐问题、查数据并整理方案。</p><div class="starter-grid" id="quickStarters"><button type="button" onclick="selectStarter('我是广东物理类考生，600分，位次大约4万，帮我看看学校和专业')"><span>已有分数和位次</span><small>直接开始匹配学校</small></button><button type="button" onclick="selectStarter('我还不知道适合什么专业，你先通过提问帮我梳理方向')"><span>还没想好专业</span><small>先做方向判断</small></button><button type="button" onclick="selectStarter('家庭条件一般，我更看重就业稳定和投入产出比')"><span>优先考虑就业</span><small>从风险和回报出发</small></button><button type="button" onclick="selectStarter('帮我查一下2026年最新的高考志愿政策变化')"><span>查询最新政策</span><small>使用联网搜索</small></button></div></div>`;
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (_) { return []; }
}

function saveCurrentChat() {
  if (!STATE.messages.length) return;
  const history = getHistory();
  const first = STATE.messages.find(item => item.role === 'user')?.content || '新咨询';
  const record = {
    id: STATE.sessionId,
    title: first.slice(0, 28),
    updatedAt: Date.now(),
    messages: STATE.messages,
    hadDocuments: STATE.attachments.some(item => item.status === 'ready') || STATE.messages.some(item => item.documentSources?.length),
    profile: STATE.profile,
    profileStatus: STATE.profileStatus,
    phase: STATE.phase,
    activities: STATE.activities.map(item => ({ ...item, time: undefined })),
  };
  const next = [record, ...history.filter(item => item.id !== record.id)].slice(0, 20);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    showDocumentNotice('浏览器存储空间不足，本轮记录暂未保存；可导出咨询或删除旧记录后重试。');
  }
  renderHistoryList();
}

function renderHistoryList() {
  const list = document.getElementById('historyList');
  const history = getHistory();
  if (!history.length) {
    list.innerHTML = '<div class="history-empty">还没有咨询记录</div>';
    return;
  }
  list.innerHTML = history.map(item => `<div class="history-item ${item.id === STATE.sessionId ? 'active' : ''}"><button type="button" onclick="loadChat('${item.id}')"><strong>${escapeHtml(item.title)}</strong><span>${formatRelativeTime(item.updatedAt)}</span></button><button class="history-delete" type="button" onclick="deleteChat(event, '${item.id}')" aria-label="删除">×</button></div>`).join('');
}

function loadChat(id) {
  if (!canSwitchChat() || id === STATE.sessionId) return;
  if (id !== STATE.sessionId && STATE.messages.length) saveCurrentChat();
  const record = getHistory().find(item => item.id === id);
  if (!record) return;
  SESSION_DOCUMENTS.set(STATE.sessionId, STATE.attachments);
  STATE.sessionId = record.id;
  STATE.attachments = SESSION_DOCUMENTS.get(record.id) || [];
  renderAttachments();
  showDocumentNotice(record.hadDocuments && !STATE.attachments.length ? '此咨询曾使用文档。刷新后正文不会保留，继续基于文件提问请重新添加。' : '');
  STATE.messages = record.messages || [];
  STATE.profile = record.profile || {};
  STATE.profileStatus = record.profileStatus;
  STATE.phase = record.phase || 'followup';
  STATE.activities = record.activities || [];
  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  STATE.messages.forEach(message => {
    if (message.role === 'user') {
      const article = document.createElement('article');
      article.className = 'message-row user-row';
      article.innerHTML = renderUserMessage(message);
      container.appendChild(article);
    } else {
      const article = document.createElement('article');
      article.className = 'message-row assistant-row';
      article.innerHTML = `<div class="agent-avatar">${getAgentAvatarHtml()}</div><div class="assistant-content">${renderTrace(message.trace || [])}<div class="message-copy">${renderMarkdown(message.content)}</div>${renderDocumentSources(message.documentSources || [])}</div>`;
      container.appendChild(article);
    }
  });
  document.getElementById('threadTitle').textContent = record.title;
  document.getElementById('phaseLabel').textContent = PHASES[STATE.phase] || STATE.phase;
  renderProfile();
  const activities = STATE.activities;
  STATE.activities = [];
  document.getElementById('activityList').innerHTML = '';
  addActivities(activities);
  renderHistoryList();
  closeMobilePanels();
  container.scrollTop = container.scrollHeight;
}

function deleteChat(event, id) {
  event.stopPropagation();
  if (!canSwitchChat()) return;
  SESSION_DOCUMENTS.delete(id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(getHistory().filter(item => item.id !== id)));
  if (id === STATE.sessionId) {
    STATE.messages = [];
    STATE.attachments = [];
    resetChat();
  } else renderHistoryList();
}

function exportCurrentChat() {
  if (!STATE.messages.length) return;
  const body = STATE.messages.map(item => `${item.role === 'user' ? '我' : '启航 Agent'}\n${(item.attachments || []).map(file => `[附件：${file.name} · ${formatFileSize(file.size)}]`).join('\n')}${item.attachments?.length ? '\n' : ''}${item.content}`).join('\n\n');
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `志愿咨询-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function toggleLeftRail() {
  document.getElementById('leftRail').classList.toggle('open');
  document.getElementById('scrim').classList.toggle('show');
}

function toggleContextPanel() {
  document.getElementById('contextPanel').classList.toggle('open');
  document.getElementById('scrim').classList.toggle('show');
}

function closeMobilePanels() {
  document.getElementById('leftRail').classList.remove('open');
  document.getElementById('contextPanel').classList.remove('open');
  document.getElementById('scrim').classList.remove('show');
}

function getUploadedDocuments() {
  return STATE.attachments.filter(item => item.status === 'ready').map(item => item.document);
}

function isParsingDocuments() {
  return STATE.attachments.some(item => item.status === 'parsing');
}

function getClientMessages() {
  const selected = [];
  let characters = 0;
  for (const message of STATE.messages.slice(-20).reverse()) {
    if (!['user', 'assistant'].includes(message.role)) continue;
    const content = String(message.content || '').slice(0, 16000);
    if (characters + content.length > 60000) break;
    selected.unshift({ role: message.role, content });
    characters += content.length;
  }
  return selected;
}

function showDocumentNotice(message) {
  document.getElementById('attachmentNotice').textContent = message;
}

function canSwitchChat() {
  if (!STATE.isProcessing && !isParsingDocuments()) return true;
  showDocumentNotice(STATE.isProcessing ? 'Agent 正在回答，请等待本轮完成后切换咨询。' : '文档正在解析，请等待完成或移除文件后切换咨询。');
  return false;
}

function initializeDocumentUpload() {
  // Native adaptation of the file-only/shared-add flow in Vercel AI Elements PromptInput.
  // Reference: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx
  document.getElementById('documentInput').addEventListener('change', event => {
    addDocuments(Array.from(event.target.files || []));
    event.target.value = '';
  });
  const zone = document.getElementById('documentDropZone');
  let dragDepth = 0;
  const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const clearDrag = () => { dragDepth = 0; zone.classList.remove('dragging'); };
  document.addEventListener('dragenter', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    zone.classList.add('dragging');
  });
  document.addEventListener('dragover', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = STATE.isProcessing || isParsingDocuments() ? 'none' : 'copy';
    zone.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) zone.classList.remove('dragging');
  });
  document.addEventListener('drop', event => {
    clearDrag();
    if (!isFileDrag(event)) return;
    event.preventDefault();
    addDocuments(Array.from(event.dataTransfer.files || []));
  });
  document.addEventListener('dragend', clearDrag);
  window.addEventListener('blur', clearDrag);
  renderAttachments();
}

async function addDocuments(files) {
  if (STATE.isProcessing || isParsingDocuments()) {
    showDocumentNotice('请等待当前处理完成后再添加文件。');
    return;
  }
  showDocumentNotice('');
  const sessionId = STATE.sessionId;
  const entries = [];
  for (const file of files) {
    if (STATE.attachments.length >= DOCUMENT_LIMITS.files) {
      showDocumentNotice('每个咨询最多添加 4 个文件，请先移除不需要的附件。');
      break;
    }
    const type = file.name.split('.').pop().toLowerCase();
    const entry = { id: crypto.randomUUID(), name: file.name, type, size: file.size, sent: false,
      status: 'parsing', progress: null, progressText: '正在读取文件…', error: '', document: null, cancel: null };
    if (!['pdf', 'docx', 'txt', 'md', 'csv'].includes(type)) entry.error = '暂支持 PDF、DOCX、TXT、MD、CSV；XLSX 请先另存为 CSV。';
    else if (file.name.length > 180) entry.error = '文件名过长，请缩短到 180 个字符以内。';
    else if (file.size > DOCUMENT_LIMITS.bytes) entry.error = '超过单文件 5 MB 限制，请拆分后添加。';
    else if (!file.size) entry.error = '文件为空，请选择包含文字的文件。';
    if (entry.error) entry.status = 'error';
    STATE.attachments.push(entry);
    entries.push({ entry, file });
  }
  renderAttachments();
  for (const { entry, file } of entries) {
    if (entry.status !== 'parsing' || !STATE.attachments.includes(entry)) continue;
    try {
      const result = await parseDocumentInWorker(file, entry);
      if (STATE.sessionId !== sessionId || !STATE.attachments.includes(entry)) continue;
      const characters = result.pages.reduce((sum, page) => sum + page.text.length, 0);
      const currentCharacters = getUploadedDocuments().reduce((sum, doc) => sum + doc.pages.reduce((total, page) => total + page.text.length, 0), 0);
      if (currentCharacters + characters > DOCUMENT_LIMITS.totalCharacters) throw new Error('本咨询正文总计超过 24 万字符，请移除部分文档后重新添加。');
      entry.document = { id: entry.id, name: entry.name, type: entry.type, size: entry.size, pages: result.pages, warnings: result.warnings || [] };
      entry.status = 'ready';
    } catch (error) {
      if (STATE.attachments.includes(entry)) {
        entry.status = 'error';
        entry.error = error.message || '文档解析失败，请重试。';
      }
    } finally {
      entry.cancel = null;
      renderAttachments();
    }
  }
}

function parseDocumentInWorker(file, entry) {
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker?.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    entry.cancel = () => finish(new Error('已取消解析'));
    try {
      worker = new Worker('/document-parser.js');
      timer = setTimeout(() => finish(new Error('解析超过 30 秒，请拆分文档后重试。')), 30000);
      worker.onmessage = ({ data }) => {
        if (data?.kind === 'gaokao-document-progress') {
          if (!STATE.attachments.includes(entry)) return;
          entry.progress = Number.isFinite(data.percent) ? Math.min(100, Math.max(0, data.percent)) : null;
          entry.progressText = data.label || '正在提取文字…';
          renderAttachments();
          return;
        }
        // PDF.js also emits its own Worker handshake; only our result completes parsing.
        if (data?.kind !== 'gaokao-document-result') return;
        data.ok ? finish(null, data) : finish(new Error(data.error));
      };
      worker.onerror = () => finish(new Error('文档解析器无法运行，请刷新后重试，或更新浏览器。'));
      file.arrayBuffer().then(buffer => {
        if (!settled) worker.postMessage({ buffer, type: entry.type, size: entry.size }, [buffer]);
      }).catch(() => finish(new Error('无法读取文件，请重新选择。')));
    } catch {
      finish(new Error('当前浏览器不支持文档解析，请更新浏览器后重试。'));
    }
  });
}

function removeAttachment(id) {
  if (STATE.isProcessing) return;
  const entry = STATE.attachments.find(item => item.id === id);
  entry?.cancel?.();
  STATE.attachments = STATE.attachments.filter(item => item.id !== id);
  renderAttachments();
  showDocumentNotice('');
}

function renderAttachments() {
  const list = document.getElementById('attachmentList');
  if (!list) return;
  const staged = STATE.attachments.filter(item => !item.sent);
  list.innerHTML = staged.map(item => {
    const status = item.status === 'parsing' ? item.progressText : item.status === 'error' ? item.error
      : `待发送 · ${formatFileSize(item.size)}${item.type === 'pdf' ? ` · ${item.document.pages.length} 页` : ''}`;
    const warnings = item.document?.warnings || [];
    const progress = item.status === 'parsing' ? `<div class="attachment-progress ${item.progress === null ? 'indeterminate' : ''}" role="progressbar" aria-label="${escapeHtml(item.name)}解析进度" ${item.progress !== null ? `aria-valuenow="${item.progress}" aria-valuemin="0" aria-valuemax="100"` : ''}><i style="width:${item.progress === null ? 35 : item.progress}%"></i></div>` : '';
    return `<div class="attachment-item ${item.status}"><span class="attachment-type">${escapeHtml(item.type.toUpperCase())}</span><div class="attachment-info"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><span>${escapeHtml(status)}</span>${progress}${warnings.map(warning => `<small>${escapeHtml(warning)}</small>`).join('')}</div><button type="button" onclick="removeAttachment('${item.id}')" ${STATE.isProcessing ? 'disabled' : ''} aria-label="移除 ${escapeHtml(item.name)}" title="移除文件">×</button></div>`;
  }).join('');
  const sent = STATE.attachments.filter(item => item.sent && item.status === 'ready');
  const sessionPanel = document.getElementById('sessionDocuments');
  sessionPanel.hidden = !sent.length;
  document.getElementById('sessionDocumentCount').textContent = String(sent.length);
  document.getElementById('sessionDocumentList').innerHTML = sent.map(item => `<div class="session-document"><span class="attachment-type" aria-hidden="true">${escapeHtml(item.type.toUpperCase())}</span><span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}<small>${escapeHtml(formatFileSize(item.size))}</small></span><button class="icon-button" type="button" onclick="removeAttachment('${item.id}')" ${STATE.isProcessing ? 'disabled' : ''} aria-label="停止使用 ${escapeHtml(item.name)}" title="停止在后续提问中使用">×</button></div>`).join('');
  const busy = STATE.isProcessing || isParsingDocuments();
  document.getElementById('attachBtn').disabled = busy;
  document.getElementById('documentInput').disabled = busy;
  document.getElementById('sendBtn').disabled = busy;
}

function renderDocumentSources(sources) {
  if (!Array.isArray(sources) || !sources.length) return '';
  return `<div class="document-sources"><div class="source-heading">本轮参考片段 · 展开核对原文</div>${sources.map(source => {
    const location = source.location || (source.pageNumber ? `第 ${source.pageNumber} 页` : `文本块 ${source.chunkId || ''}`);
    return `<details class="document-source"><summary><span>${escapeHtml(source.name)}</span><small>${escapeHtml(location)}</small><b>⌄</b></summary><blockquote>${escapeHtml(source.excerpt || '')}</blockquote></details>`;
  }).join('')}</div>`;
}

function serializeChatRequest(payload) {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > 1.8 * 1024 * 1024) {
    throw new Error('本轮请求过大，请减少附件或新建咨询后重试。');
  }
  return body;
}
