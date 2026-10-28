const status = document.getElementById('status');
window.sourceWindow.onState(value => { document.getElementById('name').textContent = value.name; document.getElementById('url').textContent = value.url;document.getElementById('resume').hidden=value.mode!=='search';status.textContent = value.error || (value.loading ? '正在加载…' : '登录或验证完成后，点击重试即可返回搜索。'); });
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try { const message = await window.sourceWindow.action(button.dataset.action); if (message) status.textContent = message; } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
}));
