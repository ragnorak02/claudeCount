const path = require('node:path');
const os = require('node:os');

module.exports = {
  // Process detection
  POLL_INTERVAL_MS: 2000,
  CLAUDE_PROCESS_SIGNATURES: ['claude'],
  SELF_PROCESS_NAME: 'claude-agent-monitor',

  // Session paths
  CLAUDE_HOME: path.join(os.homedir(), '.claude'),
  CLAUDE_PROJECTS_DIR: path.join(os.homedir(), '.claude', 'projects'),

  // Agent registry
  TERMINATED_KEEP_DURATION_MS: 60_000,
  MAX_LOG_LINES_PER_SESSION: 1000,

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  VERBOSE: process.env.VERBOSE === '1',
};
