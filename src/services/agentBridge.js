const config = require('./config');
const logger = require('./logger').create('agentBridge');

class AgentBridge {
  constructor(processMonitor) {
    this._monitor = processMonitor;
  }

  /**
   * Returns the buffered log lines for an agent.
   */
  getLogsForAgent(pid) {
    const agent = this._monitor.getAgentByPid(pid);

    if (!agent) {
      if (config.VERBOSE) logger.debug(`getLogsForAgent: no agent for PID ${pid}`);
      return { pid, sessionId: null, logs: [], available: false, reason: 'Agent not found in registry' };
    }

    if (!agent.sessionId || !agent.sessionFile) {
      return {
        pid,
        sessionId: null,
        logs: [],
        available: false,
        reason: 'No session file correlated — logs unavailable',
      };
    }

    return {
      pid,
      sessionId: agent.sessionId,
      logs: agent.logLines ? [...agent.logLines] : [],
      available: true,
    };
  }

  /**
   * Returns metadata for an agent.
   */
  getAgentMeta(pid) {
    const agent = this._monitor.getAgentByPid(pid);

    if (!agent) {
      if (config.VERBOSE) logger.debug(`getAgentMeta: no agent for PID ${pid}`);
      return null;
    }

    return {
      pid: agent.pid,
      name: agent.name,
      commandLine: agent.commandLine,
      startTime: agent.startTime,
      status: agent.status,
      sessionId: agent.sessionId || null,
      cwd: agent.cwd || null,
      logLineCount: agent.logLines ? agent.logLines.length : 0,
      terminatedAt: agent.terminatedAt || null,
    };
  }
}

module.exports = AgentBridge;
