const path = require('node:path');
const os = require('node:os');

module.exports = {
  // Process detection
  POLL_INTERVAL_MS: 2000,
  CLAUDE_PROCESS_SIGNATURES: ['claude'],
  SELF_PROCESS_NAME: 'claudecount',

  // Session paths
  CLAUDE_HOME: path.join(os.homedir(), '.claude'),
  CLAUDE_PROJECTS_DIR: path.join(os.homedir(), '.claude', 'projects'),

  // Agent registry
  TERMINATED_KEEP_DURATION_MS: 60_000,
  MAX_LOG_LINES_PER_SESSION: 1000,

  // Prompt injection
  MAX_PROMPT_LENGTH: 10000,

  // Watchdog
  WATCHDOG_MAX_FAILURES: 5,
  WATCHDOG_RESTART_DELAY_MS: 5000,

  // AMARIS integration (Phase 11 placeholders)
  AMARIS_ENABLED: false,
  AMARIS_API_URL: null,

  // Version metadata
  APP_VERSION: require('../../package.json').version,
  APP_NAME: require('../../package.json').name,

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  VERBOSE: process.env.VERBOSE === '1',
};
