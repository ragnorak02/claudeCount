// --- Module State ---
let selectedProjectId = null;

// --- DOM References (set in init) ---
let projectPanel, projectPanelToggle, projectSelect;
let launchAgentBtn, pathPreview, manageProjectsBtn;

// --- Public API ---

export async function initProjectPicker() {
  projectPanel = document.getElementById('project-panel');
  projectPanelToggle = document.getElementById('project-panel-toggle');
  projectSelect = document.getElementById('project-select');
  launchAgentBtn = document.getElementById('launch-agent-btn');
  pathPreview = document.getElementById('project-path-preview');
  manageProjectsBtn = document.getElementById('manage-projects-btn');

  // Panel toggle
  projectPanelToggle.addEventListener('click', () => {
    projectPanel.classList.toggle('collapsed');
    if (!projectPanel.classList.contains('collapsed')) {
      refreshProjects();
    }
  });

  // Dropdown change
  projectSelect.addEventListener('change', () => {
    selectedProjectId = projectSelect.value || null;
    updatePathPreview();
    launchAgentBtn.disabled = !selectedProjectId;
  });

  // Launch Agent via PTY
  launchAgentBtn.addEventListener('click', async () => {
    if (!selectedProjectId) return;
    launchAgentBtn.textContent = 'Launching...';
    launchAgentBtn.disabled = true;
    try {
      const result = await window.electronAPI.launchAgent(selectedProjectId);
      if (result.ok) {
        launchAgentBtn.textContent = 'Launched!';
      } else {
        launchAgentBtn.textContent = result.error || 'Failed';
      }
    } catch (err) {
      launchAgentBtn.textContent = 'Error';
      console.error('[ClaudeCount] Launch failed:', err);
    }
    setTimeout(() => {
      launchAgentBtn.textContent = 'Launch Agent';
      launchAgentBtn.disabled = !selectedProjectId;
    }, 2000);
  });

  // Manage Projects
  manageProjectsBtn.addEventListener('click', () => {
    openProjectManager();
  });

  // Initial load
  await refreshProjects();
}

export function getSelectedProject() {
  if (!selectedProjectId) return null;
  const option = projectSelect.querySelector(`option[value="${selectedProjectId}"]`);
  if (!option) return null;
  return { id: selectedProjectId, name: option.textContent, path: option.dataset.path };
}

export async function refreshProjects() {
  try {
    const projects = await window.electronAPI.getEnabledProjects();
    const previousSelection = selectedProjectId;

    // Clear options (keep placeholder)
    projectSelect.innerHTML = '<option value="">-- Select Project --</option>';

    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      opt.dataset.path = p.path;
      projectSelect.appendChild(opt);
    }

    // Restore selection if still valid
    if (previousSelection && projects.some((p) => p.id === previousSelection)) {
      projectSelect.value = previousSelection;
      selectedProjectId = previousSelection;
    } else {
      selectedProjectId = null;
      projectSelect.value = '';
    }

    launchAgentBtn.disabled = !selectedProjectId;
    updatePathPreview();
  } catch (err) {
    console.error('[ClaudeCount] Failed to load projects:', err);
  }
}

// --- Internal Helpers ---

