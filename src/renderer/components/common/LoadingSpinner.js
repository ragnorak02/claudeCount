/**
 * Loading spinner overlay.
 */
export function showLoading(text = 'Loading...') {
  const overlay = document.getElementById('loading-overlay');
  const spinnerText = document.getElementById('spinner-text');
  if (!overlay) return;
  spinnerText.textContent = text;
  overlay.classList.remove('hidden');
}

export function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
}
