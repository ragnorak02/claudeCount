const { EventEmitter } = require('node:events');
const { scanForClaudeProcesses } = require('./processDetector');
const { discoverSessions, correlateAgentSession, watchSession } = require('./sessionWatcher');
const config = require('./config');
const logger = require('./logger').create('processMonitor');

class ProcessMonitor extends EventEmitter {
  constructor() {
    super();
    this._agents = new Map();       // pid -> agent
    this._watchers = new Map();     // pid -> cleanup function
    this._pollTimer = null;
    this._pruneTimer = null;
    this._running = false;
  }

  /**
   * Start the polling loop.
   */
  start(intervalMs = config.POLL_INTERVAL_MS) {
    if (this._running) {
      logger.warn('Monitor already running');
      return;
    }

    this._running = true;
    logger.info(`Starting process monitor (interval: ${intervalMs}ms)`);

    // Run first scan immediately
    this._tick();

    // Then poll on interval
    this._pollTimer = setInterval(() => this._tick(), intervalMs);

    // Prune terminated agents periodically
    this._pruneTimer = setInterval(
      () => this._pruneTerminated(),
      config.TERMINATED_KEEP_DURATION_MS
    );
  }

  /**
   * Stop the polling loop and clean up.
   */
  stop() {
    if (!this._running) return;

    this._running = false;
    logger.info('Stopping process monitor');

    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }

    // Clean up all file watchers
    for (const [pid, cleanup] of this._watchers) {
      cleanup();
    }
    this._watchers.clear();
  }

  /**
   * Returns a single agent by PID, or null if not found.
   */
  getAgentByPid(pid) {
    return this._agents.get(pid) || null;
  }

  /**
   * Returns the current agent registry as an array.
   */
  getAgents() {
    return Array.from(this._agents.values()).map((agent) => ({
      ...agent,
      // Strip logLines for IPC transfer (can be large)
      logLines: undefined,
      logLineCount: agent.logLines ? agent.logLines.length : 0,
    }));
  }

  /**
   * Single poll tick: scan, diff, emit.
   */
  async _tick() {
    try {
      const scanned = await scanForClaudeProcesses();
      const scannedPids = new Set(scanned.map((a) => a.pid));

      const added = [];
      const removed = [];

      // Detect new agents
      for (const agent of scanned) {
        if (!this._agents.has(agent.pid)) {
          this._agents.set(agent.pid, agent);
          added.push(agent);
          logger.info(`Agent detected: PID ${agent.pid}`, {
            name: agent.name,
            commandLine: agent.commandLine.substring(0, 100),
          });

          // Attempt session correlation in background
          this._correlateAndWatch(agent);
        } else {
          // Update lastSeen for existing agents
          const existing = this._agents.get(agent.pid);
          existing.lastSeen = Date.now();
          existing.status = 'active';
        }
      }

      // Detect removed agents
      for (const [pid, agent] of this._agents) {
        if (agent.status === 'terminated') continue;

        if (!scannedPids.has(pid)) {
          agent.status = 'terminated';
          agent.terminatedAt = Date.now();
          removed.push(agent);
          logger.info(`Agent terminated: PID ${pid}`);

          // Clean up file watcher
          if (this._watchers.has(pid)) {
            this._watchers.get(pid)();
            this._watchers.delete(pid);
          }
        }
      }

      // Emit on every tick so the renderer stays in sync.
      // The main process throttles these before pushing to the renderer.
      this.emit('agents-updated', {
        agents: this.getAgents(),
        added: added.map((a) => ({ pid: a.pid, name: a.name })),
        removed: removed.map((a) => ({ pid: a.pid, name: a.name })),
      });
    } catch (err) {
      logger.error('Poll tick failed', { message: err.message });
    }
  }

  /**
   * Attempt to find the session file for an agent and start watching it.
   */
  async _correlateAndWatch(agent) {
    try {
      const sessions = await discoverSessions();
      const match = await correlateAgentSession(agent, sessions);

      if (match) {
        agent.sessionId = match.sessionId;
        agent.sessionFile = match.sessionFile;
        agent.cwd = match.projectPath;

        logger.info(`Correlated PID ${agent.pid} with session ${match.sessionId}`);

        // Start watching the session JSONL file
        const cleanup = watchSession(match.sessionFile, (line) => {
          // Buffer lines on the agent
          if (!agent.logLines) agent.logLines = [];
          agent.logLines.push(line);

          // Enforce max buffer
          if (agent.logLines.length > config.MAX_LOG_LINES_PER_SESSION) {
            agent.logLines = agent.logLines.slice(-config.MAX_LOG_LINES_PER_SESSION);
          }

          // Emit to renderer
          this.emit('agent-log-line', {
            pid: agent.pid,
            sessionId: agent.sessionId,
            line,
          });
        });

        this._watchers.set(agent.pid, cleanup);
      } else {
        logger.debug(`No session correlation for PID ${agent.pid}`);
      }
    } catch (err) {
      logger.warn(`Session correlation failed for PID ${agent.pid}`, {
        message: err.message,
      });
    }
  }

  /**
   * Remove terminated agents that have been gone for a while.
   */
  _pruneTerminated() {
    const now = Date.now();
    for (const [pid, agent] of this._agents) {
      if (
        agent.status === 'terminated' &&
        agent.terminatedAt &&
        now - agent.terminatedAt > config.TERMINATED_KEEP_DURATION_MS
      ) {
        this._agents.delete(pid);
        logger.debug(`Pruned terminated agent PID ${pid}`);
      }
    }
  }
}

module.exports = ProcessMonitor;
