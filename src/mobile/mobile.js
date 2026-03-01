/* ClaudeCount Mobile — Vanilla JS client */
(function () {
  'use strict';

  // --- Config ---
  const WS_RECONNECT_BASE_MS = 1000;
  const WS_RECONNECT_MAX_MS = 30000;
  const DURATION_UPDATE_MS = 1000;

  // --- State ---
  let token = localStorage.getItem('cc_token') || '';
  let agents = [];
  let ws = null;
  let wsRetries = 0;
  let wsConnected = false;
  let currentPid = null; // detail view
  let detailLogs = [];
  let durationTimers = new Map();
  let detailPollTimer = null;

  // --- DOM refs ---
  const authScreen = document.getElementById('auth-screen');
  const listScreen = document.getElementById('list-screen');
  const detailScreen = document.getElementById('detail-screen');
  const tokenInput = document.getElementById('token-input');
  const authBtn = document.getElementById('auth-btn');
  const authError = document.getElementById('auth-error');
  const agentList = document.getElementById('agent-list');
  const listEmpty = document.getElementById('list-empty');
  const agentCountEl = document.getElementById('agent-count');
  const wsDotEl = document.getElementById('ws-dot');
  const backBtn = document.getElementById('back-btn');
  const detailDot = document.getElementById('detail-dot');
  const detailPid = document.getElementById('detail-pid');
  const detailStatus = document.getElementById('detail-status');
  const detailMeta = document.getElementById('detail-meta');
  const logViewer = document.getElementById('log-viewer');
  const logCountEl = document.getElementById('log-count');
  const autoScrollCb = document.getElementById('auto-scroll');
  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');
  const sendStatus = document.getElementById('send-status');

  // --- Helpers ---
  function apiUrl(path) {
    return window.location.origin + '/api' + path;
  }

  function apiHeaders() {
    return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(apiUrl(path), {
      headers: apiHeaders(),
      ...opts,
    });
    if (res.status === 401) {
      showScreen('auth');
      throw new Error('Unauthorized');
    }
    return res;
  }

  function formatDuration(startTime) {
    if (!startTime) return '--';
    const ms = Date.now() - new Date(startTime).getTime();
    if (ms < 0) return '0s';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(sec).padStart(2, '0') + 's';
    if (m > 0) return m + 'm ' + String(sec).padStart(2, '0') + 's';
    return sec + 's';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Screen management ---
  function showScreen(name) {
    authScreen.classList.toggle('active', name === 'auth');
    listScreen.classList.toggle('active', name === 'list');
    detailScreen.classList.toggle('active', name === 'detail');

    if (name !== 'detail') {
      currentPid = null;
      detailLogs = [];
      if (detailPollTimer) { clearInterval(detailPollTimer); detailPollTimer = null; }
    }
  }

  // --- Auth ---
  function checkUrlToken() {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      token = urlToken;
      localStorage.setItem('cc_token', token);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  async function authenticate(t) {
    token = t;
    try {
      const res = await fetch(apiUrl('/version'), {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (res.ok) {
        localStorage.setItem('cc_token', token);
        authError.textContent = '';
        showScreen('list');
        connectWs();
        fetchAgents();
        return true;
      }
      authError.textContent = 'Invalid token';
      return false;
    } catch (err) {
      authError.textContent = 'Connection failed';
      return false;
    }
  }

  authBtn.addEventListener('click', () => {
    const t = tokenInput.value.trim();
    if (!t) { authError.textContent = 'Token is required'; return; }
    authenticate(t);
  });

  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') authBtn.click();
  });

  // --- WebSocket ---
  function wsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + window.location.host + '/?token=' + encodeURIComponent(token);
  }

  function connectWs() {
    if (ws) { try { ws.close(); } catch { } }

    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      wsConnected = true;
      wsRetries = 0;
      wsDotEl.className = 'ws-dot connected';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch { }
    };

    ws.onclose = () => {
      wsConnected = false;
      wsDotEl.className = 'ws-dot disconnected';
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  function scheduleReconnect() {
    const delay = Math.min(WS_RECONNECT_BASE_MS * Math.pow(2, wsRetries), WS_RECONNECT_MAX_MS);
    wsRetries++;
    setTimeout(() => {
      if (!wsConnected && token) connectWs();
    }, delay);
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'agents:updated':
        agents = msg.data.agents || [];
        renderAgentList();
        // If viewing a detail, update the header
        if (currentPid !== null) updateDetailHeader();
        break;

      case 'agent:log-line':
        if (msg.data.pid === currentPid) {
          detailLogs.push(msg.data.line);
          appendLogEntry(msg.data.line);
        }
        // Update log count on card
        updateCardLogCount(msg.data.pid);
        break;

      case 'monitor:degraded':
        // Could show a warning
        break;
    }
  }

  // --- Agent List ---
  async function fetchAgents() {
    try {
      const res = await apiFetch('/agents');
      agents = await res.json();
      renderAgentList();
    } catch { }
  }

  function renderAgentList() {
    const active = agents.filter(a => a.status === 'active').length;
    const total = agents.length;
    agentCountEl.textContent = active === total
      ? `${active} agent${active !== 1 ? 's' : ''}`
      : `${active} active / ${total} total`;

    if (total === 0) {
      agentList.innerHTML = '';
      listEmpty.classList.add('visible');
      clearDurationTimers();
      return;
    }
    listEmpty.classList.remove('visible');

    // Diff: update existing, add new, remove stale
    const currentPids = new Set(agents.map(a => a.pid));
    const existingCards = agentList.querySelectorAll('.m-agent-card');
    const existingPids = new Set();
    existingCards.forEach(c => existingPids.add(parseInt(c.dataset.pid, 10)));

    // Remove stale
    existingCards.forEach(c => {
      const pid = parseInt(c.dataset.pid, 10);
      if (!currentPids.has(pid)) {
        c.remove();
        stopDurationTimer(pid);
      }
    });

    // Update or create
    for (const agent of agents) {
      const existing = agentList.querySelector(`.m-agent-card[data-pid="${agent.pid}"]`);
      if (existing) {
        updateCard(existing, agent);
      } else {
        const card = createCard(agent);
        agentList.appendChild(card);
        startDurationTimer(agent);
      }
    }
  }

  function createCard(agent) {
    const card = document.createElement('div');
    card.className = 'm-agent-card ' + (agent.attentionState || agent.status);
    card.dataset.pid = agent.pid;
    card.innerHTML = buildCardInner(agent);
    card.addEventListener('click', () => openDetail(agent.pid));
    return card;
  }

  function updateCard(card, agent) {
    card.className = 'm-agent-card ' + (agent.attentionState || agent.status);
    card.innerHTML = buildCardInner(agent);
    // Re-attach click (innerHTML wipes listeners)
    card.onclick = () => openDetail(agent.pid);
  }

  function buildCardInner(agent) {
    const state = agent.attentionState || agent.status;
    const stateLabel = state.replace(/_/g, ' ');
    let html = `
      <div class="m-card-header">
        <span class="status-dot ${state}"></span>
        <span class="m-card-pid">PID ${agent.pid}</span>
        <span class="m-card-attention ${state}">${stateLabel}</span>
      </div>
      <div class="m-card-body">
        <div class="m-card-meta">
          <span class="label">Duration</span>
          <span class="value m-duration">${formatDuration(agent.startTime)}</span>
        </div>
        <div class="m-card-meta">
          <span class="label">Project</span>
          <span class="value">${escapeHtml(agent.projectGroup || '--')}</span>
        </div>
        <div class="m-card-meta">
          <span class="label">Session</span>
          <span class="value">${agent.sessionId ? escapeHtml(agent.sessionId.slice(0, 8)) : '--'}</span>
        </div>
        <div class="m-card-meta">
          <span class="label">Logs</span>
          <span class="value m-log-count-val">${agent.logLineCount || 0} lines</span>
        </div>
      </div>`;

    if (agent.promptInfo) {
      if (agent.promptInfo.type === 'ask_user') {
        html += `<div class="m-card-prompt">${escapeHtml(agent.promptInfo.question || 'Waiting for input')}</div>`;
      } else if (agent.promptInfo.type === 'tool_permission') {
        html += `<div class="m-card-prompt">Permission: ${escapeHtml((agent.promptInfo.tools || []).join(', '))}</div>`;
      }
    }

    return html;
  }

  function updateCardLogCount(pid) {
    const card = agentList.querySelector(`.m-agent-card[data-pid="${pid}"]`);
    if (!card) return;
    const el = card.querySelector('.m-log-count-val');
    if (el) {
      const current = parseInt(el.textContent, 10) || 0;
      el.textContent = (current + 1) + ' lines';
    }
  }

  // Duration timers for list cards
  function startDurationTimer(agent) {
    if (durationTimers.has(agent.pid)) return;
    const timer = setInterval(() => {
      const card = agentList.querySelector(`.m-agent-card[data-pid="${agent.pid}"]`);
      if (!card) { stopDurationTimer(agent.pid); return; }
      const el = card.querySelector('.m-duration');
      if (el) el.textContent = formatDuration(agent.startTime);
    }, DURATION_UPDATE_MS);
    durationTimers.set(agent.pid, timer);
  }

  function stopDurationTimer(pid) {
    const timer = durationTimers.get(pid);
    if (timer) { clearInterval(timer); durationTimers.delete(pid); }
  }

  function clearDurationTimers() {
    for (const [pid, timer] of durationTimers) { clearInterval(timer); }
    durationTimers.clear();
  }

  // --- Agent Detail ---
  async function openDetail(pid) {
    currentPid = pid;
    detailLogs = [];
    showScreen('detail');

    const agent = agents.find(a => a.pid === pid);
    if (agent) renderDetailHeader(agent);

    // Fetch logs
    try {
      const res = await apiFetch('/agents/' + pid + '/logs');
      const data = await res.json();
      detailLogs = data.logs || [];
      renderLogs();
    } catch {
      logViewer.innerHTML = '<p class="no-logs-msg">Failed to load logs</p>';
    }

    // Fetch meta
    try {
      const res = await apiFetch('/agents/' + pid);
      const meta = await res.json();
      renderDetailMeta(meta);
    } catch { }

    // Update prompt input state
    updatePromptState();

    // Poll for meta updates every 2s
    if (detailPollTimer) clearInterval(detailPollTimer);
    detailPollTimer = setInterval(async () => {
      if (currentPid === null) return;
      try {
        const res = await apiFetch('/agents/' + currentPid);
        if (res.ok) {
          const meta = await res.json();
          renderDetailMeta(meta);
          updateDetailHeader();
          updatePromptState();
        }
      } catch { }
    }, 2000);
  }

  function renderDetailHeader(agent) {
    const state = agent.attentionState || agent.status;
    detailDot.className = 'status-dot ' + state;
    detailPid.textContent = 'PID ' + agent.pid;
    detailStatus.textContent = agent.status;
    detailStatus.className = 'detail-status-badge ' + agent.status;
  }

  function updateDetailHeader() {
    if (currentPid === null) return;
    const agent = agents.find(a => a.pid === currentPid);
    if (agent) renderDetailHeader(agent);
  }

  function renderDetailMeta(meta) {
    if (!meta) return;
    detailMeta.innerHTML = `
      <div class="detail-meta-item">
        <span class="label">Duration</span>
        <span class="value">${formatDuration(meta.startTime)}</span>
      </div>
      <div class="detail-meta-item">
        <span class="label">Session</span>
        <span class="value">${meta.sessionId ? escapeHtml(meta.sessionId.slice(0, 12)) : '--'}</span>
      </div>
      <div class="detail-meta-item">
        <span class="label">Project</span>
        <span class="value">${escapeHtml(meta.projectGroup || '--')}</span>
      </div>
      <div class="detail-meta-item">
        <span class="label">Logs</span>
        <span class="value">${meta.logLineCount || 0}</span>
      </div>
      <div class="detail-meta-item">
        <span class="label">CWD</span>
        <span class="value">${escapeHtml(meta.cwd || '--')}</span>
      </div>
      <div class="detail-meta-item">
        <span class="label">Launcher</span>
        <span class="value">${escapeHtml(meta.launcher || '--')}</span>
      </div>`;
  }

  function renderLogs() {
    logViewer.innerHTML = '';
    logCountEl.textContent = detailLogs.length + ' messages';

    if (detailLogs.length === 0) {
      logViewer.innerHTML = '<p class="no-logs-msg">No log entries available</p>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const line of detailLogs) {
      frag.appendChild(createLogEl(line));
    }
    logViewer.appendChild(frag);
    scrollLogsIfNeeded();
  }

  function appendLogEntry(line) {
    if (logViewer.querySelector('.no-logs-msg')) logViewer.innerHTML = '';
    logViewer.appendChild(createLogEl(line));
    detailLogs.push !== undefined; // already pushed
    logCountEl.textContent = detailLogs.length + ' messages';
    scrollLogsIfNeeded();
  }

  function createLogEl(line) {
    const type = line.type || 'unknown';
    const role = type === 'user' ? 'user' : type === 'assistant' ? 'assistant' : 'system';

    const el = document.createElement('div');
    el.className = 'm-log-entry ' + role;

    let html = `<div class="m-log-role">${escapeHtml(type)}</div>`;

    // Content extraction
    const content = line.message?.content;
    let text = '';
    const toolUses = [];

    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text') text += (text ? '\n' : '') + block.text;
        else if (block.type === 'tool_use') toolUses.push(block.name || 'unknown');
      }
    }

    if (type === 'file-history-snapshot') {
      text = '[File history snapshot]';
    }

    if (text) {
      const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text;
      html += `<div class="m-log-content">${escapeHtml(truncated)}</div>`;
    }

    if (toolUses.length > 0) {
      html += '<div class="m-log-tools">';
      for (const t of toolUses) {
        html += `<span class="m-log-tool">${escapeHtml(t)}</span>`;
      }
      html += '</div>';
    }

    // Token usage
    const usage = line.usage || line.message?.usage;
    if (usage && (usage.input_tokens || usage.output_tokens)) {
      html += `<div class="m-log-tokens">Tokens: in: ${usage.input_tokens || 0} | out: ${usage.output_tokens || 0}</div>`;
    }

    el.innerHTML = html;
    return el;
  }

  function scrollLogsIfNeeded() {
    if (autoScrollCb.checked) {
      logViewer.scrollTop = logViewer.scrollHeight;
    }
  }

  // --- Prompt Input ---
  function updatePromptState() {
    const agent = agents.find(a => a.pid === currentPid);
    const terminated = !agent || agent.status === 'terminated';
    promptInput.disabled = terminated;
    sendBtn.disabled = terminated;
    if (terminated) {
      promptInput.placeholder = 'Agent terminated';
    } else {
      promptInput.placeholder = 'Send prompt to agent...';
    }
  }

  sendBtn.addEventListener('click', sendPrompt);

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  async function sendPrompt() {
    if (currentPid === null) return;
    const text = promptInput.value.trim();
    if (!text) return;

    sendBtn.disabled = true;
    setSendStatus('sending', 'Sending...');

    try {
      const res = await apiFetch('/agents/' + currentPid + '/prompt', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      const result = await res.json();
      if (result.ok) {
        promptInput.value = '';
        setSendStatus('sent', 'Sent');
      } else {
        setSendStatus('error', result.error || 'Send failed');
      }
    } catch (err) {
      setSendStatus('error', 'Connection error');
    }

    sendBtn.disabled = false;
    setTimeout(() => setSendStatus('', ''), 3000);
  }

  function setSendStatus(cls, text) {
    sendStatus.className = 'send-status ' + cls;
    sendStatus.textContent = text;
  }

  // --- Back button ---
  backBtn.addEventListener('click', () => {
    showScreen('list');
  });

  // --- Init ---
  checkUrlToken();

  if (token) {
    authenticate(token);
  } else {
    showScreen('auth');
  }
})();
