const { EventEmitter } = require('node:events');
const { scanForClaudeProcesses } = require('./processDetector');
const { discoverSessions, correlateAgentSession, watchSession } = require('./sessionWatcher');
const config = require('./config');
const logger = require('./logger').create('processMonitor');

/**
 * Extracts tool_use blocks from a JSONL line's message.content array.
 */
function getToolUseBlocks(line) {
  const content = line?.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter(block => block.type === 'tool_use');
}

/**
 * Derives the attention state of an agent based on log activity.
 *
 * States:
 *   ended            — process terminated
 *   running          — agent is actively processing
 *   waiting_input    — assistant used AskUserQuestion, waiting for user
 *   waiting_permission — assistant used a tool, waiting for approval
 *   inactive         — assistant finished its turn (no tool_use), idle
 *   stalled          — non-standard message type with 5+ min silence
 *   unknown          — no session data
 */
function deriveAttentionState(agent) {
  if (agent.status === 'terminated') return 'ended';

  const lastLine = agent.logLines?.length > 0
    ? agent.logLines[agent.logLines.length - 1]
    : null;

  if (!lastLine) {
    // No session data — can't confirm it's actually working
    return agent.sessionId ? 'running' : 'unknown';
  }

  const lastLineTime = lastLine.timestamp
    ? new Date(lastLine.timestamp).getTime()
    : agent.lastSeen;
  const silenceMs = Date.now() - lastLineTime;

  // Assistant message — inspect content for tool_use blocks
  if (lastLine.type === 'assistant') {
    const toolUses = getToolUseBlocks(lastLine);
    const hasAskUser = toolUses.some(t => t.name === 'AskUserQuestion');

    if (hasAskUser) return 'waiting_input';
    if (toolUses.length > 0) return silenceMs > 5000 ? 'waiting_permission' : 'running';
    // End-of-turn (no tool_use) — agent finished, idle after 5s
    return silenceMs > 5000 ? 'inactive' : 'running';
  }

  // User message — agent is processing the request (can take minutes)
  if (lastLine.type === 'user') return 'running';

  // Other types (system, file-history-snapshot, etc.) — only stall after 5 min
  if (silenceMs > 300000) return 'stalled';

  return 'running';
}

/**
 * Extracts prompt information from the last assistant message.
 * Returns null if the agent isn't in a waiting state, or an object describing
 * what the agent is waiting for:
 *   { type: 'ask_user', question, options }
 *   { type: 'tool_permission', tools }
 *   { type: 'end_of_turn' }
 */
function extractPromptInfo(agent) {
  const lastLine = agent.logLines?.length > 0
    ? agent.logLines[agent.logLines.length - 1]
    : null;

  if (!lastLine || lastLine.type !== 'assistant') return null;

  const toolUses = getToolUseBlocks(lastLine);

  // AskUserQuestion — extract question text + option labels
  const askUser = toolUses.find(t => t.name === 'AskUserQuestion');
  if (askUser) {
    const q = (askUser.input?.questions || [])[0];
    if (q) {
      return {
        type: 'ask_user',
        question: (q.question || '').substring(0, 120),
        options: (q.options || []).map(o => (o.label || '').substring(0, 60)),
      };
    }
    return { type: 'ask_user', question: 'Waiting for your response', options: [] };
  }

  // Other tool_use — show tool names needing permission
  if (toolUses.length > 0) {
    return { type: 'tool_permission', tools: toolUses.map(t => t.name || 'unknown') };
  }

  // End of turn — assistant finished, no tool_use
  return { type: 'end_of_turn' };
}

/**
 * Derives a project group name from an encoded project path.
 * E.g. "Z--Development-ClaudeCount" → "ClaudeCount"
 */
function deriveProjectGroup(projectPath) {
  if (!projectPath) return null;
  // The project path is the encoded directory name from .claude/projects/
  // Take the last segment after splitting on path separators
  const segments = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const last = segments[segments.length - 1] || projectPath;
  // The encoded name uses dashes as separators — take the last dash-segment
  const parts = last.split('-').filter(Boolean);
  return parts[parts.length - 1] || last;
}

