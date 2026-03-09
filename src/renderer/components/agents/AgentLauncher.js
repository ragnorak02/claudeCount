import store from '../../state/store';
import * as actions from '../../state/actions';
import { showModal } from '../common/Modal';
import { showToast } from '../common/Toast';

/**
 * Agent launcher modal — pick project, worktree, type, prompt, and launch.
 * Shows the project/repo name in the title.
 */
export function initAgentLauncher() {
  window.addEventListener('show-agent-launcher', (e) => {
    const { worktreeId, worktreePath, projectName } = e.detail || {};
    showAgentLauncherModal(worktreeId, worktreePath, projectName);
  });
}

function showAgentLauncherModal(preselectedWorktreeId, preselectedPath, projectName) {
  const projects = store.get('projects');
  const allWorktrees = store.get('worktrees');

  // Determine which project is preselected
  let preselectedProjectId = null;
  if (preselectedWorktreeId) {
    const wt = allWorktrees.find(w => w.id === preselectedWorktreeId);
    if (wt) preselectedProjectId = wt.projectId;
  }
  if (!preselectedProjectId) {
    preselectedProjectId = store.get('selectedProjectId');
  }

  // Resolve project name from ID if not passed
  if (!projectName && preselectedProjectId) {
    const p = projects.find(pr => pr.id === preselectedProjectId);
    if (p) projectName = p.name;
  }

  const title = projectName ? `Launch Agent — ${projectName}` : 'Launch Agent';

  const form = document.createElement('div');
  form.className = 'agent-launcher-form';

  function buildWorktreeOptions(forProjectId) {
    const wts = allWorktrees.filter(w => w.projectId === forProjectId);
    if (!wts.length) return '<option value="">— No worktrees —</option>';
    return wts.map(wt => `
      <option value="${wt.id}" data-path="${escHtml(wt.path)}"
        ${wt.id === preselectedWorktreeId ? 'selected' : ''}>
        ${escHtml(wt.isMain ? 'main' : wt.branch)}
      </option>
    `).join('');
  }

  form.innerHTML = `
    <div class="form-group">
      <label>Project</label>
      <select id="al-project" class="form-input">
        ${projects.map(p => `
          <option value="${p.id}" ${p.id === preselectedProjectId ? 'selected' : ''}>
            ${escHtml(p.name)}
          </option>
        `).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Worktree</label>
      <select id="al-worktree" class="form-input">
        ${buildWorktreeOptions(preselectedProjectId)}
      </select>
    </div>
    <div class="form-group">
      <label>Agent Type</label>
      <select id="al-type" class="form-input">
        <option value="claude">Claude Code</option>
        <option value="codex">Codex</option>
        <option value="shell">Shell</option>
      </select>
    </div>
    <div class="form-group">
      <label>Prompt / Task (optional)</label>
      <textarea id="al-prompt" class="form-input" rows="3" placeholder="Describe the task for this agent..."></textarea>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="al-autoprime" checked />
        Auto-prime (read claude.md and wait)
      </label>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="al-skip-permissions" />
        Skip permissions (--dangerously-skip-permissions)
      </label>
    </div>
    <div class="form-actions">
      <button id="al-launch" class="btn btn-primary">Launch Agent</button>
    </div>
  `;

  const modal = showModal({ title, content: form, width: '480px' });

  // When project changes, update worktree list + modal title
  const projectSelect = form.querySelector('#al-project');
  const wtSelect = form.querySelector('#al-worktree');

  projectSelect.addEventListener('change', () => {
    const pId = projectSelect.value;
    wtSelect.innerHTML = buildWorktreeOptions(pId);

    // Update modal title
    const p = projects.find(pr => pr.id === pId);
    const titleEl = modal.modal?.querySelector('.modal-title');
    if (titleEl && p) {
      titleEl.textContent = `Launch Agent — ${p.name}`;
    }
  });

  form.querySelector('#al-launch').addEventListener('click', async () => {
    const selectedProjectId = projectSelect.value;
    const selectedOption = wtSelect.options[wtSelect.selectedIndex];
    const worktreeId = wtSelect.value;
    const worktreePath = selectedOption?.dataset?.path || preselectedPath;
    const agentType = form.querySelector('#al-type').value;
    const prompt = form.querySelector('#al-prompt').value.trim();
    const autoPrime = form.querySelector('#al-autoprime').checked;
    const skipPermissions = form.querySelector('#al-skip-permissions').checked;

    if (!worktreeId || !worktreePath) {
      showToast('Select a worktree', 'error');
      return;
    }

    const result = await actions.launchAgent({
      worktreeId,
      worktreePath,
      projectId: selectedProjectId,
      agentType,
      prompt,
      autoPrime,
      skipPermissions,
    });

    if (result.ok) {
      modal.close();
      const pName = projects.find(p => p.id === selectedProjectId)?.name || '';
      const branch = selectedOption?.textContent?.trim() || '';
      showToast(`Agent launched: ${pName} / ${branch}`, 'success');
      actions.setView('terminal');
    } else {
      showToast(result.error || 'Failed to launch agent', 'error');
    }
  });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
