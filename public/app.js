// public/app.js
// V3: AI 高考规划师 · 启发式对话前端

const STATE = {
  sessionId: generateId(),
  profileStatus: null,
  engineData: null,
  recommendations: null,
  schoolsData: null,
  phase: 'greeting',
  isProcessing: false,
  hasGreeted: false,
  authError: false
};

// ========== 头像 ==========

function getAvatarHtml() {
  const hasKey = !!getApiKey();
  let src;
  if (!hasKey) {
    src = '/avatar-offline.jpg';
  } else if (STATE.authError) {
    src = '/avatar-error.jpg';
  } else {
    src = '/avatar-ai.jpg';
  }
  return `<img src="${src}" class="avatar-img" alt="峰哥">`;
}

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
  loadApiKey();
  document.getElementById('chatInput').focus();
  updateStaticAvatars();
  renderHistoryList();

  // 移动端：点击聊天区域关闭侧栏
  document.querySelector('.chat-main').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
    }
  });
});

function generateId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function updateStaticAvatars() {
  const html = getAvatarHtml();
  document.querySelectorAll('.avatar-static').forEach(el => {
    el.innerHTML = html;
  });
}

// ========== API Key ==========

function loadApiKey() {
  const saved = localStorage.getItem('claude_api_key');
  if (saved) {
    document.getElementById('apiKeyInput').value = saved;
    updateModeBadge(true);
    // 有 key 且还没打过招呼 → 自动触发 AI 打招呼
    if (!STATE.hasGreeted) {
      setTimeout(() => autoGreet(), 500);
    }
  }
}

function onApiKeyChange(value) {
  const key = value.trim();
  STATE.authError = false;
  if (key) {
    localStorage.setItem('claude_api_key', key);
    updateModeBadge(true);
    updateStaticAvatars();
    if (!STATE.hasGreeted) {
      autoGreet();
    }
  } else {
    localStorage.removeItem('claude_api_key');
    updateModeBadge(false);
    updateStaticAvatars();
  }
}

function getApiKey() {
  return localStorage.getItem('claude_api_key') || '';
}

// ========== 自动打招呼 ==========

async function autoGreet() {
  if (STATE.hasGreeted || STATE.isProcessing) return;
  STATE.hasGreeted = true;
  STATE.isProcessing = true;

  updateChatStatus('🤔 AI 正在准备...');

  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      STATE.isProcessing = false;
      updateChatStatus('👋 输入 Key 开始');
      return;
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: STATE.sessionId, apiKey })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || err.error || '请求失败');
    }

    const result = await response.json();
    processResponse(result.data);
    updateChatStatus('💬 聊天中');
  } catch (error) {
    console.log('[autoGreet]', error.message);
    if (isAuthError(error)) handleAuthError();
    updateChatStatus('👋 开始对话');
  }

  STATE.isProcessing = false;
}

// ========== 快捷入口 ==========

function selectStarter(text) {
  const input = document.getElementById('chatInput');
  input.value = text;
  sendMessage();
}

// ========== 主发送逻辑 ==========

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || STATE.isProcessing) return;

  // 首次发送消息后隐藏快捷入口
  const starters = document.getElementById('quickStarters');
  if (starters) starters.style.display = 'none';

  input.value = '';
  STATE.isProcessing = true;
  input.disabled = true;

  updateChatStatus('🤔 思考中...');

  // 如果是第一条消息，隐藏欢迎语
  const welcome = document.getElementById('welcomeMsg');
  if (welcome) welcome.style.display = 'none';

  addMessage('user', message);
  const loadingMsg = addLoadingMessage();

  try {
    const apiKey = getApiKey();

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        sessionId: STATE.sessionId,
        apiKey: apiKey || undefined
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || err.error || '请求失败');
    }

    const result = await response.json();
    loadingMsg.remove();
    processResponse(result.data);
    updateChatStatus('💬 聊天中');
  } catch (error) {
    loadingMsg.remove();
    if (isAuthError(error)) handleAuthError();
    addMessage('assistant', '抱歉，出了一点问题：' + error.message +
      '\n\n请确认服务器已启动（npm start），API Key 是否正确。');
    updateChatStatus('⚠️ 出错');
  }

  STATE.isProcessing = false;
  input.disabled = false;
  input.focus();
}