class ProcessMonitor extends EventEmitter {
  constructor() {
    super();
    this._agents = new Map();       // pid -> agent
    this._watchers = new Map();     // pid -> cleanup function
    this._tags = new Map();         // pid -> Set of tags
    this._pollTimer = null;
    this._pruneTimer = null;
    this._running = false;
    this._consecutiveFailures = 0;
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
      try { cleanup(); } catch (e) { logger.warn(`Watcher cleanup failed for PID ${pid}`); }
    }
    this._watchers.clear();
  }

  /**
   * Returns a single agent by PID, or null if not found.
   */
  getAgentByPid(pid) {
    const agent = this._agents.get(pid);
    if (!agent) return null;
    const attentionState = deriveAttentionState(agent);
    return {
      ...agent,
      attentionState,
      promptInfo: (attentionState === 'waiting_input' || attentionState === 'waiting_permission')
        ? extractPromptInfo(agent) : null,
      tags: this.getAgentTags(pid),
      projectGroup: agent.projectGroup || null,
      launcher: agent.launcher || 'unknown',
    };
  }

  /**
   * Returns the current agent registry as an array.
   */
  getAgents() {
    return Array.from(this._agents.values()).map((agent) => {
      const attentionState = deriveAttentionState(agent);
      return {
        ...agent,
        // Strip logLines for IPC transfer (can be large)
        logLines: undefined,
        logLineCount: agent.logLines ? agent.logLines.length : 0,
        attentionState,
        promptInfo: (attentionState === 'waiting_input' || attentionState === 'waiting_permission')
          ? extractPromptInfo(agent) : null,
        tags: this.getAgentTags(agent.pid),
        projectGroup: agent.projectGroup || null,
        launcher: agent.launcher || 'unknown',
      };
    });
  }

  /**
   * Set the full tag list for an agent.
   */
  setAgentTags(pid, tags) {
    this._tags.set(pid, new Set(Array.isArray(tags) ? tags : []));
  }

  /**
   * Add a single tag to an agent.
   */
  addAgentTag(pid, tag) {
    if (!this._tags.has(pid)) this._tags.set(pid, new Set());
    this._tags.get(pid).add(tag);
  }

  /**
   * Remove a single tag from an agent.
   */
  removeAgentTag(pid, tag) {
    if (!this._tags.has(pid)) return;
    this._tags.get(pid).delete(tag);
  }

  /**
   * Get tags for an agent.
   */
  getAgentTags(pid) {
    return Array.from(this._tags.get(pid) || []);
  }

  /**
   * Single poll tick: scan, diff, emit.
   */
  async _tick() {
    try {
      const scanned = await scanForClaudeProcesses();
      this._consecutiveFailures = 0;
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
      const agentData = {
        agents: this.getAgents(),
        added: added.map((a) => ({ pid: a.pid, name: a.name })),
        removed: removed.map((a) => ({ pid: a.pid, name: a.name })),
      };

      this.emit('agents-updated', agentData);

      // AMARIS API stub — notify external system when enabled
      if (config.AMARIS_ENABLED && config.AMARIS_API_URL) {
        this._notifyAmarisApi(agentData);
      }
    } catch (err) {
      this._consecutiveFailures++;
      logger.error(`Poll tick failed (${this._consecutiveFailures} consecutive)`, { message: err.message });

      if (this._consecutiveFailures >= config.WATCHDOG_MAX_FAILURES) {
        logger.warn('Watchdog: too many consecutive failures, restarting monitor loop');
        this.emit('monitor-degraded', { failures: this._consecutiveFailures });
        this._restartLoop();
      }
    }
  }

  /**
   * AMARIS API notification stub.
   * When AMARIS integration is fully implemented, this will POST agent data
   * to the configured AMARIS_API_URL endpoint.
   */
  _notifyAmarisApi(data) {
    logger.debug('AMARIS API stub: would send agent update', {
      agentCount: data.agents.length,
      url: config.AMARIS_API_URL,
    });
  }

  /**
   * Watchdog: restart the poll loop after repeated failures.
   */
  _restartLoop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    setTimeout(() => {
      if (this._running) {
        this._consecutiveFailures = 0;
        this._pollTimer = setInterval(() => this._tick(), config.POLL_INTERVAL_MS);
        this._tick();
        logger.info('Watchdog: monitor loop restarted');
      }
    }, config.WATCHDOG_RESTART_DELAY_MS);
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
        agent.projectGroup = deriveProjectGroup(match.projectPath);

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
        this._tags.delete(pid);
        logger.debug(`Pruned terminated agent PID ${pid}`);
      }
    }
  }
}

module.exports = ProcessMonitor;
