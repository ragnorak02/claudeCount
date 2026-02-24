const os = require('node:os');
const config = require('./config');

/**
 * Wraps an agent array with metadata for JSON export.
 */
function buildExportPayload(agents) {
  return {
    exportedAt: new Date().toISOString(),
    version: config.APP_VERSION,
    app: config.APP_NAME,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    amaris: {
      enabled: config.AMARIS_ENABLED,
      apiUrl: config.AMARIS_API_URL,
    },
    agentCount: agents.length,
    agents,
  };
}

/**
 * Returns environment information for the running application.
 */
function getEnvironmentInfo() {
  return {
    appName: config.APP_NAME,
    appVersion: config.APP_VERSION,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    amaris: {
      enabled: config.AMARIS_ENABLED,
      apiUrl: config.AMARIS_API_URL,
    },
  };
}

/**
 * Returns a compact version object.
 */
function getVersionInfo() {
  return {
    name: config.APP_NAME,
    version: config.APP_VERSION,
    electron: process.versions.electron,
    node: process.versions.node,
  };
}

module.exports = { buildExportPayload, getEnvironmentInfo, getVersionInfo };