// ========== 响应处理 ==========

function processResponse(data) {
  STATE.authError = false;
  STATE.profileStatus = data.profileStatus;
  STATE.phase = data.phase;
  STATE.engineData = data.engine;
  STATE.recommendations = data.recommendations;
  STATE.schoolsData = data.schools;

  // 渲染消息（含可能的话题 chips 和引擎卡片）
  addAssistantMessage(data.message, data.suggestions || [],
    data.engineReady && data.engine, data.recommendations, data.schools);

  // 更新画像指示器
  if (data.profileStatus) {
    updateProfileIndicator(data.profileStatus);
  }

  // 如果引擎刚给出结果，更新状态
  if (data.engineReady && data.engine) {
    updateChatStatus('📊 分析完成 · 继续聊');
  }

  // 自动保存到本地历史
  saveCurrentToHistory();
  renderHistoryList();

  // 滚动到底部
  scrollToBottom();
}

// ========== 消息渲染 ==========

function addMessage(role, text) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `
    <div class="message-avatar">${role === 'assistant' ? getAvatarHtml() : '<img src="/avatar-user.jpg" class="avatar-img" alt="我">'}</div>
    <div class="message-body">
      <div class="message-text">${escapeHtml(text)}</div>
    </div>`;
  container.appendChild(div);
  scrollToBottom();
  return div;
}

function addAssistantMessage(text, suggestions, engineData, recommendations, schoolsData) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'message assistant';

  let bodyHtml = `<div class="message-text">${escapeHtml(text)}</div>`;

  // 话题建议 chips
  if (suggestions && suggestions.length > 0) {
    bodyHtml += '<div class="suggestions-container">';
    bodyHtml += '<div class="suggestions-label">💡 点击话题继续聊：</div>';
    bodyHtml += '<div class="suggestions-chips">';
    for (const s of suggestions) {
      // 拆分话题名和解释（用 —— 分隔）
      const parts = s.split(/[—\-]{1,2}/);
      const title = parts[0].trim();
      const desc = parts.length > 1 ? parts.slice(1).join('—').trim() : '';
      bodyHtml += `
        <div class="suggestion-chip" onclick="selectTopic('${escapeAttr(s)}')" title="${escapeAttr(desc)}">
          ${escapeHtml(title)}
          ${desc ? `<span class="chip-desc">${escapeHtml(desc)}</span>` : ''}
        </div>`;
    }
    bodyHtml += '</div></div>';
  }

  // 引擎结果卡片
  if (engineData) {
    bodyHtml += buildRecommendCards(engineData);
  }
  if (recommendations && recommendations.school_layer) {
    bodyHtml += buildV2SchoolCards(recommendations);
  }
  if (recommendations && recommendations.risk_layer) {
    bodyHtml += buildRiskCards(recommendations.risk_layer);
    bodyHtml += buildSummary(recommendations);
  }
  if (schoolsData && Object.keys(schoolsData).length > 0 &&
      !(recommendations && recommendations.school_layer)) {
    bodyHtml += buildSchoolCards(schoolsData);
  }

  div.innerHTML = `
    <div class="message-avatar">${getAvatarHtml()}</div>
    <div class="message-body">${bodyHtml}</div>`;
  container.appendChild(div);
  scrollToBottom();
  return div;
}

function addLoadingMessage() {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'loadingMsg';
  div.innerHTML = `
    <div class="message-avatar">${getAvatarHtml()}</div>
    <div class="message-body">
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>`;
  container.appendChild(div);
  scrollToBottom();
  return div;
}

// ========== 话题选择 ==========

function selectTopic(topic) {
  const input = document.getElementById('chatInput');
  // 只取话题名（破折号之前的部分）
  const parts = topic.split(/[—\-]{1,2}/);
  const title = parts[0].trim();
  input.value = title;
  input.focus();
  // 不自动发送，让用户决定要不要加什么再发
}

