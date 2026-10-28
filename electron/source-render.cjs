const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { validateUrl } = require('./web.cjs');
const { validateRequest, fetchSource } = require('./sources.cjs');
const { getSourceSession } = require('./source-session.cjs');
const { sessionFetch } = require('./source-network.cjs');
const { watchSourceSearch, sourceSearchResponse } = require('./source-search-data.cjs');
const active = new Set();
const pendingReads = new Map();let nextRead = 0;
ipcMain.on('source-document:response', (event, message) => {
  const pending = message && pendingReads.get(message.id);
  if (!pending || event.sender !== pending.web || event.senderFrame !== event.sender.mainFrame) return;
  pending.finish(message.error ? new Error(message.error) : undefined, message.value);
});
function documentRequest(web, action, data = {}) {
  return new Promise((resolve,reject) => {
    const id = ++nextRead;
    const finish = (error,value) => { clearTimeout(timer);pendingReads.delete(id);web.removeListener('destroyed',closed);error ? reject(error) : resolve(value); };
    const closed = () => finish(new Error('站点窗口已关闭'));
    const timer = setTimeout(()=>finish(new Error('网页尚未就绪，请稍后重试')),3000);
    pendingReads.set(id,{web,finish});web.once('destroyed',closed);
    web.send('source-document:request',{id,action,...data});
  });
}

function secureSourceContents(web) {
  web.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) web.on(name, (event, url) => {
    const target = typeof url === 'string' ? url : event.url;
    if (name === 'will-frame-navigate' && !event.isMainFrame && target === 'about:blank') return;
    try { validateUrl(target); } catch { event.preventDefault(); }
  });
}

function loadOptions(request) {
  return {
    ...(request.referrer ? { httpReferrer: request.referrer } : {}),
    ...(request.method === 'POST' ? { postData: [{ type: 'rawData', bytes: Buffer.from(request.body || '') }], extraHeaders: 'Content-Type: application/x-www-form-urlencoded\r\n' } : {}),
  };
}

function loadDocument(web, url, options = {}, timeout = 20000) {
  return new Promise((resolve,reject) => {
    const finish = error => {
      clearTimeout(timer);web.removeListener('dom-ready',ready);web.removeListener('destroyed',closed);
      error ? reject(error) : resolve();
    };
    const ready = () => finish(), closed = () => finish(new Error('站点窗口已关闭'));
    const timer = setTimeout(()=>finish(new Error('站点响应超时')),timeout);
    web.once('dom-ready',ready);web.once('destroyed',closed);
    void web.loadURL(url,options).catch(finish);
  });
}

async function navigateSource(web, request) {
  validateRequest(request);
  // Submit POST searches from their own page so the browser supplies the site
  // origin and the site's form can supply its normal hidden fields and handlers.
  if (request.method === 'POST' && request.referrer && new URL(request.referrer).origin === new URL(request.url).origin) {
    await loadDocument(web,request.referrer,{},8000).catch(()=>{});
    if (web.isDestroyed()) return;
    if (new URL(web.getURL() || 'about:blank').origin === new URL(request.url).origin) {
      const submitted = await documentRequest(web,'submit',{request:{url:request.url,body:request.body}}).catch(() => false);
      if (submitted) return;
    }
  }
  await loadDocument(web,request.url,loadOptions(request));
}

async function captureSource(web, selector) {
  validateUrl(web.getURL());
  const snapshot = await documentRequest(web,'snapshot',{selector});
  if (!snapshot || typeof snapshot.text !== 'string') throw new Error('网页尚未加载，请稍后重试');
  if (Buffer.byteLength(snapshot.text) > 8 * 1024 * 1024) throw new Error('页面超过 8 MB，请打开更具体的结果页');
  return snapshot.access ? snapshot : sourceSearchResponse(web) || snapshot;
}

async function renderSource(request) {
  validateRequest(request);
  const win = new BrowserWindow({ show: false, webPreferences: { session: getSourceSession(), preload:path.join(__dirname,'source-document.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
  active.add(win);
  const web = win.webContents; secureSourceContents(web);
  watchSourceSearch(web);
  let status = 200, loadError, snapshot, stable = 0, previous = '', documentReady = false;
  const navigated = (_event, _url, code) => { if (code > 0) status = code; };
  web.on('did-navigate', navigated);
  web.on('dom-ready', () => { documentReady = true; });
  web.on('did-start-navigation', (_event,_url,inPlace,main) => { if (main && !inPlace) { documentReady = false;snapshot = undefined;previous = '';stable = 0; } });
  const deadline = Date.now() + 24000;
  let submitted = false;
  void navigateSource(web,request).then(() => { submitted = true; }).catch(error => { loadError = error; });
  try {
    while (!web.isDestroyed() && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 300));
      if (loadError && loadError.code !== 'ERR_ABORTED') throw new Error('站点页面加载失败，请打开站点窗口重试');
      if (!submitted || !documentReady || !web.getURL() || web.getURL() === 'about:blank') continue;
      try { snapshot = await captureSource(web, request.readySelector); } catch (error) {
        if (/8 MB|选择器/.test(error.message)) throw error;
        continue; // A client-side redirect may replace the document during capture.
      }
      stable = snapshot.text === previous ? stable + 1 : 0; previous = snapshot.text;
      if (snapshot.ready && stable >= 2) break;
      if (!request.readySelector && stable >= 4) break;
    }
    if (!snapshot) throw new Error('站点响应超时，请稍后重试或打开站点窗口');
    return { text: snapshot.text, url: snapshot.url, status:snapshot.status || status, contentType:snapshot.contentType || 'text/html', rendered: true, access: snapshot.access };
  } finally { active.delete(win); if (!win.isDestroyed()) win.destroy(); }
}

function closeSourceRenders() { for (const win of active) if (!win.isDestroyed()) win.destroy(); active.clear(); }
async function fetchDesktopSource(request) {
  validateRequest(request);
  if (request.render) return renderSource(request);
  const isolated = getSourceSession();
  return fetchSource(request, { fetch: (url, options) => sessionFetch(isolated,url,options), userAgent: isolated.getUserAgent() });
}
module.exports = { documentRequest, fetchDesktopSource, captureSource, navigateSource, secureSourceContents, closeSourceRenders };
