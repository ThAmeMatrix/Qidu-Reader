const { BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');
const { validateUrl } = require('./web.cjs');
const { validateRequest } = require('./sources.cjs');
const { getSourceSession } = require('./source-session.cjs');
const { captureSource, navigateSource } = require('./source-render.cjs');
const { watchSourceSearch } = require('./source-search-data.cjs');
let current;

function validNavigation(url) { try { validateUrl(url); return true; } catch { return false; } }

function registerSourceWindow(getMainWindow) {
  ipcMain.handle('source-window:action', async (event, action) => {
    const state = current;
    if (!state || event.sender !== state.window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的站点窗口调用');
    const web = state.view.webContents;
    if (action === 'back' && web.navigationHistory.canGoBack()) web.navigationHistory.goBack();
    else if (action === 'forward' && web.navigationHistory.canGoForward()) web.navigationHistory.goForward();
    else if (action === 'reload') web.reload();
    else if (action === 'home') await web.loadURL(validateUrl(state.source.homepage || new URL(web.getURL()).origin).href);
    else if (action === 'resume-search') {
      await getSourceSession().cookies.flushStore();
      const main = getMainWindow();
      if (!main || main.isDestroyed()) throw new Error('栖读主窗口已关闭');
      main.webContents.send('sources:retry', { sourceId: state.source.id });
      if (process.env.QIDU_TEST_HIDE !== '1') { main.show(); main.focus(); }
      return '正在使用此站点的登录状态重新搜索，请返回栖读查看';
    }
    else if (action === 'capture-search' || action === 'capture-detail') {
      const { text, url, access, status, contentType } = await captureSource(web, state.request.readySelector);
      const main = getMainWindow();
      if (!main || main.isDestroyed()) throw new Error('栖读主窗口已关闭');
      main.webContents.send('sources:snapshot', { sourceId: state.source.id, text, url, access, status: status || 200, contentType: contentType || 'text/html', rendered: true, mode: action === 'capture-detail' ? 'detail' : 'search' });
      if (process.env.QIDU_TEST_HIDE !== '1') { main.show(); main.focus(); }
      return '已读取当前页，请返回栖读查看';
    }
    return '';
  });
}

async function openSourceWindow(source, request, mode, getMainWindow) {
  validateRequest(request);
  if (!source || !/^[\w-]{1,80}$/.test(source.id) || typeof source.name !== 'string' || source.name.length > 60 || !['search','detail'].includes(mode)) throw new Error('站点配置无效');
  if (source.homepage !== undefined) validateUrl(source.homepage);
  if (current && !current.window.isDestroyed()) current.window.close();
  const isolated = getSourceSession();
  const win = new BrowserWindow({ parent: getMainWindow(), show: process.env.QIDU_TEST_HIDE !== '1', width: 1120, height: 820, minWidth: 800, minHeight: 600, title: `${source.name} · 栖读站点窗口`, autoHideMenuBar: true, backgroundColor: '#f8f7f3', webPreferences: { preload: path.join(__dirname,'source-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const view = new WebContentsView({ webPreferences: { session: isolated, preload:path.join(__dirname,'source-document.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  watchSourceSearch(view.webContents);
  win.contentView.addChildView(view);
  const state = { window: win, view, source, mode, request }; current = state;
  const resize = () => { const [width,height] = win.getContentSize(); view.setBounds({ x:0,y:88,width,height:Math.max(0,height-88) }); };
  resize(); win.on('resize',resize);
  const publish = (error = '') => { if (!win.isDestroyed()) win.webContents.send('source-window:state', { name: source.name, url: view.webContents.getURL(), loading: view.webContents.isLoading(), mode, error }); };
  view.webContents.setWindowOpenHandler(({ url }) => { if (validNavigation(url)) void view.webContents.loadURL(url).catch(() => {}); return { action:'deny' }; });
  for (const name of ['will-navigate','will-redirect','will-frame-navigate']) view.webContents.on(name, (event, url) => { const target = typeof url === 'string' ? url : event.url; if (!(name === 'will-frame-navigate' && !event.isMainFrame && target === 'about:blank') && !validNavigation(target)) event.preventDefault(); });
  view.webContents.on('did-start-loading', () => publish()); view.webContents.on('did-stop-loading', () => publish());
  view.webContents.on('did-fail-load', (_event,code,description,_url,isMain) => { if (isMain && code !== -3) publish(`加载失败：${description}`); });
  win.webContents.setWindowOpenHandler(() => ({ action:'deny' })); win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('closed', () => { if (!view.webContents.isDestroyed()) view.webContents.close(); if (current === state) current = undefined; });
  await win.loadFile(path.join(__dirname,'source-window.html')); publish();
  void navigateSource(view.webContents, request).catch(error => publish(error.message));
}
module.exports = { registerSourceWindow, openSourceWindow };
