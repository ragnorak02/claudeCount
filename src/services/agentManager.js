const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const ptyService = require('./ptyService');
const config = require('./config');
const logger = require('./logger').create('agentManager');

/**
 * Agent lifecycle manager.
 * Spawns AI agents in PTY terminals, tracks status, detects attention states.
 *
 * Emits:
 *   agent-created      { agent }
 *   agent-updated      { agent }
 *   agent-notification  { agentId, type, message }
 *   agent-exited       { agentId, exitCode }
 */
class AgentManager extends EventEmitter {
  constructor() {
    super();
    this._agents = new Map(); // agentId -> AgentState
    this._terminalToAgent = new Map(); // terminalId -> agentId

    // Listen to PTY events
    ptyService.on('terminal-output', (data) => this._onTerminalOutput(data));
    ptyService.on('terminal-exited', (data) => this._onTerminalExited(data));
  }

  /**
   * Launch an agent.
   * @param {object} opts
   * @param {string} opts.worktreeId
   * @param {string} opts.worktreePath - cwd for the agent
   * @param {string} opts.projectId
   * @param {string} opts.agentType - 'claude' | 'codex' | 'shell' | custom command
   * @param {string} [opts.prompt] - Initial prompt/task
   * @param {boolean} [opts.autoPrime] - Send auto-prime command
   * @returns {{ ok: boolean, agentId?: string, terminalId?: string, error?: string }}
   */
  launch(opts) {
    const agentId = crypto.randomUUID();
    const command = this._resolveCommand(opts.agentType);
    const args = this._resolveArgs(opts.agentType, opts);

    // Create PTY
    const ptyResult = ptyService.create({
      cwd: opts.worktreePath,
      command,
      args,
      type: 'agent',
      meta: {
        agentId,
        agentType: opts.agentType,
        worktreeId: opts.worktreeId,
        projectId: opts.projectId,
        prompt: opts.prompt,
      },
    });

    if (!ptyResult.ok) {
      return { ok: false, error: ptyResult.error };
    }

    const agent = {
      id: agentId,
      type: opts.agentType,
      terminalId: ptyResult.id,
      pid: ptyResult.pid,
      worktreeId: opts.worktreeId,
      worktreePath: opts.worktreePath,
      projectId: opts.projectId,
      prompt: opts.prompt || '',
      status: 'starting',
      startTime: Date.now(),
      endTime: null,
      exitCode: null,
      autoPrimed: false,
      lastActivity: Date.now(),
      attentionReason: null,
    };

    this._agents.set(agentId, agent);
    this._terminalToAgent.set(ptyResult.id, agentId);

    // Schedule auto-prime if enabled
    if (opts.autoPrime !== false && config.PTY_AUTO_PRIME_ENABLED && opts.agentType === 'claude') {
      setTimeout(() => {
        this._autoPrime(agentId);
      }, config.PTY_AUTO_PRIME_DELAY_MS);
    }

    // Mark as running after brief delay
    setTimeout(() => {
      if (agent.status === 'starting') {
        agent.status = 'running';
        this.emit('agent-updated', { agent: this._serialize(agent) });
      }
    }, 1000);

    logger.info('Agent launched', { agentId, type: opts.agentType, cwd: opts.worktreePath });
    this.emit('agent-created', { agent: this._serialize(agent) });

    return { ok: true, agentId, terminalId: ptyResult.id };
  }

  /**
   * Terminate an agent.
   */
  terminate(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return { ok: false, error: 'Agent not found' };
    if (agent.status === 'done' || agent.status === 'failed' || agent.status === 'terminated') {
      return { ok: false, error: 'Agent already stopped' };
    }

    agent.status = 'terminated';
    agent.endTime = Date.now();
    ptyService.close(agent.terminalId);

    this.emit('agent-updated', { agent: this._serialize(agent) });
    return { ok: true };
  }

  /**
   * Send input to an agent's terminal.
   */
  sendInput(agentId, text) {
    const agent = this._agents.get(agentId);
    if (!agent) return { ok: false, error: 'Agent not found' };
    const result = ptyService.write(agent.terminalId, text);

    // Clear waiting state after input
    if (result.ok && (agent.status === 'waiting_input' || agent.status === 'waiting_permission')) {
      agent.status = 'running';
      agent.attentionReason = null;
      this.emit('agent-updated', { agent: this._serialize(agent) });
    }

    return result;
  }

  /**
   * Get all agents.
   */
  getAll() {
    return Array.from(this._agents.values()).map(a => this._serialize(a));
  }

