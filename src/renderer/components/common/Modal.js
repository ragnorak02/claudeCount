/**
 * Reusable modal component.
 */
export function showModal({ title, content, onClose, width = '500px' }) {
  const container = document.getElementById('modal-container');
  if (!container) return null;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = width;

  modal.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">${title || ''}</h3>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body"></div>
  `;

  const body = modal.querySelector('.modal-body');
  if (typeof content === 'string') {
    body.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    body.appendChild(content);
  }

  backdrop.appendChild(modal);
  container.appendChild(backdrop);

  // Animate in
  requestAnimationFrame(() => backdrop.classList.add('visible'));

  function close() {
    backdrop.classList.remove('visible');
    setTimeout(() => backdrop.remove(), 200);
    if (onClose) onClose();
  }

  modal.querySelector('.modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  // Escape to close
  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  return { close, body, modal };
}
