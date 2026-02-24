const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const chokidar = require('chokidar');
const config = require('./config');
const logger = require('./logger').create('sessionWatcher');

/**
 * Discovers JSONL session files under ~/.claude/projects/.
 * Returns an array of { sessionFile, projectPath, lastModified }.
 */
async function discoverSessions() {
  const sessions = [];
  const projectsDir = config.CLAUDE_PROJECTS_DIR;

  try {
    await fs.promises.access(projectsDir);
  } catch {
    logger.debug('Claude projects directory not found', { path: projectsDir });
    return sessions;
  }

  try {
    const projectDirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;

      const sessionsDir = path.join(projectsDir, projectDir.name, 'sessions');
      try {
        await fs.promises.access(sessionsDir);
      } catch {
        continue;
      }

      const files = await fs.promises.readdir(sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const sessionFile = path.join(sessionsDir, file);
        try {
          const stat = await fs.promises.stat(sessionFile);
          sessions.push({
            sessionFile,
            sessionId: path.basename(file, '.jsonl'),
            projectPath: projectDir.name,
            lastModified: stat.mtimeMs,
          });
        } catch {
          // File may have been removed between readdir and stat
        }
      }
    }
  } catch (err) {
    logger.error('Failed to discover sessions', { message: err.message });
  }

  // Sort by most recently modified first
  sessions.sort((a, b) => b.lastModified - a.lastModified);
  logger.debug(`Discovered ${sessions.length} session file(s)`);
  return sessions;
}

/**
 * Attempts to correlate an agent (by startTime) with a session file.
 * Returns the best matching session or null.
 */
async function correlateAgentSession(agent, sessions) {
  if (!agent.startTime) return null;

  const agentStartMs = agent.startTime.getTime();

  // Find sessions modified around the time the agent started (within 30s window)
  // and that are still recently active
  const candidates = sessions.filter((s) => {
    const timeDiff = Math.abs(s.lastModified - agentStartMs);
    // Session should have been modified recently (within last 5 minutes)
    const isRecent = Date.now() - s.lastModified < 5 * 60 * 1000;
    return timeDiff < 30_000 || isRecent;
  });

  if (candidates.length === 0) return null;

  // Try to read the last line of each candidate to find session metadata
  for (const candidate of candidates) {
    try {
      const lastLine = await readLastJsonlLine(candidate.sessionFile);
      if (lastLine) {
        // Check if this session is still active by looking at recent timestamp
        const lineTime = lastLine.timestamp
          ? new Date(lastLine.timestamp).getTime()
          : candidate.lastModified;

        if (Date.now() - lineTime < 5 * 60 * 1000) {
          return {
            ...candidate,
            lastLine,
          };
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Fallback: return the most recently modified session
  return candidates[0];
}

/**
 * Reads the last non-empty line from a JSONL file and parses it.
 */
async function readLastJsonlLine(filePath) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let lastLine = null;

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed) lastLine = trimmed;
    });

    rl.on('close', () => {
      if (lastLine) {
        try {
          resolve(JSON.parse(lastLine));
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    rl.on('error', () => resolve(null));
  });
}

/**
 * Watches a JSONL file for new lines appended at the end.
 * Returns a cleanup function to stop watching.
 */
function watchSession(sessionFilePath, onNewLine) {
  let fileSize = 0;

  try {
    const stat = fs.statSync(sessionFilePath);
    fileSize = stat.size;
  } catch {
    // File may not exist yet
  }

  const watcher = chokidar.watch(sessionFilePath, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  watcher.on('change', () => {
    try {
      const stat = fs.statSync(sessionFilePath);
      if (stat.size <= fileSize) return;

      const stream = fs.createReadStream(sessionFilePath, {
        encoding: 'utf8',
        start: fileSize,
      });

      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk;
      });

      stream.on('end', () => {
        fileSize = stat.size;

        const lines = buffer.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            onNewLine(parsed);
          } catch {
            logger.debug('Skipping unparseable JSONL line');
          }
        }
      });

      stream.on('error', (err) => {
        logger.warn('Error reading session file chunk', { message: err.message });
      });
    } catch (err) {
      logger.warn('Error handling session file change', { message: err.message });
    }
  });

  logger.debug('Watching session file', { path: sessionFilePath });

  // Return cleanup function
  return () => {
    watcher.close();
    logger.debug('Stopped watching session file', { path: sessionFilePath });
  };
}

module.exports = { discoverSessions, correlateAgentSession, watchSession };
