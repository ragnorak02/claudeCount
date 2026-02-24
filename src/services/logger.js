const config = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.LOG_LEVEL] ?? LEVELS.info;

function formatTimestamp() {
  return new Date().toISOString();
}

function log(level, tag, message, data) {
  if (LEVELS[level] < currentLevel) return;

  const entry = {
    time: formatTimestamp(),
    level,
    tag,
    message,
  };

  if (data !== undefined) {
    entry.data = data;
  }

  const prefix = `[${entry.time}] [${level.toUpperCase()}] [${tag}]`;

  switch (level) {
    case 'error':
      console.error(prefix, message, data !== undefined ? data : '');
      break;
    case 'warn':
      console.warn(prefix, message, data !== undefined ? data : '');
      break;
    case 'debug':
      console.debug(prefix, message, data !== undefined ? data : '');
      break;
    default:
      console.log(prefix, message, data !== undefined ? data : '');
  }
}

module.exports = {
  debug: (message, data) => log('debug', 'app', message, data),
  info: (message, data) => log('info', 'app', message, data),
  warn: (message, data) => log('warn', 'app', message, data),
  error: (message, data) => log('error', 'app', message, data),

  // Tagged loggers for services
  create(tag) {
    return {
      debug: (message, data) => log('debug', tag, message, data),
      info: (message, data) => log('info', tag, message, data),
      warn: (message, data) => log('warn', tag, message, data),
      error: (message, data) => log('error', tag, message, data),
    };
  },
};
