const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { fetchArticle } = require('./web.cjs');
const { fetchDesktopSource, closeSourceRenders } = require('./source-render.cjs');
const { registerSourceWindow, openSourceWindow } = require('./source-window.cjs');
const { createDownloadManager } = require('./downloads.cjs');
const { getSourceSession } = require('./source-session.cjs');
const { sessionFetch } = require('./source-network.cjs');
const {createTorrentEngine}=require('./torrent-engine.cjs');
const {registerDownloadWindow}=require('./download-window.cjs');
let torrentEngine;
function torrents(){if(!torrentEngine)torrentEngine=createTorrentEngine({binary:app.isPackaged?path.join(process.resourcesPath,'aria2','aria2c.exe'):path.join(__dirname,'../vendor/aria2/aria2c.exe'),directory:path.join(app.getPath('userData'),'torrent-cache'),localOnly:!!process.env.QIDU_TEST_USER_DATA&&process.env.QIDU_TEST_TORRENT_LOCAL==='1',fetch:(url,options)=>sessionFetch(getSourceSession(),url,options)});return torrentEngine;}

let mainWindow;
let downloadManager;
function downloads() {
  if (!downloadManager) downloadManager = createDownloadManager({
    directory:path.join(app.getPath('userData'),'book-downloads'),
    fetch:(url,options)=>sessionFetch(getSourceSession(),url,options),
    userAgent:getSourceSession().getUserAgent(),
    archiveExtract:(file,options)=>require('./archive.cjs').extractArchive(file,{...options,executable:app.isPackaged?path.join(process.resourcesPath,'sevenzip','7z.exe'):path.join(__dirname,'../vendor/sevenzip/7z.exe')}),
    torrentTransfer:(...args)=>torrents().transfer(...args),
    onChange:jobs=>{ if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('downloads:changed',jobs); },
  });
  return downloadManager;
}
const devUrl = process.env.QIDU_DEV_URL;
if (process.env.QIDU_TEST_USER_DATA) app.setPath('userData', process.env.QIDU_TEST_USER_DATA);
app.setName('栖读');

function trusted(event) {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的调用来源');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1000, minHeight: 700,
    title: '栖读 · 给阅读一个安静的空间', backgroundColor: '#f8f7f3',
    frame: false, autoHideMenuBar: true, icon: path.join(__dirname, '../build/icon.ico'),
    show: process.env.QIDU_TEST_HIDE !== '1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, spellcheck: false,
      backgroundThrottling: process.env.QIDU_TEST_HIDE !== '1',
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: '导出栖读数据', defaultPath: item.getFilename() });
  });
  if (devUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(devUrl)) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; closeSourceRenders(); });
}

ipcMain.handle('files:pick', async event => {
  trusted(event);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '把好书带回书架', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '书籍与文章', extensions: ['txt', 'epub', 'pdf', 'html', 'htm', 'md', 'markdown'] }],
  });
  if (result.canceled) return [];
  if (result.filePaths.length > 30) throw new Error('每次最多导入 30 个文件');
  const files = [];
  for (const filePath of result.filePaths) {
    const stat = await fs.stat(filePath);
    if (stat.size > 100 * 1024 * 1024) throw new Error(`${path.basename(filePath)} 超过 100 MB，请选择较小的文件`);
    files.push({ name: path.basename(filePath), data: new Uint8Array(await fs.readFile(filePath)) });
  }
  return files;
});
ipcMain.handle('article:fetch', (event, url) => { trusted(event); return fetchArticle(url); });
ipcMain.handle('sources:fetch', (event, request) => { trusted(event); return fetchDesktopSource(request); });
ipcMain.handle('sources:open', (event, source, request, mode) => { trusted(event); return openSourceWindow(source, request, mode, () => mainWindow); });
registerSourceWindow(() => mainWindow);
const openDownloadWindow=registerDownloadWindow(()=>mainWindow,downloads);
ipcMain.handle('downloads:cloud-context',(event,{id,active})=>{trusted(event);openDownloadWindow.setContext(id,active);});
ipcMain.handle('downloads:stop-cloud',(event,id)=>{trusted(event);openDownloadWindow.stop(id);});
ipcMain.handle('downloads:open-cloud',(event,context)=>{trusted(event);return openDownloadWindow(context);});
ipcMain.handle('downloads:resolve-torrent',(event,{url,id})=>{trusted(event);return torrents().inspect(url,id);});
ipcMain.handle('downloads:cancel-resolution',(event,id)=>{trusted(event);torrents().cancel(id);});
for (const action of ['list','start','cancel','retry','read','remove','acknowledge','extract']) ipcMain.handle(`downloads:${action}`, (event,value) => { trusted(event);return downloads()[action](value); });
ipcMain.handle('downloads:save', (event,id) => {
  trusted(event);return downloads().save(id,async(name,format)=>{
    const result=await dialog.showSaveDialog(mainWindow,{title:'保存下载文件',defaultPath:path.join(app.getPath('downloads'),name),filters:[{name:`${format} 文件`,extensions:[format.toLowerCase()]}]});
    return result.canceled ? undefined : result.filePath;
  });
});
ipcMain.handle('window:fullscreen', event => {
  trusted(event); mainWindow.setFullScreen(!mainWindow.isFullScreen()); return mainWindow.isFullScreen();
});
ipcMain.handle('link:open', async (event, value) => {
  trusted(event);
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持普通网页链接');
  await shell.openExternal(url.href);
});
ipcMain.on('window:control', (event, action) => {
  trusted(event);
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  if (action === 'close') mainWindow.close();
});

app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { void downloadManager?.close().catch(()=>{});void torrentEngine?.close().catch(()=>{}); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
