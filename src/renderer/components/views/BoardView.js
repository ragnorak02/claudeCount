import store from '../../state/store';
import * as actions from '../../state/actions';
import { showModal } from '../common/Modal';
import { showToast } from '../common/Toast';

const COLUMNS = [
  { id: 'queued', label: 'Queued', color: '#8b949e' },
  { id: 'in_progress', label: 'In Progress', color: '#f0883e' },
  { id: 'done', label: 'Done', color: '#3fb950' },
  { id: 'failed', label: 'Failed', color: '#f85149' },
];

let _container = null;
let _unsubs = [];

export const BoardView = {
  create(container) {
    _container = container;
    _container.className = 'view-board';

    render();

    _unsubs.push(store.subscribe('tasks', render));
    _unsubs.push(store.subscribe('agents', render));
    _unsubs.push(store.subscribe('worktrees', render));
  },

  destroy() {
    _unsubs.forEach(fn => fn());
    _unsubs = [];
    _container = null;
  },
};

function render() {
  if (!_container) return;
  const tasks = store.get('tasks');
  const agents = store.get('agents');
  const worktrees = store.get('worktrees');
  const projectId = store.get('selectedProjectId');

  _container.innerHTML = `
    <div class="board-header">
      <h2 class="board-title">Board</h2>
      <div class="board-meta">
        <span>${worktrees.length} worktrees, ${agents.length} agents</span>
      </div>
    </div>
    <div class="board-columns">
      ${COLUMNS.map(col => {
        const colTasks = tasks.filter(t => t.status === col.id);
        return `
          <div class="board-column" data-status="${col.id}">
            <div class="column-header">
              <span class="column-dot" style="background:${col.color}"></span>
              <span class="column-label">${col.label}</span>
              <span class="column-count">${colTasks.length}</span>
            </div>
            <div class="column-body" data-status="${col.id}">
              ${colTasks.map(task => renderTaskCard(task, agents)).join('')}
              ${colTasks.length === 0 ? '<div class="column-empty">No tasks</div>' : ''}
            </div>
            ${col.id === 'queued' ? `<button class="add-task-btn" data-project="${projectId || ''}">+ Add Task</button>` : ''}
          </div>
        `;
      }).join('')}
    </div>
    <div class="board-worktrees">
      <div class="board-worktrees-grid">
        ${worktrees.map(wt => renderWorktreeCard(wt, agents)).join('')}
      </div>
    </div>
  `;

  // Wire events
  _container.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', () => showTaskDetail(card.dataset.id));
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
  });

  _container.querySelectorAll('.column-body').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      await actions.updateTask(taskId, { status: newStatus });
    });
  });

  _container.querySelectorAll('.add-task-btn').forEach(btn => {
    btn.addEventListener('click', () => showAddTaskModal(btn.dataset.project));
  });

  _container.querySelectorAll('.wt-card').forEach(card => {
    card.addEventListener('click', () => {
      actions.selectWorktree(card.dataset.id);
    });
  });
}

function renderTaskCard(task, agents) {
  const agent = agents.find(a => a.id === task.agentId);
  const typeBadge = task.agentType || 'claude';

  return `
    <div class="task-card" data-id="${task.id}">
      <div class="task-card-header">
        <span class="task-agent-badge badge-${typeBadge}">${typeBadge}</span>
        ${agent ? `<span class="task-status-dot status-${agent.status}"></span>` : ''}
      </div>
      <div class="task-card-title">${escHtml(task.title)}</div>
      ${task.description ? `<div class="task-card-desc">${escHtml(task.description).substring(0, 80)}</div>` : ''}
    </div>
  `;
}

function renderWorktreeCard(wt, agents) {
  const wtAgents = agents.filter(a => a.worktreeId === wt.id);
  const hasAttention = wtAgents.some(a => a.status === 'waiting_input' || a.status === 'waiting_permission');
  const isActive = wtAgents.length > 0;

  let diffBadge = '';
  if (!wt.isMain && wt.commitsAhead > 0) {
    diffBadge = `<span class="diff-badge ahead">+${wt.commitsAhead}</span>`;
  } else if (!wt.isMain && wt.commitsBehind > 0) {
    diffBadge = `<span class="diff-badge behind">-${wt.commitsBehind}</span>`;
  }

  return `
    <div class="wt-card ${isActive ? 'active' : 'idle'} ${hasAttention ? 'attention' : ''}" data-id="${wt.id}">
      <div class="wt-card-icon">
        ${wt.isMain
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>'
        }
      </div>
      <div class="wt-card-branch">${escHtml(wt.isMain ? 'main' : wt.branch)}</div>
      <div class="wt-card-meta">
        ${wtAgents.length > 0
          ? `<span class="agent-badge ${hasAttention ? 'attention' : ''}">${wtAgents.length} agent${wtAgents.length > 1 ? 's' : ''}</span>`
          : '<span class="idle-label">idle</span>'
        }
        ${diffBadge}
      </div>
    </div>
  `;
}

function showAddTaskModal(projectId) {
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="task-title" class="form-input" placeholder="Task title" />
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="task-desc" class="form-input" rows="3" placeholder="Optional description"></textarea>
    </div>
    <div class="form-group">
      <label>Agent Type</label>
      <select id="task-agent-type" class="form-input">
        <option value="claude">Claude Code</option>
        <option value="codex">Codex</option>
      </select>
    </div>
    <div class="form-actions">
      <button id="task-submit" class="btn btn-primary">Create Task</button>
    </div>
  `;

  const modal = showModal({ title: 'New Task', content: form });

  form.querySelector('#task-submit').addEventListener('click', async () => {
    const title = form.querySelector('#task-title').value.trim();
    if (!title) return;
    const result = await actions.createTask({
      projectId: projectId || null,
      title,
      description: form.querySelector('#task-desc').value.trim(),
      agentType: form.querySelector('#task-agent-type').value,
    });
    if (result.ok) {
      modal.close();
      showToast('Task created', 'success');
    }
  });
}

function showTaskDetail(taskId) {
  const task = store.get('tasks').find(t => t.id === taskId);
  if (!task) return;

  const content = document.createElement('div');
  content.innerHTML = `
    <div class="task-detail">
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="detail-title" class="form-input" value="${escHtml(task.title)}" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="detail-desc" class="form-input" rows="3">${escHtml(task.description)}</textarea>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select id="detail-status" class="form-input">
          ${COLUMNS.map(c => `<option value="${c.id}" ${task.status === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-actions">
        <button id="detail-save" class="btn btn-primary">Save</button>
        <button id="detail-delete" class="btn btn-danger">Delete</button>
      </div>
    </div>
  `;

  const modal = showModal({ title: 'Task Details', content });

  content.querySelector('#detail-save').addEventListener('click', async () => {
    await actions.updateTask(taskId, {
      title: content.querySelector('#detail-title').value.trim(),
      description: content.querySelector('#detail-desc').value.trim(),
      status: content.querySelector('#detail-status').value,
    });
    modal.close();
  });

  content.querySelector('#detail-delete').addEventListener('click', async () => {
    if (confirm('Delete this task?')) {
      await actions.deleteTask(taskId);
      modal.close();
    }
  });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
