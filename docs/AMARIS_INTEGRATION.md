# AMARIS Integration Guide

This document describes the Phase 11 hooks added to ClaudeCount for future AMARIS/AMATRIS ecosystem integration.

## Phase 11 Hooks Summary

Phase 11 adds lightweight scaffolding for external system integration without changing existing UI or behavior:

- **Agent tagging** — arbitrary string tags per agent (CRUD via IPC)
- **Project grouping** — auto-derived group name from the session's project path
- **Launcher detection** — identifies the shell/terminal that spawned each agent
- **JSON export** — full agent snapshot with metadata, saved to file via dialog
- **Environment info** — platform, versions, and AMARIS config flags
- **Version info** — compact app version object
- **AMARIS API stub** — gated behind config flags, logs debug messages when enabled

## Config Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `AMARIS_ENABLED` | `boolean` | `false` | Master switch for AMARIS integration features |
| `AMARIS_API_URL` | `string\|null` | `null` | Endpoint URL for AMARIS API notifications |
| `APP_VERSION` | `string` | from package.json | Application version |
| `APP_NAME` | `string` | from package.json | Application name |

To enable AMARIS integration, set both flags in `src/services/config.js`:

```js
AMARIS_ENABLED: true,
AMARIS_API_URL: 'https://amaris.example.com/api/agents',
```

## Agent Data Model

Each agent object now includes these fields:

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `pid` | `number` | Process scan | Windows process ID |
| `name` | `string` | Process scan | Process name |
| `commandLine` | `string` | Process scan | Full command line |
| `parentPid` | `number\|null` | Process scan | Parent process ID |
| `startTime` | `Date\|null` | Process scan | Process creation time |
| `sessionId` | `string\|null` | Session watcher | Claude session UUID |
| `sessionFile` | `string\|null` | Session watcher | Path to JSONL session file |
| `cwd` | `string\|null` | Session watcher | Working directory / project path |
| `status` | `string` | Monitor | `'active'` or `'terminated'` |
| `lastSeen` | `number` | Monitor | Timestamp of last detection |
| `attentionState` | `string` | Monitor | Derived attention state |
| `promptInfo` | `object\|null` | Monitor | What the agent is waiting for |
| `logLineCount` | `number` | Monitor | Number of buffered log lines |
| **`launcher`** | `string` | **Phase 11** | Detected shell: `powershell`, `cmd`, `bash`, `wsl`, `vscode-terminal`, `unknown` |
| **`tags`** | `string[]` | **Phase 11** | User-assigned tags |
| **`projectGroup`** | `string\|null` | **Phase 11** | Auto-derived project group name |

## IPC Channel Reference

### Existing Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `agents:list` | renderer -> main | Get all agents |
| `agent:get-logs` | renderer -> main | Get log lines for agent |
| `agent:get-meta` | renderer -> main | Get agent metadata |
| `monitor:start` | renderer -> main | Start the process monitor |
| `monitor:stop` | renderer -> main | Stop the process monitor |
| `agent:send-prompt` | renderer -> main | Send text to an agent's terminal |
| `agents:updated` | main -> renderer | Push agent list updates |
| `agent:log-line` | main -> renderer | Push new log line for agent |
| `monitor:degraded` | main -> renderer | Push monitor health warning |

### Phase 11 Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `agent:set-tags` | renderer -> main | Set full tag array for agent |
| `agent:add-tag` | renderer -> main | Add single tag to agent |
| `agent:remove-tag` | renderer -> main | Remove single tag from agent |
| `agent:get-tags` | renderer -> main | Get tags for agent |
| `agents:export` | renderer -> main | Export all agents to JSON file |
| `app:get-env` | renderer -> main | Get environment information |
| `app:get-version` | renderer -> main | Get version information |

### Preload API Methods

All channels are exposed via `window.electronAPI`:

```js
// Tags
await window.electronAPI.setAgentTags(pid, ['tag1', 'tag2']);
await window.electronAPI.addAgentTag(pid, 'new-tag');
await window.electronAPI.removeAgentTag(pid, 'old-tag');
const tags = await window.electronAPI.getAgentTags(pid);

// Export
const result = await window.electronAPI.exportAgents();
// result: { ok: true, filePath: '...' } or { ok: false, reason: '...' }

// Environment
const env = await window.electronAPI.getEnvironmentInfo();
const ver = await window.electronAPI.getVersionInfo();
```

## Integration Roadmap

When AMARIS is ready to consume ClaudeCount data:

1. **Enable config flags** — set `AMARIS_ENABLED: true` and `AMARIS_API_URL` to the AMARIS endpoint
2. **Implement `_notifyAmarisApi()`** — replace the stub in `processMonitor.js` with actual HTTP POST calls
3. **Add authentication** — add API key or token to config, include in request headers
4. **Add bidirectional control** — AMARIS could send commands back (tag agents, request exports, inject prompts)
5. **Add WebSocket channel** — replace polling-based notification with persistent connection for real-time sync
6. **Add agent grouping UI** — use `projectGroup` and `tags` to organize the dashboard view

## Launcher Compatibility Notes

The `detectLauncher()` function in `processDetector.js` identifies the shell environment:

| Launcher | Detection Pattern | Notes |
|----------|-------------------|-------|
| `powershell` | Command line contains `powershell` or `pwsh` | Most common on Windows |
| `cmd` | Command line contains `cmd.exe` | Windows Command Prompt |
| `bash` | Command line contains `bash` or `/bin/bash` | Git Bash, MSYS2 |
| `wsl` | Command line contains `wsl` | Windows Subsystem for Linux |
| `vscode-terminal` | Command line contains `code` and `terminal` | VS Code integrated terminal |
| `unknown` | No pattern matched | Fallback |

Detection is heuristic and based on the spawning process command line. It works best when Claude CLI is launched directly from a recognizable shell. Agents launched via scripts or CI pipelines may report `unknown`.
