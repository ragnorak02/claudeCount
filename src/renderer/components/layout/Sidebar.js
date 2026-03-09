import store from '../../state/store';
import * as actions from '../../state/actions';
import { showToast } from '../common/Toast';

/**
 * Sidebar component — multi-project tree with worktrees.
 * All projects shown simultaneously, each expandable.
 */
export function createSidebar() {
  const sidebar = document.getElementById('sidebar');
  const projectSelector = document.getElementById('project-selector');
  const sidebarTree = document.getElementById('sidebar-tree');
  const btnAdd = document.getElementById('btn-add-project');
  const agentBadge = document.getElementById('agent-count-badge');

  let _unsubs = [];
  // Track which projects are collapsed (default: all expanded)
  const _collapsed = new Set();

  // --- Render full tree ---
  function render() {
    const projects = store.get('projects');
    const worktrees = store.get('worktrees');
    const agents = store.get('agents');
    const selectedProjectId = store.get('selectedProjectId');
    const selectedWorktreeId = store.get('selectedWorktreeId');

    renderProjectTree(projects, worktrees, agents, selectedProjectId, selectedWorktreeId);
    updateAgentCount(agents);
  }

  function renderProjectTree(projects, worktrees, agents, selectedProjectId, selectedWorktreeId) {
    // Hide the old dropdown area — repurpose as a header
    projectSelector.innerHTML = `
      <div class="sidebar-header-label">Projects</div>
    `;

    if (!projects.length) {
      sidebarTree.innerHTML = `
        <div class="sidebar-empty">
          No projects registered.<br/>Click + to add one.
        </div>
      `;
      return;
    }

    // Count agents per worktree
    const agentCounts = {};
    const attentionWts = new Set();
    for (const a of agents) {
      if (a.worktreeId) {
        agentCounts[a.worktreeId] = (agentCounts[a.worktreeId] || 0) + 1;
        if (a.status === 'waiting_input' || a.status === 'waiting_permission') {
          attentionWts.add(a.worktreeId);
        }
      }
    }

    // Count agents per project
    const projectAgentCounts = {};
    const projectAttention = new Set();
    for (const a of agents) {
      if (a.projectId) {
        projectAgentCounts[a.projectId] = (projectAgentCounts[a.projectId] || 0) + 1;
        if (a.status === 'waiting_input' || a.status === 'waiting_permission') {
          projectAttention.add(a.projectId);
        }
      }
    }

    // Group worktrees by project
    const wtByProject = {};
    for (const wt of worktrees) {
      if (!wtByProject[wt.projectId]) wtByProject[wt.projectId] = [];
      wtByProject[wt.projectId].push(wt);
    }

    sidebarTree.innerHTML = projects.map(p => {
      const isCollapsed = _collapsed.has(p.id);
      const pWorktrees = wtByProject[p.id] || [];
      const pAgentCount = projectAgentCounts[p.id] || 0;
      const hasAttention = projectAttention.has(p.id);
      const isSelected = p.id === selectedProjectId;

      const chevron = isCollapsed
        ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`
        : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

      const worktreeHtml = isCollapsed ? '' : pWorktrees.map(wt => {
        const isWtSelected = wt.id === selectedWorktreeId;
        const count = agentCounts[wt.id] || 0;
        const wtAttention = attentionWts.has(wt.id);

        let diffBadge = '';
        if (!wt.isMain) {
          if (wt.commitsAhead > 0) {
            diffBadge = `<span class="diff-badge ahead">+${wt.commitsAhead}</span>`;
          } else if (wt.commitsBehind > 0) {
            diffBadge = `<span class="diff-badge behind">-${wt.commitsBehind}</span>`;
          }
        }

        const icon = wt.isMain
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`;

        return `
          <div class="wt-item ${isWtSelected ? 'selected' : ''} ${wtAttention ? 'attention' : ''}"
               data-id="${wt.id}" data-path="${escHtml(wt.path)}" data-project-id="${p.id}">
            <div class="wt-icon">${icon}</div>
            <div class="wt-info">
              <div class="wt-branch">${escHtml(wt.isMain ? 'main' : wt.branch)}</div>
            </div>
            <div class="wt-badges">
              ${count > 0 ? `<span class="agent-badge ${wtAttention ? 'attention' : ''}">${count}</span>` : ''}
              ${diffBadge}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="project-section ${isSelected ? 'selected' : ''} ${hasAttention ? 'attention' : ''}" data-project-id="${p.id}">
          <div class="project-header" data-project-id="${p.id}">
            <div class="project-chevron">${chevron}</div>
            <div class="project-name">${escHtml(p.name)}</div>
            <div class="project-badges">
              ${pAgentCount > 0 ? `<span class="agent-badge small ${hasAttention ? 'attention' : ''}">${pAgentCount}</span>` : ''}
            </div>
            <button class="icon-btn tiny project-menu-btn" data-project-id="${p.id}" title="Project actions">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>
          </div>
          <div class="project-worktrees ${isCollapsed ? 'collapsed' : ''}">
            ${worktreeHtml}
          </div>
        </div>
      `;
    }).join('');

    // --- Wire event handlers ---

    // Project header click → toggle collapse
    sidebarTree.querySelectorAll('.project-header').forEach(el => {
      el.addEventListener('click', (e) => {
        // Don't toggle if clicking menu button
        if (e.target.closest('.project-menu-btn')) return;
        const pId = el.dataset.projectId;
        if (_collapsed.has(pId)) {
          _collapsed.delete(pId);
        } else {
          _collapsed.add(pId);
        }
        actions.selectProject(pId);
        render();
      });
    });

    // Project menu button
    sidebarTree.querySelectorAll('.project-menu-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const pId = el.dataset.projectId;
        showProjectContextMenu(e, pId);
      });
    });

    // Worktree click
    sidebarTree.querySelectorAll('.wt-item').forEach(el => {
      el.addEventListener('click', () => {
        actions.selectProject(el.dataset.projectId);
        actions.selectWorktree(el.dataset.id);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showWorktreeContextMenu(e, el.dataset.id, el.dataset.path, el.dataset.projectId);
      });
    });
  }

  function showProjectContextMenu(e, projectId) {
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();

    const project = store.get('projects').find(p => p.id === projectId);
    if (!project) return;

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';

    const items = [
      {
        label: 'Launch Agent',
        action: () => {
          const wts = store.get('worktrees').filter(w => w.projectId === projectId);
          const mainWt = wts.find(w => w.isMain) || wts[0];
          if (mainWt) {
            showAgentLauncher(mainWt.id, mainWt.path, project.name);
          } else {
            showToast('No worktrees found for this project', 'error');
          }
        },
      },
      {
        label: 'New Worktree',
        action: () => {
          actions.selectProject(projectId);
          window.dispatchEvent(new CustomEvent('show-create-worktree', { detail: { projectId } }));
        },
      },
      {
        label: 'Refresh Worktrees',
        action: async () => {
          await actions.loadWorktrees(projectId);
          showToast(`Refreshed worktrees for ${project.name}`, 'success');
        },
      },
      {
        label: 'Remove Project',
        action: async () => {
          if (confirm(`Remove "${project.name}" from ClaudeCount?`)) {
            await actions.removeProject(projectId);
          }
        },
        danger: true,
      },
    ];

    menu.innerHTML = items.map(i =>
      `<div class="context-item ${i.danger ? 'danger' : ''}">${escHtml(i.label)}</div>`
    ).join('');

    menu.querySelectorAll('.context-item').forEach((el, idx) => {
      el.addEventListener('click', () => {
        items[idx].action();
        menu.remove();
      });
    });

    document.body.appendChild(menu);
    const closeMenu = (e2) => {
      if (!menu.contains(e2.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  function showWorktreeContextMenu(e, worktreeId, wtPath, projectId) {
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();

    const wt = store.get('worktrees').find(w => w.id === worktreeId);
    if (!wt) return;

    const project = store.get('projects').find(p => p.id === projectId);
    const projectName = project ? project.name : '';

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';

    const items = [
      { label: 'Open Terminal', action: () => actions.openTerminal(wtPath, wt.branch) },
      { label: 'Launch Agent', action: () => showAgentLauncher(worktreeId, wtPath, projectName) },
      { label: 'Git Status', action: () => { /* TODO */ } },
    ];

    if (!wt.isMain) {
      items.push({
        label: 'Remove Worktree',
        action: async () => {
          if (confirm(`Remove worktree "${wt.branch}"?`)) {
            const result = await actions.removeWorktree(projectId, worktreeId);
            if (!result.ok) showToast(result.error, 'error');
          }
        },
        danger: true,
      });
    }

    menu.innerHTML = items.map(i =>
      `<div class="context-item ${i.danger ? 'danger' : ''}">${escHtml(i.label)}</div>`
    ).join('');

    menu.querySelectorAll('.context-item').forEach((el, idx) => {
      el.addEventListener('click', () => {
        items[idx].action();
        menu.remove();
      });
    });

    document.body.appendChild(menu);
    const closeMenu = (e2) => {
      if (!menu.contains(e2.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  function showAgentLauncher(worktreeId, wtPath, projectName) {
    window.dispatchEvent(new CustomEvent('show-agent-launcher', {
      detail: { worktreeId, worktreePath: wtPath, projectName }
    }));
  }

  // --- Agent count ---
  function updateAgentCount(agents) {
    const waiting = agents.filter(a => a.status === 'waiting_input' || a.status === 'waiting_permission').length;
    let text = `${agents.length} agent${agents.length !== 1 ? 's' : ''}`;
    if (waiting > 0) text += ` (${waiting} waiting)`;
    agentBadge.textContent = text;
  }

  // --- Add project ---
  btnAdd.addEventListener('click', async () => {
    const path = await actions.browseProjectPath();
    if (!path) return;

    const name = path.split(/[/\\]/).pop();
    const result = await actions.addProject(name, path);
    if (result.ok) {
      showToast(`Project "${name}" added`, 'success');
      // Load worktrees for the new project
      await actions.loadWorktrees(result.project.id);
      actions.selectProject(result.project.id);
    } else {
      showToast(result.error, 'error');
    }
  });

  // --- Subscriptions ---
  _unsubs.push(store.subscribe('projects', () => render()));
  _unsubs.push(store.subscribe('selectedProjectId', () => render()));
  _unsubs.push(store.subscribe('worktrees', () => render()));
  _unsubs.push(store.subscribe('selectedWorktreeId', () => render()));
  _unsubs.push(store.subscribe('agents', () => render()));

  // Sidebar toggle
  const toggleBtn = document.getElementById('sidebar-toggle');
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    actions.toggleSidebar();
  });

  // Initial render
  render();

  return {
    destroy() {
      _unsubs.forEach(fn => fn());
    }
  };
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