// ========== 画像指示器 ==========

function updateProfileIndicator(status) {
  if (!status) return;

  const indicator = document.getElementById('profileIndicator');
  indicator.style.display = 'block';

  const barFill = document.getElementById('profileBarFill');
  barFill.style.width = status.percent + '%';

  const fieldsDiv = document.getElementById('profileFields');
  const allFields = [
    { key: 'score', label: '分数' },
    { key: 'province', label: '省份' },
    { key: 'subject', label: '科类' },
    { key: 'family_income', label: '家庭条件' },
    { key: 'rank', label: '排名' },
    { key: 'interest', label: '兴趣' },
    { key: 'city_preference', label: '城市偏好' },
    { key: 'postgraduate', label: '考研计划' }
  ];

  let html = '';
  for (const f of allFields) {
    const isFilled = status.filled && status.filled.includes(f.key);
    html += `<div class="profile-field ${isFilled ? 'filled' : ''}">${isFilled ? '✅' : '⏳'} ${f.label}</div>`;
  }
  fieldsDiv.innerHTML = html;
}

// ========== 侧边栏 & 快速模式 ==========

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function toggleQuickMode() {
  const form = document.getElementById('studentForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function submitQuickMode() {
  if (STATE.isProcessing) return;

  const student = {
    score: parseInt(document.getElementById('score').value) || 0,
    province: document.getElementById('province').value,
    rank: parseInt(document.getElementById('rank').value) || 0,
    subject: document.getElementById('subject').value,
    family_income: document.getElementById('family_income').value,
    interest: document.getElementById('interest').value.trim(),
    city_preference: document.getElementById('city_preference').value === 'true',
    postgraduate: document.getElementById('postgraduate').value === 'true'
  };

  if (!student.score || !student.province || !student.subject || !student.family_income) {
    alert('请填写分数、省份、科类、家庭经济条件');
    return;
  }

  STATE.isProcessing = true;
  const btn = document.getElementById('quickSubmitBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 分析中...';

  // 隐藏表单
  document.getElementById('studentForm').style.display = 'none';
  const welcome = document.getElementById('welcomeMsg');
  if (welcome) welcome.style.display = 'none';

  addMessage('user', formatStudentInfo(student));
  const loadingMsg = addLoadingMessage();
  updateChatStatus('🤔 分析中...');

  try {
    const apiKey = getApiKey();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student,
        sessionId: STATE.sessionId,
        apiKey: apiKey || undefined
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || err.error || '请求失败');
    }

    const result = await response.json();
    loadingMsg.remove();
    processResponse(result.data);
    updateChatStatus('📊 分析完成 · 继续聊');
  } catch (error) {
    loadingMsg.remove();
    if (isAuthError(error)) handleAuthError();
    addMessage('assistant', '分析失败：' + error.message);
    updateChatStatus('⚠️ 出错');
  }

  STATE.isProcessing = false;
  btn.disabled = false;
  btn.textContent = '🚀 快速分析';
}

// ========== 重置 ==========

async function resetChat() {
  // 先保存当前会话到历史
  saveCurrentToHistory();

  STATE.sessionId = generateId();
  STATE.profileStatus = null;
  STATE.engineData = null;
  STATE.recommendations = null;
  STATE.schoolsData = null;
  STATE.phase = 'greeting';
  STATE.isProcessing = false;
  STATE.hasGreeted = false;
  STATE.authError = false;

  const container = document.getElementById('chatMessages');
  container.innerHTML = `
    <div class="message assistant" id="welcomeMsg">
      <div class="message-avatar avatar-static"></div>
      <div class="message-body">
        <div class="message-text">
          <strong>同学你好，我是峰哥。</strong><br><br>
          做了十年高考志愿规划，见过太多人选错路后悔。<br><br>
          咱们就像聊天一样——你告诉我孩子的情况，我帮你分析。有什么说什么，想哪儿聊哪儿。
        </div>
      </div>
    </div>`;

  document.getElementById('profileIndicator').style.display = 'none';
  document.getElementById('studentForm').style.display = 'none';
  document.getElementById('chatInput').value = '';
  document.getElementById('chatInput').disabled = false;
  updateChatStatus('👋 新对话');
  updateStaticAvatars();
  updateModeBadge(!!getApiKey() && !STATE.authError);
  renderHistoryList();

  // 清除服务端会话
  try {
    await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: STATE.sessionId })
    });
  } catch (e) {}

  // 重新打招呼
  if (getApiKey()) {
    setTimeout(() => autoGreet(), 300);
  }
}

