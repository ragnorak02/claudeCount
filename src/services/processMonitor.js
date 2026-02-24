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
 * When the last JSONL line is type "assistant" with tool_use blocks and
 * silence > 5s, the agent is waiting for the user:
 *   - AskUserQuestion tool_use → waiting_input
 *   - Other tool_use (Bash, Edit, …) → waiting_permission
 *   - No tool_use (end-of-turn text) → waiting_input
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

  // Assistant message + silence > 5s — inspect content for tool_use blocks
  if (lastLine.type === 'assistant' && silenceMs > 5000) {
    const toolUses = getToolUseBlocks(lastLine);
    const hasAskUser = toolUses.some(t => t.name === 'AskUserQuestion');

    if (hasAskUser) return 'waiting_input';
    if (toolUses.length > 0) return 'waiting_permission';
    return 'waiting_input'; // end-of-turn (no tool_use)
  }

  // Long silence (>60s) on any type — stalled
  if (silenceMs > 60000) return 'stalled';

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
    const agent = this._agents.get(pid);
    if (!agent) return null;
    const attentionState = deriveAttentionState(agent);
    return {
      ...agent,
      attentionState,
      promptInfo: (attentionState === 'waiting_input' || attentionState === 'waiting_permission')
        ? extractPromptInfo(agent) : null,
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
      };
    });
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