  /**
   * Get agent by ID.
   */
  getById(agentId) {
    const a = this._agents.get(agentId);
    return a ? this._serialize(a) : null;
  }

  /**
   * Get agents by worktree.
   */
  getByWorktree(worktreeId) {
    return Array.from(this._agents.values())
      .filter(a => a.worktreeId === worktreeId)
      .map(a => this._serialize(a));
  }

  /**
   * Get agent by terminal ID.
   */
  getByTerminal(terminalId) {
    const agentId = this._terminalToAgent.get(terminalId);
    if (!agentId) return null;
    return this.getById(agentId);
  }

  // --- Internal ---

  _autoPrime(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent || agent.autoPrimed || agent.status === 'terminated') return;

    const result = ptyService.write(agent.terminalId, config.PTY_AUTO_PRIME_COMMAND + '\n');
    if (result.ok) {
      agent.autoPrimed = true;
      logger.info('Auto-prime sent', { agentId });
    }
  }

  _onTerminalOutput({ id, data }) {
    const agentId = this._terminalToAgent.get(id);
    if (!agentId) return;

    const agent = this._agents.get(agentId);
    if (!agent) return;

    agent.lastActivity = Date.now();

    // Check for attention-needing patterns
    this._checkAttentionState(agent, data);
  }

  _onTerminalExited({ id, exitCode }) {
    const agentId = this._terminalToAgent.get(id);
    if (!agentId) return;

    const agent = this._agents.get(agentId);
    if (!agent) return;

    agent.status = exitCode === 0 ? 'done' : 'failed';
    agent.endTime = Date.now();
    agent.exitCode = exitCode;

    logger.info('Agent exited', { agentId, exitCode });
    this.emit('agent-updated', { agent: this._serialize(agent) });
    this.emit('agent-exited', { agentId, exitCode });

    // Notification
    this.emit('agent-notification', {
      agentId,
      type: exitCode === 0 ? 'done' : 'error',
      message: exitCode === 0 ? 'Agent completed successfully' : `Agent exited with code ${exitCode}`,
    });
  }

  /**
   * Detect if agent output contains approval/waiting patterns.
   */
  _checkAttentionState(agent, data) {
    if (agent.status === 'terminated' || agent.status === 'done' || agent.status === 'failed') return;

    const lower = data.toLowerCase();

    // Permission patterns
    const permissionPatterns = [
      'do you want to proceed',
      'allow this action',
      'approve this',
      'y/n',
      'yes/no',
      'press enter to continue',
      'waiting for approval',
      'require approval',
    ];

    // Input patterns
    const inputPatterns = [
      'enter your',
      'type your',
      'please provide',
      'what would you like',
      'waiting for input',
      'your response',
    ];

    const prevStatus = agent.status;

    for (const pat of permissionPatterns) {
      if (lower.includes(pat)) {
        agent.status = 'waiting_permission';
        agent.attentionReason = 'Needs approval';
        break;
      }
    }

    if (agent.status !== 'waiting_permission') {
      for (const pat of inputPatterns) {
        if (lower.includes(pat)) {
          agent.status = 'waiting_input';
          agent.attentionReason = 'Needs input';
          break;
        }
      }
    }

    if (agent.status !== prevStatus) {
      this.emit('agent-updated', { agent: this._serialize(agent) });
      this.emit('agent-notification', {
        agentId: agent.id,
        type: 'attention',
        message: agent.attentionReason,
      });
    }
  }

  _resolveCommand(agentType) {
    const commands = {
      claude: 'claude',
      codex: 'codex',
      shell: this._defaultShell(),
    };
    return commands[agentType] || agentType;
  }

  _resolveArgs(agentType, opts = {}) {
    const args = [];
    if (opts.skipPermissions && (agentType === 'claude' || agentType === 'codex')) {
      args.push('--dangerously-skip-permissions');
    }
    return args;
  }

  _defaultShell() {
    if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
    return process.env.SHELL || '/bin/bash';
  }

  _serialize(agent) {
    return {
      id: agent.id,
      type: agent.type,
      terminalId: agent.terminalId,
      pid: agent.pid,
      worktreeId: agent.worktreeId,
      worktreePath: agent.worktreePath,
      projectId: agent.projectId,
      prompt: agent.prompt,
      status: agent.status,
      startTime: agent.startTime,
      endTime: agent.endTime,
      exitCode: agent.exitCode,
      autoPrimed: agent.autoPrimed,
      lastActivity: agent.lastActivity,
      attentionReason: agent.attentionReason,
    };
  }
}

module.exports = new AgentManager();
