# ClaudeCount — Hybrid Launcher + PTY Mission Control + Optional Viewer Window (Mode C)
Version: 1.3
Primary Mode: C — PTY-owned sessions inside ClaudeCount + Optional Viewer Window
Secondary Mode: Manual sessions still detected (best-effort)
Platform: Windows Desktop (Electron + Node.js)
Scope: Deterministic implementation plan with checkpointed phases and checkboxes

You are a senior Electron + Node.js engineer.

This task upgrades ClaudeCount from a process-only monitor into a hybrid orchestrator:
- ClaudeCount can launch and own Claude sessions (PTY) for reliable output capture + input injection.
- ClaudeCount can also detect manually-launched sessions (best-effort).
- ClaudeCount includes an optional Viewer Window for downstairs visibility.

DO NOT redesign the UI beyond what is required.
DO NOT add cloud sync in this version.
Keep architecture modular and future-proof.

---

# CORE GOALS

- Own Claude sessions via PTY
- Project registry (eliminate manual z: and cd navigation)
- One-click launch per project
- Auto-prime: "read claude.md and wait my command"
- Interactive prompt detection
- Input injection
- Attention state system
- Optional Viewer window
- Stable with 10–15 concurrent sessions

---

# REQUIRED ARCHITECTURE

/main
  main.js
  windows/
    mainWindow.js
    viewerWindow.js
  services/
    processMonitor.js
    ptySessionManager.js
    projectRegistry.js
    sessionStateParser.js
    logger.js
  ipc/
    channels.js
    handlers.js

/renderer
  index.html
  app.js
  components/
    SessionCard.js
    ProjectPicker.js
  styles/
    global.css

/data
  projects.json
  settings.json

---

# PHASE 1 — Project Registry

Objective: Remove manual directory navigation.

- [ ] Create data/projects.json
- [ ] Define schema:
      name
      path
      enabled
- [ ] Implement projectRegistry.js
- [ ] Validate project paths
- [ ] Add ProjectPicker dropdown
- [ ] Add Launch Agent button
- [ ] Handle missing/invalid JSON safely
- [ ] Persist project changes
- [ ] Test multiple projects
- [ ] Confirm registry loads on startup

Exit: User can select a project without manual cd.

---

# PHASE 2 — PTY Session Ownership

Objective: ClaudeCount owns sessions.

- [ ] Add node-pty dependency
- [ ] Implement createSession(projectPath)
- [ ] Spawn PTY with correct cwd
- [ ] Run "claude"
- [ ] Assign UUID sessionId
- [ ] Store pid, cwd, startTime
- [ ] Capture stdout stream
- [ ] Implement sendInput(sessionId, text)
- [ ] Implement per-session ring buffer (max 2000 lines)
- [ ] Handle termination gracefully

Exit: Sessions launch and stream output reliably.

---

# PHASE 3 — Auto Prime on Launch

Objective: Automatically send initialization command.

- [ ] Add autoPrime setting (default true)
- [ ] After spawn delay, send:
      read claude.md and wait my command
- [ ] Ensure newline is appended
- [ ] Log auto-prime action
- [ ] Add toggle in settings (optional)
- [ ] Confirm message is received in session

Exit: New sessions auto-initialize consistently.

---

# PHASE 4 — Managed vs External Sessions

Objective: Support hybrid mode.

- [ ] Implement processMonitor.js scan (1–2s interval)
- [ ] Detect claude processes
- [ ] Deduplicate managed PIDs
- [ ] Tag session type:
      MANAGED
      EXTERNAL
- [ ] Display badge in UI
- [ ] External sessions show limited capability
- [ ] Ensure no duplicate listing
- [ ] Test manual + managed sessions together

Exit: Hybrid support working.

---

# PHASE 5 — Interactive Prompt Detection

Objective: Detect approval/waiting states.

Detect keywords:
- Do you want to
- require approval
- 1. Yes
- 2. No
- waiting
- permission

- [ ] Implement sessionStateParser.js
- [ ] Analyze recent output buffer
- [ ] Extract interactive block
- [ ] Create summary version
- [ ] Create expandable full version
- [ ] Update session state enum:
      RUNNING
      WAITING_PERMISSION
      WAITING_INPUT
      PAUSED
      ERROR
      UNKNOWN
- [ ] Render summary in yellow zone
- [ ] Ensure full logs are NOT dumped in yellow zone
- [ ] Test with real approval prompt

Exit: Yellow zone updates when approval appears.

---

# PHASE 6 — Input Injection

Objective: Nudge sessions from ClaudeCount.

- [ ] Add input field below yellow zone
- [ ] Add Send button
- [ ] Add Enter-to-send
- [ ] IPC renderer → main wiring
- [ ] sendInput(sessionId, text + newline)
- [ ] Append user message to log with prefix
- [ ] Clear WAITING state after send
- [ ] Handle ended session errors
- [ ] Confirm approval resumes session

Exit: User can send “1” and resume agent.

---

# PHASE 7 — Attention Visual System

Objective: Instantly identify blocked agents.

- [ ] WAITING_PERMISSION → yellow highlight
- [ ] WAITING_INPUT → orange
- [ ] ERROR → red
- [ ] RUNNING → neutral
- [ ] Add state badge on SessionCard
- [ ] Add minimal pulse animation
- [ ] Add sort by "Needs Attention"
- [ ] Maintain compact layout density
- [ ] Test with 10–15 sessions

Exit: Blocked sessions obvious at glance.

---

# PHASE 8 — Viewer Window (Downstairs Visibility)

Objective: Separate read-only viewer window.

- [ ] Implement viewerWindow.js
- [ ] Add Open Viewer button
- [ ] Display large font stream
- [ ] Support session selection dropdown
- [ ] Auto-scroll toggle
- [ ] Throttle updates
- [ ] Ensure read-only
- [ ] Test open/close cycles
- [ ] Confirm real-time sync

Exit: User can visually monitor sessions from another room.

---

# PHASE 9 — Admin Mode Handling

Objective: Avoid unnecessary elevation dependency.

- [ ] Detect elevation at startup
- [ ] Show banner if non-admin
- [ ] Ensure managed sessions still work non-admin
- [ ] Document features requiring admin (if any)
- [ ] Confirm no crash without elevation

Exit: App runs safely without mandatory admin.

---

# PHASE 10 — Stability & Performance

Objective: Reliable at scale.

- [ ] Ring buffer per session
- [ ] Diff-based UI updates
- [ ] Throttle stdout rendering
- [ ] Test rapid open/close
- [ ] Test long-running sessions (30+ minutes)
- [ ] Verify memory stable
- [ ] Verify CPU reasonable
- [ ] No UI lag
- [ ] No memory leaks
- [ ] Log warnings for abnormal states

Exit: Stable under 10–15 concurrent sessions.

---

# SUCCESS CRITERIA

- Managed sessions launch from project registry
- Auto-prime works
- Interactive prompts detected
- Input injection works
- Attention system functional
- Viewer window displays live output
- Manual sessions still visible
- Stable under load

---

# FUTURE (DO NOT IMPLEMENT NOW)

- LAN/mobile control
- Auth for remote access
- Multi-machine orchestration
- Token/context display parsing