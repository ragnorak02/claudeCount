const { execFile } = require('node:child_process');
const config = require('./config');
const logger = require('./logger').create('processDetector');

/**
 * Scans for running Claude CLI processes using PowerShell.
 * Returns an array of normalized agent objects.
 */
function scanForClaudeProcesses() {
  return new Promise((resolve) => {
    const psCommand = `
      Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -like '*claude*' } |
        Select-Object ProcessId,Name,CommandLine,ParentProcessId,CreationDate |
        ConvertTo-Json -Compress
    `.trim();

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-Command', psCommand],
      { timeout: 10_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          logger.error('PowerShell scan failed', { message: error.message });
          resolve([]);
          return;
        }

        if (stderr && stderr.trim()) {
          logger.warn('PowerShell stderr', { stderr: stderr.trim() });
        }

        const raw = stdout.trim();
        if (!raw) {
          logger.debug('No Claude processes found');
          resolve([]);
          return;
        }

        try {
          let parsed = JSON.parse(raw);

          // PowerShell returns a single object (not array) when there's only one match
          if (!Array.isArray(parsed)) {
            parsed = [parsed];
          }

          const selfPid = process.pid;
          const selfPpid = process.ppid;

          const agents = parsed
            .filter((proc) => {
              // Skip our own Electron process and its parent
              if (proc.ProcessId === selfPid || proc.ProcessId === selfPpid) {
                return false;
              }

              // Skip if the command line references our own application
              const cmdLine = (proc.CommandLine || '').toLowerCase();
              if (cmdLine.includes(config.SELF_PROCESS_NAME)) {
                return false;
              }

              // Must have a command line that genuinely references claude CLI
              // Filter out things that just happen to have "claude" in the path
              if (!cmdLine) return false;

              // Skip PowerShell processes spawned by our scanner
              if (
                proc.Name &&
                proc.Name.toLowerCase().includes('powershell') &&
                cmdLine.includes('get-ciminstance')
              ) {
                return false;
              }

              // Look for patterns that indicate actual Claude CLI usage
              const isClaudeCli =
                cmdLine.includes('claude') &&
                !cmdLine.includes('claudecount') &&
                !cmdLine.includes('claude-agent-monitor');

              return isClaudeCli;
            })
            .map((proc) => normalizeAgent(proc));

          logger.debug(`Found ${agents.length} Claude process(es)`);
          resolve(agents);
        } catch (parseError) {
          logger.error('Failed to parse PowerShell output', {
            message: parseError.message,
            raw: raw.substring(0, 200),
          });
          resolve([]);
        }
      }
    );
  });
}

/**
 * Normalizes a raw Win32_Process object into an Agent descriptor.
 */
function normalizeAgent(proc) {
  let startTime = null;
  if (proc.CreationDate) {
    // CIM datetime comes as e.g. "/Date(1708700000000)/" in JSON
    const match = String(proc.CreationDate).match(/\/Date\((\d+)\)\//);
    if (match) {
      startTime = new Date(parseInt(match[1], 10));
    } else {
      // Fallback: try direct parsing
      startTime = new Date(proc.CreationDate);
      if (isNaN(startTime.getTime())) startTime = null;
    }
  }

  return {
    pid: proc.ProcessId,
    name: proc.Name || 'unknown',
    commandLine: proc.CommandLine || '',
    parentPid: proc.ParentProcessId || null,
    startTime,
    sessionId: null,
    sessionFile: null,
    cwd: null,
    status: 'active',
    lastSeen: Date.now(),
    logLines: [],
  };
}

module.exports = { scanForClaudeProcesses };