// ========== 状态指示 ==========

function updateChatStatus(text) {
  document.getElementById('chatStatus').textContent = text;
}

function updateModeBadge(online) {
  const badge = document.getElementById('modeBadge');
  if (online) {
    badge.textContent = 'AI 在线';
    badge.className = 'mode-badge online';
  } else {
    badge.textContent = '离线模式';
    badge.className = 'mode-badge';
  }
}

function handleAuthError() {
  STATE.authError = true;
  updateModeBadge(false);
  updateStaticAvatars();
  updateChatStatus('🔑 Key 无效，请检查');
}

function isAuthError(error) {
  const msg = error.message || '';
  return /401|403|无效|Key|API key/i.test(msg);
}

// ========== 本地历史记录 ==========

const HISTORY_KEY = 'gaokao_chat_history';
const MSG_PREFIX = 'gaokao_msgs_';

function getHistoryList() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch (e) { return []; }
}

function saveHistoryList(list) {
  // 最多保留 20 条
  const trimmed = list.slice(0, 20);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

function saveCurrentToHistory() {
  const container = document.getElementById('chatMessages');
  const msgs = [];
  container.querySelectorAll('.message').forEach(el => {
    const role = el.classList.contains('user') ? 'user' : 'assistant';
    const textEl = el.querySelector('.message-text');
    if (textEl) msgs.push({ role, text: textEl.textContent });
  });
  // 至少要有用户消息才保存
  if (!msgs.some(m => m.role === 'user')) return;

  const list = getHistoryList();
  const title = msgs.find(m => m.role === 'user')?.text?.slice(0, 30) || '空对话';
  const entry = {
    id: STATE.sessionId,
    title,
    date: new Date().toLocaleString('zh-CN'),
    timestamp: Date.now(),
    phase: STATE.phase
  };
  // 去重
  const filtered = list.filter(e => e.id !== STATE.sessionId);
  filtered.unshift(entry);
  saveHistoryList(filtered);
  // 存消息
  localStorage.setItem(MSG_PREFIX + STATE.sessionId, JSON.stringify(msgs));
}

function loadSession(sessionId) {
  const raw = localStorage.getItem(MSG_PREFIX + sessionId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function switchToSession(sessionId) {
  if (sessionId === STATE.sessionId) return;
  const msgs = loadSession(sessionId);
  if (!msgs) return;

  // 保存当前会话
  saveCurrentToHistory();

  STATE.sessionId = sessionId;
  STATE.profileStatus = null;
  STATE.engineData = null;
  STATE.recommendations = null;
  STATE.schoolsData = null;
  STATE.phase = 'followup';
  STATE.isProcessing = false;
  STATE.hasGreeted = true;

  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  for (const m of msgs) {
    addMessage(m.role, m.text);
  }

  document.getElementById('profileIndicator').style.display = 'none';
  document.getElementById('studentForm').style.display = 'none';
  document.getElementById('chatInput').value = '';
  document.getElementById('chatInput').disabled = false;
  updateChatStatus('📂 历史记录');
  renderHistoryList();
  scrollToBottom();
}

function deleteHistory(sessionId, event) {
  event.stopPropagation();
  const list = getHistoryList().filter(e => e.id !== sessionId);
  saveHistoryList(list);
  localStorage.removeItem(MSG_PREFIX + sessionId);
  if (sessionId === STATE.sessionId) {
    resetChat();
  }
  renderHistoryList();
}

function exportCurrentChat() {
  const container = document.getElementById('chatMessages');
  let text = '高考志愿规划师 · 对话记录\n';
  text += `导出时间：${new Date().toLocaleString('zh-CN')}\n`;
  text += '='.repeat(40) + '\n\n';

  container.querySelectorAll('.message').forEach((el, i) => {
    const role = el.classList.contains('user') ? '👤 我' : '🧭 AI规划师';
    const textEl = el.querySelector('.message-text');
    if (textEl) {
      text += `${role}:\n${textEl.textContent}\n\n`;
    }
  });

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `高考志愿咨询_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderHistoryList() {
  const el = document.getElementById('historyList');
  if (!el) return;
  const list = getHistoryList();

  if (list.length === 0) {
    el.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    return;
  }

  el.innerHTML = list.map(e => `
    <div class="history-item ${e.id === STATE.sessionId ? 'active' : ''}" onclick="switchToSession('${e.id}')">
      <div class="history-item-title">${escapeHtml(e.title)}</div>
      <div class="history-item-date">${e.date}</div>
      <button class="history-item-del" onclick="deleteHistory('${e.id}', event)" title="删除">×</button>
    </div>
  `).join('');
}

// ========== 引擎结果卡片（从 V2 保留）==========

function buildRecommendCards(engine) {
  if (!engine) return '';

  const sections = [
    { key: 'reach', label: '🔥 冲刺', cls: 'reach', data: engine.reach },
    { key: 'match', label: '⚖️ 稳妥', cls: 'match', data: engine.match },
    { key: 'safety', label: '🛡️ 保底', cls: 'safety', data: engine.safety },
    { key: 'avoid', label: '⚠️ 不建议', cls: 'avoid', data: engine.avoid }
  ];

  let html = '<div class="recommend-cards">';
  for (const sec of sections) {
    if (!sec.data || sec.data.length === 0) continue;
    html += `<div class="rec-section-title">${sec.label}</div>`;
    html += '<div class="rec-cards-row">';
    for (const m of sec.data) {
      html += `
        <div class="rec-card ${sec.cls}">
          <div class="major-name">${escapeHtml(m.name)}</div>
          <div class="major-meta">
            <span>${escapeHtml(m.category || '')}</span>
            <span>得分 ${m.score}</span>
            ${m.risk ? `<span>AI风险: ${m.risk}</span>` : ''}
          </div>
          ${m.quote ? `<div class="major-quote">💬 ${escapeHtml(m.quote)}</div>` : ''}
        </div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function buildSchoolCards(schoolsData) {
  let html = '<div class="recommend-cards">';
  html += '<div class="rec-section-title" style="color:#7c3aed;">🏫 可报考学校参考</div>';

  for (const [majorId, data] of Object.entries(schoolsData)) {
    if (!data.reach?.length && !data.match?.length && !data.safety?.length) continue;

    html += `<div style="font-weight:600;font-size:14px;margin:8px 0 4px;color:#4c1d95;">📚 ${escapeHtml(data.major_name)}</div>`;
    html += '<div class="rec-cards-row">';

    const allSchools = [
      ...(data.reach || []).map(s => ({ ...s, tier: 'reach' })),
      ...(data.match || []).map(s => ({ ...s, tier: 'match' })),
      ...(data.safety || []).map(s => ({ ...s, tier: 'safety' }))
    ];

    for (const s of allSchools) {
      const tierLabel = s.tier === 'reach' ? '🔥冲' : s.tier === 'match' ? '⚖️稳' : '🛡️保';
      const tierCls = s.tier === 'reach' ? 'reach' : s.tier === 'match' ? 'match' : 'safety';
      html += `
        <div class="rec-card ${tierCls}">
          <div class="major-name">${escapeHtml(s.school_name)}</div>
          <div class="major-meta">
            <span>${escapeHtml(s.school_level || '')}</span>
            <span>${escapeHtml(s.school_city || '')}</span>
          </div>
          <div class="major-meta" style="margin-top:2px;">
            <span>最低 ${s.min_score} 分</span>
            ${s.min_rank ? `<span>位次 ${s.min_rank}</span>` : ''}
            <span>${tierLabel} · ${s.confidence}</span>
          </div>
        </div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function buildV2SchoolCards(recommendations) {
  let html = '<div class="recommend-cards">';
  html += '<div class="rec-section-title" style="color:#7c3aed;">🏫 位次匹配 · 可报考学校</div>';

  for (const sm of (recommendations.school_layer || []).slice(0, 4)) {
    const all = [
      ...(sm.schools.reach || []).map(s => ({ ...s, tier: 'reach' })),
      ...(sm.schools.match || []).map(s => ({ ...s, tier: 'match' })),
      ...(sm.schools.safety || []).map(s => ({ ...s, tier: 'safety' }))
    ];
    if (all.length === 0) continue;

    html += `<div style="font-weight:600;font-size:14px;margin:8px 0 4px;color:#4c1d95;">📚 ${escapeHtml(sm.major_name)} <span style="font-weight:400;font-size:12px;color:#888;">匹配度 ${sm.major_score}分</span></div>`;
    html += '<div class="rec-cards-row">';

    for (const s of all) {
      const tierLabel = s.tier === 'reach' ? '🔥冲' : s.tier === 'match' ? '⚖️稳' : '🛡️保';
      const tierCls = s.tier;
      html += `
        <div class="rec-card ${tierCls}">
          <div class="major-name">${escapeHtml(s.school_name)} <span style="font-size:12px;color:#888;font-weight:400;">${escapeHtml(s.school_level || '')}</span></div>
          <div class="major-meta">
            <span>📍 ${escapeHtml(s.school_city || '')}</span>
            <span>📊 位次 ${s.min_rank || '?'}</span>
          </div>
          <div class="major-meta" style="margin-top:4px;">
            <span style="font-weight:700;color:${s.admission_probability >= 70 ? '#059669' : s.admission_probability >= 40 ? '#d97706' : '#dc2626'}">录取概率 ${s.admission_probability}%</span>
            <span>${tierLabel}</span>
          </div>
          ${s.rank_trend ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">${s.rank_trend}</div>` : ''}
        </div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function buildRiskCards(riskLayer) {
  if (!riskLayer.risks || riskLayer.risks.length === 0) return '';

  let html = '<div class="recommend-cards">';
  html += '<div class="rec-section-title" style="color:#dc2626;">⚠️ 风险分析</div>';
  html += '<div class="rec-cards-row">';

  for (const r of riskLayer.risks.slice(0, 5)) {
    const riskColor = r.risk_score <= 3 ? '#059669' : r.risk_score <= 5 ? '#d97706' : '#dc2626';
    html += `
      <div class="rec-card" style="border-left-color:${riskColor};background:#fef2f2;">
        <div class="major-name">${escapeHtml(r.major_name)}</div>
        <div class="major-meta">
          <span style="color:${riskColor};font-weight:700;">${r.risk_level} (${r.risk_score}/10)</span>
        </div>
        ${r.warnings && r.warnings.length > 0 ? r.warnings.map(w => `<div style="font-size:12px;color:#6b7280;margin-top:3px;">• ${escapeHtml(w)}</div>`).join('') : ''}
      </div>`;
  }
  html += '</div></div>';
  return html;
}

function buildSummary(data) {
  if (!data.summary) return '';
  return `<div style="margin-top:12px;padding:12px 16px;background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0;font-size:14px;font-weight:600;color:#166534;">📋 ${escapeHtml(data.summary)}</div>`;
}

// ========== 工具函数 ==========

function formatStudentInfo(s) {
  const parts = [];
  parts.push(`${s.score}分`);
  parts.push(s.province);
  if (s.rank) parts.push(`排名${s.rank}`);
  parts.push(s.subject === 'science' ? '理科' : '文科');
  parts.push(s.family_income === 'low' ? '家庭条件一般' :
             s.family_income === 'medium' ? '家庭条件中等' : '家庭条件较好');
  if (s.interest) parts.push(`兴趣：${s.interest}`);
  parts.push(s.city_preference ? '想去大城市' : '城市不限');
  parts.push(s.postgraduate ? '计划考研' : '暂无考研计划');
  return parts.join(' · ');
}

function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  if (!text) return '';
  return text.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
