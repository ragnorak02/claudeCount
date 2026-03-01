const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer } = require('ws');
const config = require('./config');
const logger = require('./logger').create('mobileServer');
const { getEnvironmentInfo, getVersionInfo, buildExportPayload } = require('./exportService');

class MobileServer {
  /**
   * @param {object}   monitor   - ProcessMonitor instance
   * @param {object}   bridge    - AgentBridge instance
   * @param {object}   injector  - PromptInjector instance
   * @param {object}   tokenStore - TokenStore instance
   */
  constructor(monitor, bridge, injector, tokenStore) {
    this._monitor = monitor;
    this._bridge = bridge;
    this._injector = injector;
    this._tokenStore = tokenStore;

    this._app = null;
    this._server = null;
    this._wss = null;
    this._clients = new Set();
    this._pingTimer = null;
    this._pushThrottleTimer = null;
    this._lastPushTime = 0;
    this._eventCleanups = [];
  }

  /**
   * Start the HTTP + WebSocket server.
   */
  start(port = config.MOBILE_SERVER_PORT, host = config.MOBILE_SERVER_HOST) {
    if (this._server) {
      logger.warn('Mobile server already running');
      return;
    }

    this._app = express();
    this._app.use(express.json({ limit: '64kb' }));

    // --- Auth middleware ---
    this._app.use('/api', (req, res, next) => {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!this._tokenStore.validate(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });

    // --- Static files for mobile UI ---
    const mobileDir = this._resolveMobileDir();
    this._app.use(express.static(mobileDir));

    // --- REST API routes ---
    this._registerRoutes();

    // --- Create HTTP server ---
    this._server = http.createServer(this._app);

    // --- WebSocket server ---
    this._wss = new WebSocketServer({ noServer: true });

    this._server.on('upgrade', (request, socket, head) => {
      // Authenticate WS via query param
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const token = url.searchParams.get('token') || '';
        if (!this._tokenStore.validate(token)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      this._wss.handleUpgrade(request, socket, head, (ws) => {
        this._wss.emit('connection', ws, request);
      });
    });

    this._wss.on('connection', (ws) => {
      this._clients.add(ws);
      logger.info(`Mobile client connected (${this._clients.size} total)`);

      // Send current agent snapshot on connect
      ws.send(JSON.stringify({
        type: 'agents:updated',
        data: { agents: this._monitor.getAgents(), added: [], removed: [] },
      }));

      ws.on('close', () => {
        this._clients.delete(ws);
        logger.info(`Mobile client disconnected (${this._clients.size} remaining)`);
      });

      ws.on('error', (err) => {
        logger.warn('WebSocket client error', { message: err.message });
        this._clients.delete(ws);
      });

      // Respond to client pings
      ws.on('pong', () => { ws._alive = true; });
      ws._alive = true;
    });

    // --- Subscribe to ProcessMonitor events ---
    this._subscribeEvents();

    // --- Ping timer to detect stale clients ---
    this._pingTimer = setInterval(() => {
      for (const ws of this._clients) {
        if (ws._alive === false) {
          ws.terminate();
          this._clients.delete(ws);
          continue;
        }
        ws._alive = false;
        ws.ping();
      }
    }, 30_000);

    // --- Start listening ---
    this._server.listen(port, host, () => {
      logger.info(`Mobile server listening on ${host}:${port}`);
    });

    this._server.on('error', (err) => {
      logger.error('Mobile server error', { message: err.message });
    });
  }

  /**
   * Stop the server and clean up.
   */
  stop() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this._pushThrottleTimer) {
      clearTimeout(this._pushThrottleTimer);
      this._pushThrottleTimer = null;
    }

    // Unsubscribe events
    for (const cleanup of this._eventCleanups) {
      cleanup();
    }
    this._eventCleanups = [];

    // Close all WS clients
    for (const ws of this._clients) {
      try { ws.terminate(); } catch { /* ignore */ }
    }
    this._clients.clear();

    if (this._wss) {
      this._wss.close();
      this._wss = null;
    }

    if (this._server) {
      this._server.close();
      this._server = null;
    }

    this._app = null;
    logger.info('Mobile server stopped');
  }

  /**
   * Resolve path to the mobile UI static files.
   * In dev (webpack-dev-server), use src/mobile.
   * In production (packaged), use resources/mobile.
   */
  _resolveMobileDir() {
    const fs = require('node:fs');
    // Try packaged location first
    const { app } = require('electron');
    const resourcePath = path.join(process.resourcesPath || '', 'mobile');
    if (fs.existsSync(resourcePath)) {
      return resourcePath;
    }
    // Fallback to source location (development)
    return path.join(__dirname, '..', 'mobile');
  }

