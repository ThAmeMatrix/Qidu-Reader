import {cachedBook,withoutCache} from './lib/book-cache';
import {LocalCachePanel} from './components/LocalCachePanel';
import {isArchiveFormat} from './lib/downloads';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronRight, CloudOff, Download, LoaderCircle, Maximize2, Minus, Moon, Sun, Search, X } from 'lucide-react';
import type { Book, BookPayload, DownloadJob, DownloadTarget, LibraryState, Note, Page, RemoteBook, Review, SourceSnapshot } from './types';
import { defaultSources, migrateSourceState, parseDetail, remoteKey } from './lib/sources';
import { defaultDownloadProviders, downloadTarget, migrateDownloadState } from './lib/downloads';
import { DownloadFinder } from './components/DownloadFinder';
import { DownloadQueue, useDownloads } from './components/Downloads';
import { Discovery, OnlineDetail } from './components/Discovery';
import { initialState } from './lib/samples';
import { deletePayload, getState, localDateKey, restoreLibrary, savePayload, saveState } from './lib/storage';
import { importFile, importUrl } from './lib/importers';
import { createBackup, readBackup } from './lib/backup';
import { Sidebar } from './components/Sidebar';
import { Library } from './components/Library';
import { NotesPage, ReviewsPage, SettingsPage, StatsPage } from './components/Pages';
import { CollectionDialog, DetailDialog, HelpDialog, ImportDialog, ReviewDialog, type ImportResult } from './components/Dialogs';
import { downloadBlob, IconButton, Modal } from './components/ui';

const Reader = lazy(() => import('./components/Reader'));
type Dialog = { kind: 'import' | 'collection' | 'help' } | { kind: 'detail'; bookId: string } | { kind: 'review'; bookId?: string; review?: Review } | { kind: 'confirm'; title: string; body: string; action: () => void | Promise<void> } | null;

function Titlebar({theme,onToggle}:{theme:'light'|'dark';onToggle:()=>void}) {
  return <div className={`titlebar ${window.desktop ? 'native' : ''}`}><div><BookOpen size={12} /><span>栖读 · 给阅读一个安静的空间</span></div><div className="titlebar-actions"><button className="quick-theme" aria-label={theme==='dark'?'切换到日间':'切换到夜间'} onClick={onToggle}>{theme==='dark'?<Sun size={13}/>:<Moon size={13}/>}<span>{theme==='dark'?'日间':'夜间'}</span></button>{window.desktop && <div className="window-controls"><button aria-label="最小化" onClick={() => window.desktop?.minimize()}><Minus size={14} /></button><button aria-label="最大化或还原" onClick={() => window.desktop?.maximize()}><Maximize2 size={12} /></button><button aria-label="关闭窗口" className="window-close" onClick={() => window.desktop?.close()}><X size={15} /></button></div>}</div></div>;
}