function updatePathPreview() {
  if (!selectedProjectId) {
    pathPreview.textContent = 'No project selected';
    return;
  }
  const option = projectSelect.querySelector(`option[value="${selectedProjectId}"]`);
  pathPreview.textContent = option ? option.dataset.path : 'No project selected';
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// --- Project Manager Modal ---

function openProjectManager() {
  // Prevent duplicate
  if (document.querySelector('.pm-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'pm-overlay';
  overlay.innerHTML = `
    <div class="pm-backdrop"></div>
    <div class="pm-container">
      <div class="pm-header">
        <h2>Manage Projects</h2>
        <button class="pm-close-btn" type="button">&times;</button>
      </div>
      <div class="pm-body">
        <div class="pm-add-form">
          <div class="pm-add-row">
            <input class="pm-input" id="pm-name-input" type="text" placeholder="Project name" />
          </div>
          <div class="pm-add-row">
            <input class="pm-input path-input" id="pm-path-input" type="text" placeholder="Path (use Browse)" readonly />
            <button class="pm-btn" id="pm-browse-btn" type="button">Browse</button>
          </div>
          <div class="pm-add-row">
            <button class="pm-btn primary" id="pm-add-btn" type="button" disabled>Add Project</button>
          </div>
          <div class="pm-error" id="pm-error"></div>
        </div>
        <div class="pm-project-list" id="pm-project-list"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // References
  const closeBtn = overlay.querySelector('.pm-close-btn');
  const backdrop = overlay.querySelector('.pm-backdrop');
  const nameInput = overlay.querySelector('#pm-name-input');
  const pathInput = overlay.querySelector('#pm-path-input');
  const browseBtn = overlay.querySelector('#pm-browse-btn');
  const addBtn = overlay.querySelector('#pm-add-btn');
  const errorEl = overlay.querySelector('#pm-error');
  const listEl = overlay.querySelector('#pm-project-list');

  // Close
  function close() {
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.remove();
      refreshProjects();
    }, 200);
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Enable add button when both fields have values
  function updateAddBtn() {
    addBtn.disabled = !(nameInput.value.trim() && pathInput.value.trim());
  }
  nameInput.addEventListener('input', updateAddBtn);

  // Browse
  browseBtn.addEventListener('click', async () => {
    const selectedPath = await window.electronAPI.browseProjectPath();
    if (selectedPath) {
      pathInput.value = selectedPath;
      // Auto-fill name from folder name if name is empty
      if (!nameInput.value.trim()) {
        const parts = selectedPath.replace(/\\/g, '/').split('/');
        nameInput.value = parts[parts.length - 1] || '';
      }
      updateAddBtn();
    }
  });

  // Add project
  addBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const name = nameInput.value.trim();
    const projPath = pathInput.value.trim();
    if (!name || !projPath) return;

    addBtn.disabled = true;
    const result = await window.electronAPI.addProject(name, projPath);
    if (result.ok) {
      nameInput.value = '';
      pathInput.value = '';
      updateAddBtn();
      await renderProjectList(listEl, errorEl);
    } else {
      errorEl.textContent = result.error || 'Failed to add project';
      addBtn.disabled = false;
    }
  });

  // Enter key in name input
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !addBtn.disabled) {
      addBtn.click();
    }
  });

  // Initial render
  renderProjectList(listEl, errorEl);
}

async function renderProjectList(listEl, errorEl) {
  try {
    const projects = await window.electronAPI.getProjects();

    if (projects.length === 0) {
      listEl.innerHTML = '<div class="pm-empty">No projects added yet</div>';
      return;
    }

    listEl.innerHTML = '';
    for (const p of projects) {
      const item = document.createElement('div');
      item.className = 'pm-project-item' + (p.enabled ? '' : ' disabled');
      item.innerHTML = `
        <div class="pm-project-info">
          <div class="pm-project-name">${escapeHtml(p.name)}</div>
          <div class="pm-project-path">${escapeHtml(p.path)}</div>
        </div>
        <div class="pm-project-actions">
          <button class="pm-toggle-btn" data-id="${p.id}" type="button">${p.enabled ? 'Disable' : 'Enable'}</button>
          <button class="pm-remove-btn" data-id="${p.id}" type="button">Remove</button>
        </div>
      `;

      // Toggle enabled
      item.querySelector('.pm-toggle-btn').addEventListener('click', async () => {
        const res = await window.electronAPI.updateProject(p.id, { enabled: !p.enabled });
        if (res.ok) {
          await renderProjectList(listEl, errorEl);
        } else {
          errorEl.textContent = res.error || 'Update failed';
        }
      });

      // Remove
      item.querySelector('.pm-remove-btn').addEventListener('click', async () => {
        const res = await window.electronAPI.removeProject(p.id);
        if (res.ok) {
          await renderProjectList(listEl, errorEl);
        } else {
          errorEl.textContent = res.error || 'Remove failed';
        }
      });

      listEl.appendChild(item);
    }
  } catch (err) {
    listEl.innerHTML = '<div class="pm-empty">Failed to load projects</div>';
  }
}