  /**
   * Register all REST API routes.
   */
  _registerRoutes() {
    const router = express.Router();

    // --- Agents ---
    router.get('/agents', (_req, res) => {
      res.json(this._monitor.getAgents());
    });

    router.get('/agents/:pid', (req, res) => {
      const pid = parseInt(req.params.pid, 10);
      const meta = this._bridge.getAgentMeta(pid);
      if (!meta) return res.status(404).json({ error: 'Agent not found' });
      res.json(meta);
    });

    router.get('/agents/:pid/logs', (req, res) => {
      const pid = parseInt(req.params.pid, 10);
      res.json(this._bridge.getLogsForAgent(pid));
    });

    router.post('/agents/:pid/prompt', async (req, res) => {
      const pid = parseInt(req.params.pid, 10);
      const text = req.body?.text;

      // Same validation as IPC handler
      const agent = this._monitor.getAgentByPid(pid);
      if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });
      if (agent.status === 'terminated') return res.status(400).json({ ok: false, error: 'Agent is terminated' });

      const name = (agent.name || '').toLowerCase();
      if (name.includes('bash') || name.includes('sh.exe')) {
        return res.status(400).json({ ok: false, error: 'Cannot inject into shell subprocess' });
      }

      if (!text || typeof text !== 'string') return res.status(400).json({ ok: false, error: 'Text is required' });
      const trimmed = text.trim();
      if (trimmed.length === 0) return res.status(400).json({ ok: false, error: 'Text is empty' });
      if (trimmed.length > config.MAX_PROMPT_LENGTH) {
        return res.status(400).json({ ok: false, error: `Text exceeds maximum length (${config.MAX_PROMPT_LENGTH})` });
      }

      try {
        const result = await this._injector.sendPrompt(pid, trimmed);
        res.json(result);
      } catch (err) {
        logger.error('Mobile prompt injection failed', { pid, message: err.message });
        res.status(500).json({ ok: false, error: 'Injection failed: ' + err.message });
      }
    });

    // --- Tags ---
    router.get('/agents/:pid/tags', (req, res) => {
      const pid = parseInt(req.params.pid, 10);
      res.json(this._bridge.getAgentTags(pid));
    });

    router.put('/agents/:pid/tags', (req, res) => {
      const pid = parseInt(req.params.pid, 10);
      const tags = req.body?.tags;
      if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
      this._bridge.setAgentTags(pid, tags);
      res.json({ ok: true });
    });

    router.post('/agents/:pid/tags', (req, res) => {
      const pid = parseInt(req.params.pid, 10);
      const tag = req.body?.tag;
      if (!tag || typeof tag !== 'string') return res.status(400).json({ error: 'tag is required' });
      this._bridge.addAgentTag(pid, tag);
      res.json({ ok: true });
    });

    router.delete('/agents/:pid/tags/:tag', (req, res) => {
      const pid = parseInt(req.params.pid, 10);
      this._bridge.removeAgentTag(pid, req.params.tag);
      res.json({ ok: true });
    });

    // --- Monitor controls ---
    router.post('/monitor/start', (_req, res) => {
      this._monitor.start();
      res.json({ ok: true });
    });

    router.post('/monitor/stop', (_req, res) => {
      this._monitor.stop();
      res.json({ ok: true });
    });

    // --- Export ---
    router.get('/export', (_req, res) => {
      const agents = this._monitor.getAgents();
      const payload = buildExportPayload(agents);
      res.setHeader('Content-Disposition', `attachment; filename="claude-agents-${Date.now()}.json"`);
      res.json(payload);
    });

    // --- Environment & Version ---
    router.get('/env', (_req, res) => {
      res.json(getEnvironmentInfo());
    });

    router.get('/version', (_req, res) => {
      res.json(getVersionInfo());
    });

    this._app.use('/api', router);
  }

  /**
   * Subscribe to ProcessMonitor events and push to WS clients.
   */
  _subscribeEvents() {
    const THROTTLE_MS = 300;

    const onAgentsUpdated = (data) => {
      const now = Date.now();
      const elapsed = now - this._lastPushTime;

      if (elapsed >= THROTTLE_MS) {
        this._lastPushTime = now;
        this._broadcast('agents:updated', data);
      } else {
        if (this._pushThrottleTimer) clearTimeout(this._pushThrottleTimer);
        this._pushThrottleTimer = setTimeout(() => {
          this._pushThrottleTimer = null;
          this._lastPushTime = Date.now();
          this._broadcast('agents:updated', {
            agents: this._monitor.getAgents(),
            added: [],
            removed: [],
          });
        }, THROTTLE_MS - elapsed);
      }
    };

    const onLogLine = (data) => {
      this._broadcast('agent:log-line', data);
    };

    const onDegraded = (data) => {
      this._broadcast('monitor:degraded', data);
    };

    this._monitor.on('agents-updated', onAgentsUpdated);
    this._monitor.on('agent-log-line', onLogLine);
    this._monitor.on('monitor-degraded', onDegraded);

    this._eventCleanups.push(
      () => this._monitor.removeListener('agents-updated', onAgentsUpdated),
      () => this._monitor.removeListener('agent-log-line', onLogLine),
      () => this._monitor.removeListener('monitor-degraded', onDegraded),
    );
  }

  /**
   * Broadcast a message to all connected WS clients.
   */
  _broadcast(type, data) {
    if (this._clients.size === 0) return;
    const msg = JSON.stringify({ type, data });
    for (const ws of this._clients) {
      if (ws.readyState === 1) { // OPEN
        ws.send(msg);
      }
    }
  }
}

module.exports = MobileServer;