export default function App() {
  const [state, setState] = useState<LibraryState | null>(null);
  const currentState = useRef(state); currentState.current = state;
  const [loadError, setLoadError] = useState(''); const [saveError, setSaveError] = useState('');
  const [page, setPage] = useState<Page>('library'); const [collectionId, setCollectionId] = useState<string>();
  const [search, setSearch] = useState(''); const searchRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reading, setReading] = useState<{ id: string; location?: string }>();
  const [onlineDetail, setOnlineDetail] = useState<RemoteBook>();
  const [downloads, setDownloads] = useState<DownloadTarget>();
  const [downloadPanel,setDownloadPanel]=useState(false);
  const [importingDownload,setImportingDownload]=useState<string>();
  const findDownloads = (book: Book | RemoteBook) => {const saved='url' in book?currentState.current?.books.find(b=>b.online&&remoteKey(b.online)===remoteKey(book)):book;setDownloads(downloadTarget(saved||book));};
  const [clearingCache,setClearingCache]=useState<string>();
  const processedLoads=useRef(new Set<string>());
  const [sourceSnapshot, setSourceSnapshot] = useState<SourceSnapshot>();
  const [toast, setToast] = useState(''); const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dragging, setDragging] = useState(false); const dragCount = useRef(0);
  const [backupBusy, setBackupBusy] = useState(false); const importBusy = useRef(false);
  const [pendingRestore, setPendingRestore] = useState<{ state: LibraryState; payloads: BookPayload[] }>();
  const notify = (message: string) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3800); };
  const baseDownloadActions=useDownloads(notify);
  const downloadActions={...baseDownloadActions,
    read:async(job:DownloadJob,password?:string)=>importDownload(job,password,true),
    remove:async(id:string)=>{const book=currentState.current?.books.find(b=>b.cache?.downloadId===id);if(book){await clearBookCache(book);}else await baseDownloadActions.remove(id);},
    openCloud:async(job:DownloadJob)=>{setDownloadPanel(false);setDownloads({title:job.bookTitle,author:job.bookAuthor,bookId:job.bookId,work:job.work,initialUrl:job.cloudUrl||job.url});},
  };
  async function importDownload(job:DownloadJob,password?:string,readNow=false) {
    if(importBusy.current){notify('上一批书籍仍在导入，请稍候');return;}
    importBusy.current=true;setImportingDownload(job.id);
    try{
      if(!window.desktop?.downloads)throw new Error('请使用桌面版下载');
      if(isArchiveFormat(job.format))job=await window.desktop.downloads.extract({id:job.id,password});
      const existing=currentState.current?.books.find(b=>b.id===job.bookId || b.cache?.downloadId===job.id || job.work&&b.online&&remoteKey(b.online)===remoteKey(job.work));
      if(existing?.cache?.downloadId===job.id){if(readNow)openBook(existing);else notify('这本书已在书架中，可直接阅读');return;}
      const file=await window.desktop.downloads.read(job.id);
      const {book}=await importFile(new File([new Uint8Array(file.data).buffer],file.name));
      const duplicate=!existing&&!job.work&&currentState.current?.books.find(b=>b.fingerprint===book.fingerprint);if(duplicate){await window.desktop.downloads.acknowledge(job.id);if(readNow)openBook(duplicate);else notify('这本书已在书架中');return;}
      const linked=cachedBook(book,job,existing?currentState.current?.books.find(b=>b.id===existing.id)||existing:undefined);
      await deletePayload(linked.id);
      update(s=>({...s,books:existing?s.books.map(b=>b.id===existing.id?linked:b):[linked,...s.books]}));
      await window.desktop.downloads.acknowledge(job.id);
      if(existing?.cache?.downloadId&&existing.cache.downloadId!==job.id)await window.desktop.downloads.remove(existing.cache.downloadId).catch(()=>{});
      notify(`《${linked.title}》已加载到本地并加入书架`);if(readNow)openBook(linked);
    }catch(e){notify((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}
    finally{importBusy.current=false;setImportingDownload(undefined);}
  }
  useEffect(()=>{
    if(!state||importBusy.current||clearingCache)return;
    const job=downloadActions.jobs.find(job=>job.autoLoad&&job.status==='completed'&&!processedLoads.current.has(job.id)&&!state.books.some(book=>book.cache?.downloadId===job.id));
    if(job){processedLoads.current.add(job.id);void importDownload(job);}
  },[downloadActions.jobs,importingDownload,state?.books,clearingCache]);
  async function clearBookCache(book:Book){
    if(!book.cache||clearingCache)return false;if(importBusy.current){notify('文件仍在加载，请稍后清理');return false;}setClearingCache(book.id);
    try{
      const api=window.desktop?.downloads;
      if(api){const jobs=(await api.list()).filter(job=>job.id===book.cache?.downloadId||job.bookId===book.id);
        for(const job of jobs){processedLoads.current.add(job.id);if(['queued','downloading'].includes(job.status))await api.cancel(job.id);}
        for(const job of jobs){for(let i=0;i<100;i++){const current=(await api.list()).find(j=>j.id===job.id);if(!current||!['queued','downloading'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,50));}await api.remove(job.id);}
      }
      await deletePayload(book.id);if(reading?.id===book.id)setReading(undefined);
      update(s=>({...s,books:s.books.map(current=>current.id===book.id?withoutCache(current):current)}));notify('本地缓存已删除，收藏、书评和阅读进度已保留');return true;
    }catch(e){notify('缓存未完全清理：'+(e as Error).message);return false;}finally{setClearingCache(undefined);}
  }
  useEffect(() => { void getState().then(saved => { const loaded=saved || structuredClone(initialState);setState(migrateDownloadState(migrateSourceState(loaded))); }).catch(() => setLoadError('无法打开本地阅读资料。请检查磁盘空间并重新启动应用。')); return () => clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    if (state) void saveState(state).then(() => setSaveError('')).catch(() => setSaveError('本地保存失败，请检查磁盘空间。当前修改尚未安全保存，请先导出备份。'));
  }, [state]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (dialog || onlineDetail || downloads || downloadPanel || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'k' && !reading) { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); setDialog({ kind: 'import' }); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [reading, dialog, onlineDetail, downloads, downloadPanel]);
  const update = (fn: (state: LibraryState) => LibraryState) => setState(previous => previous ? fn(previous) : previous);
  const updateBook = (id: string, patch: Partial<Book>) => update(s => ({ ...s, books: s.books.map(b => b.id === id ? { ...b, ...patch } : b) }));
  useEffect(() => window.desktop?.onSourceSnapshot(snapshot => {
    const source = (currentState.current?.sources || defaultSources).find(s => s.id === snapshot.sourceId);
    if (!source) { notify('该站点已移除，请先在站点管理中重新添加'); return; }
    setDownloads(undefined);setDownloadPanel(false);
    if (snapshot.mode === 'search') { setSourceSnapshot(snapshot); setReading(undefined); setDialog(null); setOnlineDetail(undefined); setPage('discover'); setCollectionId(undefined); }
    else { try { const book = parseDetail(source, snapshot); refreshOnline(book); setDialog(null); } catch(e) { notify((e as Error).message); } }
  }), []);
  function favoriteOnline(book: RemoteBook) {
    const existing = currentState.current?.books.find(b => b.online && remoteKey(b.online) === remoteKey(book));
    if (existing) { updateBook(existing.id, { favorite: !existing.favorite }); notify(existing.favorite ? '已取消收藏，书籍仍保留在书架中' : '已收藏这本书'); }
    else { update(s => ({ ...s, books: [{ id: crypto.randomUUID(), title: book.title, author: book.author, description: book.description, format: 'WEB', status: 'want', progress: 0, cover: book.title.length % 6, collectionIds: [], addedAt: Date.now(), size: 0, sourceUrl: book.url, online: book, favorite: true }, ...s.books] })); notify('已加入书架并收藏'); }
  }
  function refreshOnline(book: RemoteBook) {
    setOnlineDetail(book); update(s => ({ ...s, books: s.books.map(b => b.online && remoteKey(b.online) === remoteKey(book) ? { ...b, title: book.title, author: book.author, description: book.description, online: book } : b) }));
  }
  const navigate = (next: Page) => { setPage(next); setCollectionId(undefined); setSearch(''); };
  const openBook = (book: Book, location?: string) => {
    if(book.cacheSource&&!book.cache){setDownloads({...downloadTarget(book),initialUrl:book.cacheSource.cloudUrl||book.cacheSource.referrer||book.cacheSource.url});setDialog(null);return;}
    if (book.online&&!book.cache) { setOnlineDetail(book.online); setDialog(null); return; }
    updateBook(book.id, { lastRead: Date.now(), ...(book.status === 'want' ? { status: 'reading' as const } : {}) });
    setReading({ id: book.id, location }); setDialog(null);setOnlineDetail(undefined);setDownloads(undefined);setDownloadPanel(false);
  };
  async function addFiles(files: File[]): Promise<ImportResult> {
    if (importBusy.current) throw new Error('上一批书籍仍在导入，请稍候');
    if (files.length > 30) throw new Error('每次最多导入 30 个文件');
    importBusy.current = true;
    const result: ImportResult = { added: 0, skipped: 0, errors: [] }; const added: Book[] = [];
    const fingerprints = new Set(currentState.current?.books.map(b => b.fingerprint));
    try {
      for (const file of files) {
        try {
          const { book, payload } = await importFile(file);
          if (fingerprints.has(book.fingerprint)) { result.skipped++; continue; }
          await savePayload(payload); fingerprints.add(book.fingerprint); added.push(book); result.added++;
        } catch (error) { result.errors.push(`${file.name}：${(error as Error).message}`); }
      }
      if (added.length) { update(s => ({ ...s, books: [...added, ...s.books] })); navigate('library'); }
      return result;
    } finally { importBusy.current = false; }
  }
  async function addUrl(value: string) {
    const { book, payload } = await importUrl(value);
    if (currentState.current?.books.some(b => b.fingerprint === book.fingerprint)) throw new Error('这篇文章已经在书架里了');
    await savePayload(payload); update(s => ({ ...s, books: [book, ...s.books] })); navigate('library');
  }
  async function onDrop(event: React.DragEvent) {
    event.preventDefault(); setDragging(false); dragCount.current = 0;
    if (dialog || reading || onlineDetail || downloads || downloadPanel || !event.dataTransfer.files.length) return;
    notify('正在整理拖入的书籍…');
    try { const result = await addFiles([...event.dataTransfer.files]); notify(`已导入 ${result.added} 本${result.skipped ? `，跳过 ${result.skipped} 本重复书籍` : ''}${result.errors.length ? `；${result.errors[0]}` : ''}`); } catch (e) { notify((e as Error).message); }
  }
  function addNote(note: Note) {
    if (currentState.current?.notes.some(n => n.bookId === note.bookId && n.kind === note.kind && n.location === note.location && n.text === note.text)) { notify('这一页已经收藏过了'); return; }
    update(s => ({ ...s, notes: [...s.notes, note] })); notify(note.kind === 'highlight' ? '这段文字，已为你收藏' : '书签已放好，下次接着读');
  }
  function saveReview(review: Review) {
    update(s => ({ ...s, reviews: [...s.reviews.filter(r => r.bookId !== review.bookId), review] })); setDialog(null); notify('你的阅读感受，已好好保存');
  }
  async function exportBackup() {
    if (!state) return; setBackupBusy(true);
    try { const blob = await createBackup(state); downloadBlob(blob, `栖读书架-${localDateKey()}.qidu`); notify('完整备份已生成'); } catch (error) { notify(`备份失败：${(error as Error).message}`); } finally { setBackupBusy(false); }
  }
  async function prepareRestore(file: File) {
    setBackupBusy(true);
    try { const backup=await readBackup(file);backup.state=migrateDownloadState(migrateSourceState(backup.state));setPendingRestore(backup); } catch (e) { notify(`无法恢复：${(e as Error).message}`); } finally { setBackupBusy(false); }
  }
  if (!state) return <div className="boot-screen"><BookOpen size={42} strokeWidth={1.2} /><h1>栖读</h1><p>{loadError || '为你留一页安静。'}</p>{loadError && <button className="button secondary" onClick={() => location.reload()}>重新打开</button>}</div>;
  const collection = state.collections.find(c => c.id === collectionId);
  const activeBook = state.books.find(b => b.id === reading?.id);
  const detailBook = dialog?.kind === 'detail' ? state.books.find(b => b.id === dialog.bookId) : undefined;
  const names = { library: '我的书架', discover: '发现好书', reviews: '书评手记', notes: '摘录与书签', stats: '阅读足迹', settings: '偏好设置' };
  return <div className={`app theme-${state.settings.appTheme} ${state.settings.reduceMotion ? 'reduce-motion' : ''}`} onDragEnter={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files') && !reading && !dialog && !onlineDetail && !downloads && !downloadPanel && !downloadPanel) { dragCount.current++; setDragging(true); } }} onDragLeave={() => { dragCount.current--; if (dragCount.current <= 0) setDragging(false); }} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
    <Titlebar theme={state.settings.appTheme} onToggle={()=>update(s=>{const dark=s.settings.appTheme!=='dark';return {...s,settings:{...s.settings,appTheme:dark?'dark':'light',reader:{...s.settings.reader,theme:dark?'dark':'paper'}}};})}/>
    {activeBook ? <Suspense fallback={<div className="boot-screen"><LoaderCircle className="spin" size={30} /><p>正在准备你的阅读空间…</p></div>}><Reader key={activeBook.id} book={activeBook} initialLocation={reading?.location} settings={state.settings.reader} notes={state.notes.filter(n => n.bookId === activeBook.id)} onClose={() => setReading(undefined)} onProgress={(location, progress) => updateBook(activeBook.id, { location, progress, ...(progress >= 99.95 ? { status: 'finished' } : {}) })} onSettings={reader => update(s => ({ ...s, settings: { ...s.settings, reader } }))} onNote={addNote} onDeleteNote={id => { update(s => ({ ...s, notes: s.notes.filter(n => n.id !== id) })); notify('已取消收藏'); }} onTick={seconds => update(s => { const day = localDateKey(); return { ...s, readingSeconds: { ...s.readingSeconds, [day]: (s.readingSeconds[day] || 0) + seconds } }; })} onReview={() => setDialog({ kind: 'review', bookId: activeBook.id, review: state.reviews.find(r => r.bookId === activeBook.id) })} /></Suspense> : <div className="app-layout">
      <Sidebar page={page} collectionId={collectionId} collections={state.collections} bookCount={state.books.length} noteCount={state.notes.length} onPage={navigate} onCollection={id => { setPage('library'); setCollectionId(id); setSearch(''); }} onNewCollection={() => setDialog({ kind: 'collection' })} onHelp={() => setDialog({ kind: 'help' })} />
      <div className="workspace"><header className="topbar"><div className="breadcrumbs"><span>个人空间</span><ChevronRight size={12} /><strong>{collection?.name || names[page]}</strong></div><div className="global-search"><Search size={16} /><input ref={searchRef} aria-label="搜索书名或作者" placeholder="搜索书名、作者…" value={search} onChange={e => { setSearch(e.target.value); if (page !== 'library') { setPage('library'); setCollectionId(undefined); } }} />{search ? <button aria-label="清除搜索" onClick={() => setSearch('')}><X size={14} /></button> : <kbd>Ctrl K</kbd>}</div><button className="topbar-downloads" aria-label={`下载任务 ${downloadActions.jobs.length}`} onClick={()=>setDownloadPanel(true)}><Download size={17}/><span>下载</span>{downloadActions.jobs.length>0 && <small>{downloadActions.jobs.filter(j=>j.status==='downloading'||j.status==='queued').length || downloadActions.jobs.length}</small>}</button><div className="offline-status"><span />本地书库</div></header>
        <main className="main-content">
          {page === 'library' && <Library books={state.books} reviews={state.reviews} collection={collection} search={search} onClearSearch={() => setSearch('')} onOpen={openBook} onFavorite={book => { updateBook(book.id, { favorite: !book.favorite }); notify(book.favorite ? '已取消收藏' : '已收藏这本书'); }} onDetails={book => setDialog({ kind: 'detail', bookId: book.id })} onImport={() => setDialog({ kind: 'import' })} />}
          <div hidden={page !== 'discover'}><Discovery sources={state.sources || defaultSources} books={state.books} history={state.searchHistory || []} snapshot={sourceSnapshot} onSources={sources => update(s => ({...s,sources}))} onHistory={query => update(s => ({...s, searchHistory: [query,...(s.searchHistory || []).filter(q => q !== query)].slice(0,10)}))} onFavorite={favoriteOnline} onDetail={setOnlineDetail} onDownloads={findDownloads} notify={notify} /></div>
          {page === 'reviews' && <ReviewsPage books={state.books} reviews={state.reviews} onEdit={review => setDialog({ kind: 'review', review })} onOpen={openBook} onDelete={review => setDialog({ kind: 'confirm', title: '收起这篇手记？', body: '删除后将无法恢复，书籍和阅读进度会保留。', action: () => { update(s => ({ ...s, reviews: s.reviews.filter(r => r.id !== review.id) })); notify('书评已删除'); } })} />}
          {page === 'notes' && <NotesPage books={state.books} notes={state.notes} onOpen={openBook} onDelete={note => setDialog({ kind: 'confirm', title: '删除这条收藏？', body: '删除后将无法恢复，原书内容不会受到影响。', action: () => { update(s => ({ ...s, notes: s.notes.filter(n => n.id !== note.id) })); notify('收藏已删除'); } })} />}
          {page === 'stats' && <StatsPage state={state} />}
          {page === 'settings' && <SettingsPage settings={state.settings} onChange={settings => update(s => ({ ...s, settings }))} onExport={exportBackup} onRestore={prepareRestore} busy={backupBusy}><LocalCachePanel books={state.books} busy={clearingCache} onClear={clearBookCache}/></SettingsPage>}
        </main>
      </div>
    </div>}
    {onlineDetail && !downloads && !downloadPanel && <OnlineDetail key={onlineDetail.url} book={onlineDetail} sources={state.sources || defaultSources} saved={state.books.find(b => b.online && remoteKey(b.online) === remoteKey(onlineDetail))} onClose={() => setOnlineDetail(undefined)} onDownloads={() => findDownloads(onlineDetail)} onRead={()=>{const saved=state.books.find(b=>b.online&&remoteKey(b.online)===remoteKey(onlineDetail));if(saved)openBook(saved);}} onClearCache={()=>{const saved=state.books.find(b=>b.online&&remoteKey(b.online)===remoteKey(onlineDetail));if(saved)void clearBookCache(saved);}} onFavorite={() => favoriteOnline(onlineDetail)} onRefresh={refreshOnline} onReview={() => { const book = state.books.find(b => b.online && remoteKey(b.online) === remoteKey(onlineDetail)); if (book) { setOnlineDetail(undefined); setDialog({kind:'review',bookId:book.id,review:state.reviews.find(r=>r.bookId===book.id)}); } }} notify={notify}/>}
    {dialog?.kind === 'import' && <ImportDialog onClose={() => setDialog(null)} onFiles={addFiles} onUrl={addUrl} />}
    {dialog?.kind === 'collection' && <CollectionDialog collections={state.collections} onClose={() => setDialog(null)} onSave={collection => { update(s => ({ ...s, collections: [...s.collections, collection] })); setDialog(null); notify(`「${collection.name}」书单已创建`); }} />}
    {dialog?.kind === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
    {detailBook && !downloads && !downloadPanel && <DetailDialog onClearCache={()=>void clearBookCache(detailBook)} clearingCache={clearingCache===detailBook.id} book={detailBook} collections={state.collections} review={state.reviews.find(r => r.bookId === detailBook.id)} onClose={() => setDialog(null)} onDownloads={() => findDownloads(detailBook)} onOpen={() => openBook(detailBook)} onUpdate={patch => updateBook(detailBook.id, patch)} onReview={() => setDialog({ kind: 'review', bookId: detailBook.id, review: state.reviews.find(r => r.bookId === detailBook.id) })} onDelete={async() => { if(detailBook.cache&&!await clearBookCache(detailBook))return;update(s => ({ ...s, books: s.books.filter(b => b.id !== detailBook.id), reviews: s.reviews.filter(r => r.bookId !== detailBook.id), notes: s.notes.filter(n => n.bookId !== detailBook.id) })); void deletePayload(detailBook.id).catch(() => notify('书架已更新，残留文件将在恢复备份时清理')); setDialog(null); notify('书籍已移出书架'); }} />}
    {downloads && <DownloadFinder key={(downloads.bookId||downloads.work?.url||downloads.title)+':'+(downloads.initialUrl||'')} actions={downloadActions} onImport={importDownload} importing={importingDownload} target={downloads} providers={state.downloadProviders || defaultDownloadProviders} onProviders={downloadProviders => update(s => ({...s,downloadProviders}))} onClose={() => setDownloads(undefined)} notify={notify}/>}
    {downloadPanel && <Modal title="下载任务" subtitle="在这里管理下载，将电子书带回书架。" onClose={()=>setDownloadPanel(false)} wide><DownloadQueue actions={downloadActions} onImport={importDownload} importing={importingDownload}/></Modal>}
    {dialog?.kind === 'review' && <ReviewDialog books={state.books} initialBookId={dialog.bookId} review={dialog.review} onSave={saveReview} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'confirm' && <Modal title={dialog.title} onClose={() => setDialog(null)}><p className="confirm-body">{dialog.body}</p><div className="modal-actions"><button className="button secondary" onClick={() => setDialog(null)}>保留</button><button className="button danger-button" onClick={() => { void dialog.action(); setDialog(null); }}>确认删除</button></div></Modal>}
    {pendingRestore && <Modal title="恢复这一份阅读时光？" subtitle={`备份包含 ${pendingRestore.state.books.length} 本书、${pendingRestore.state.reviews.length} 篇书评和 ${pendingRestore.state.notes.length} 条收藏。`} onClose={() => !backupBusy && setPendingRestore(undefined)}><p className="confirm-body">恢复将替换当前书架及其阅读资料。如果当前内容尚未备份，请先取消并导出备份。</p><div className="modal-actions"><button className="button secondary" disabled={backupBusy} onClick={() => setPendingRestore(undefined)}>取消</button><button className="button primary" disabled={backupBusy} onClick={async () => { setBackupBusy(true); try { await restoreLibrary(pendingRestore.state, pendingRestore.payloads); setState(pendingRestore.state); setPendingRestore(undefined); navigate('library'); notify('书架与阅读记录已完整恢复'); } catch (e) { notify((e as Error).message); } finally { setBackupBusy(false); } }}>{backupBusy ? '正在恢复…' : '确认恢复并替换'}</button></div></Modal>}
    {dragging && <div className="global-drop-overlay"><BookOpen size={50} strokeWidth={1.2} /><h2>松开，把好书放进来</h2><p>TXT · EPUB · PDF · HTML · Markdown</p></div>}
    {saveError && <div className="save-error" role="alert"><CloudOff size={18} />{saveError}<button onClick={exportBackup}>导出备份</button></div>}
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}
