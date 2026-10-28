import {EncyclopediaPanel} from './EncyclopediaPanel';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, Compass, ExternalLink, FileDown, Heart, LoaderCircle, Plus, Search, Settings2, X } from 'lucide-react';
import type { Book, BookSource, RemoteBook, SourceSnapshot } from '../types';
import { defaultSources, fetchSource, openSource, parseDetail, parseSearch, publicIndexUrl, remoteKey, searchRequest, searchSource, type SearchPage } from '../lib/sources';
import { EmptyState, IconButton, Modal } from './ui';
import { DownloadEntry } from './DownloadFinder';
import { SourceManager } from './SourceManager';
import '../discovery.css';

export function RemoteCover({ book }: { book: RemoteBook }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [book.coverUrl]);
  return <div className={`remote-cover tone-${book.title.length % 4}`}>{book.coverUrl && !failed ? <img src={book.coverUrl} alt={`${book.title}封面`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <><BookOpen size={24} strokeWidth={1.2} /><span>{book.title}</span><small>{book.sourceName}</small></>}</div>;
}

interface Props {
  sources: BookSource[]; books: Book[]; history: string[]; snapshot?: SourceSnapshot;
  onSources: (sources: BookSource[]) => void; onHistory: (query: string) => void;
  onFavorite: (book: RemoteBook) => void; onDetail: (book: RemoteBook) => void; onDownloads: (book: RemoteBook) => void; notify: (message: string) => void;
}
type Result = SearchPage & { status: 'loading' | 'done' | 'error'; page: number };

export function Discovery(props: Props) {
  const [query,setQuery] = useState(''); const [submitted,setSubmitted] = useState(''); const [results,setResults] = useState<Record<string,Result>>({});
  const [filter,setFilter] = useState('all'); const [manager,setManager] = useState(false); const [busy,setBusy] = useState(false);
  const runId = useRef(0); const abort = useRef<AbortController | undefined>(undefined); const snapshotSeen = useRef<SourceSnapshot | undefined>(undefined);
  const enabled = props.sources.filter(s => s.enabled);
  useEffect(() => () => { runId.current++; abort.current?.abort(); }, []);
  useEffect(() => { if (filter !== 'all' && !props.sources.some(s => s.id === filter && s.enabled)) setFilter('all'); }, [props.sources, filter]);
  useEffect(() => window.desktop?.onSourceRetry(sourceId => {
    const source = props.sources.find(s=>s.id===sourceId);
    if (!source || !submitted) { props.notify('登录状态已保留，输入书名后即可搜索'); return; }
    void load(source,submitted,1,runId.current);
  }), [props.sources,submitted]);
  useEffect(() => {
    const snapshot = props.snapshot; if (!snapshot || snapshot.mode !== 'search' || snapshotSeen.current === snapshot) return;
    snapshotSeen.current = snapshot; const source = props.sources.find(s => s.id === snapshot.sourceId); if (!source) return;
    try {
      runId.current++; abort.current?.abort(); setBusy(false);
      const parsed = parseSearch(source,snapshot); setFilter(source.id);
      const params = new URL(snapshot.url).searchParams;
      const pathParts = new URL(snapshot.url).pathname.split('/');
      let pathQuery;try { if (source.adapter === 'ciweimao' && pathParts[1] === 'get-search-book-list') pathQuery=decodeURIComponent(pathParts[4]); } catch { /* Keep the current search text for malformed site URLs. */ }
      const capturedQuery = ['query','q','keyword','kw','searchkey','searchWord','query_word'].map(key => params.get(key)).find(Boolean) || pathQuery;
      setSubmitted(capturedQuery || query.trim() || '站点窗口中的结果');
      if (capturedQuery) setQuery(capturedQuery.slice(0,100));
      const capturedPage = Math.max(1,Number(params.get('page') || params.get('pageNo') || 1));
      setResults({ [source.id]: { ...parsed, rendered:true,status:'done',page:capturedPage,hasNext:!!parsed.nextUrl } });
      props.notify(parsed.books.length ? `已从${source.name}读取 ${parsed.books.length} 本书` : parsed.message || '当前页没有找到书目');
    } catch(e) { props.notify((e as Error).message); }
  }, [props.snapshot]);
  async function load(source: BookSource, value: string, page: number, id: number, previous?: Result) {
    if (id === runId.current && abort.current?.signal.aborted) abort.current = new AbortController();
    setResults(all => ({ ...all, [source.id]: { books: previous?.books || [], hasNext:false, status:'loading',page } }));
    try {
      const parsed = await searchSource(source,value,page,abort.current?.signal,previous);
      if (id !== runId.current) return;
      const existing = previous?.books || []; const keys = new Set(existing.map(remoteKey));
      const additions = parsed.books.filter(b => !keys.has(remoteKey(b)));
      setResults(all => ({ ...all, [source.id]: { ...parsed, books:[...existing,...additions],hasNext:parsed.hasNext && (!previous || additions.length > 0),status:'done',page } }));
    } catch (error) {
      if (id !== runId.current) return;
      setResults(all => ({ ...all, [source.id]: { books:previous?.books || [],hasNext:false, status:'error',page:previous?.page || 1,message:(error as Error).message,needsBrowser:true } }));
    }
  }
  async function search(value = query) {
    value = value.trim(); if (!value) return;
    const selected = filter === 'all' ? enabled : enabled.filter(s=>s.id===filter);
    if (!selected.length) { setManager(true); return; }
    abort.current?.abort(); abort.current = new AbortController(); const id = ++runId.current;
    setQuery(value); setSubmitted(value); setResults({}); setBusy(true); props.onHistory(value);
    const pending = [...selected];
    await Promise.all(Array.from({length:Math.min(3,pending.length)}, async () => { while (pending.length && id === runId.current) { const source = pending.shift()!; await load(source,value,1,id); } }));
    if (id === runId.current) setBusy(false);
  }
  const selectedSources = props.sources.filter(s => results[s.id] && (filter === 'all' || s.id === filter));
  const total = selectedSources.reduce((sum,s) => sum + results[s.id].books.length,0);
  const browse = async (source:BookSource) => { try { const value=submitted || query.trim();await openSource(source,value ? searchRequest(source,value,1,true) : {url:source.homepage},'search'); } catch(e) { props.notify((e as Error).message); } };
  const browseIndex = async (source:BookSource) => { try { await openSource(source,{url:publicIndexUrl(source,submitted || query)},'search');props.notify('正在查找搜索引擎收录的公开书页，结果可能不完整。打开书页后可点击「读取书籍详情」'); } catch(e) { props.notify((e as Error).message); } };
  return <div className="discovery-page page-enter">
    <div className="page-heading"><div><div className="eyebrow">A WORLD OF STORIES</div><h1>发现好书<span className="heading-dot">.</span></h1><p>从不同的书海，找到下一本想读的书。</p></div><button className="button secondary" onClick={()=>setManager(true)}><Settings2 size={16} />管理搜索站点<span className="source-count">{enabled.length}</span></button></div>
    <section className="discovery-hero"><div className="discovery-ornament"><Compass size={110} strokeWidth={.6} /></div><span className="section-kicker">书名、作者，都可以是出发的地方</span><form className="discovery-search" onSubmit={e=>{e.preventDefault();void search();}}><Search size={22}/><input aria-label="在线搜索书名或作者" placeholder="寻找一本书，或一位喜欢的作者…" value={query} onChange={e=>setQuery(e.target.value)} maxLength={100}/>{query && <IconButton label="清空找书关键词" onClick={()=>setQuery('')}><X size={15}/></IconButton>}<button className="button primary" disabled={!query.trim()}><Search size={16}/>搜索书籍</button></form><div className="search-history"><span>最近找过</span>{props.history.length ? props.history.slice(0,5).map(q=><button key={q} onClick={()=>void search(q)}>{q}</button>) : <span className="muted">你的下一段阅读，从这里开始</span>}</div></section>
    <div className="source-filter" aria-label="搜索来源"><button aria-pressed={filter==='all'} className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>全部站点</button>{props.sources.filter(s=>s.enabled || results[s.id]).map(source=><button key={source.id} aria-pressed={filter===source.id} className={filter===source.id?'selected':''} onClick={()=>setFilter(source.id)}>{source.name}{results[source.id]?.status === 'loading' ? <LoaderCircle size={12} className="spin"/> : results[source.id] ? <small>{results[source.id].books.length}</small> : null}</button>)}</div>
    {submitted ? <><div className="discovery-results-heading"><h2>「{submitted}」<span>已找到 {total} 本</span></h2>{busy && <button className="button text-button" onClick={() => { runId.current++; abort.current?.abort(); setBusy(false); setResults(all => Object.fromEntries(Object.entries(all).map(([key,r]) => [key, r.status === 'loading' ? {...r,status:'error',message:'已停止，可重试该站点',needsBrowser:false} : r]))); }}><X size={14}/>停止搜索</button>}</div>
      {selectedSources.length === 0 && <p className="source-message">此站点尚未搜索，点击「搜索书籍」获取结果。</p>}
      {selectedSources.map(source=>{const result=results[source.id];return <section className="source-results" key={source.id}><div className="source-result-heading"><div><span className={`source-dot ${result.status}`}/><h3>{source.name}</h3><span>{result.status==='loading'?'正在查找…':`${result.books.length} 本书`}</span></div><div><button onClick={()=>void load(source,submitted,1,runId.current)} disabled={busy || result.status==='loading'}>重新查找</button><button onClick={()=>void browse(source)}>站点窗口<ExternalLink size={12}/></button></div></div>
        {!!result.books.length && <div className="discovery-grid">{result.books.map(book=>{const saved=props.books.find(b=>b.online && remoteKey(b.online)===remoteKey(book));return <article className="discovery-card" key={remoteKey(book)}><button className="remote-cover-button" aria-label={`查看 ${book.title}`} onClick={()=>props.onDetail(book)}><RemoteCover book={book}/></button><div className="discovery-book-info"><button className="discovery-title" onClick={()=>props.onDetail(book)}>{book.title}</button><p className="remote-author">{book.author}</p><p className="remote-description">{book.description || book.tags?.join(' · ') || '打开书籍详情，了解这本书。'}</p><div className="remote-card-bottom"><span>{book.tags?.find(t=>t.length<15) || source.name}</span><button className="download-card-button" aria-label={`查找下载 ${book.title}`} onClick={()=>props.onDownloads(book)}><FileDown size={14}/>下载方案</button><button className={saved?.favorite?'favorite active':'favorite'} aria-label={`${saved?.favorite?'取消收藏':'收藏'} ${book.title}`} aria-pressed={!!saved?.favorite} onClick={()=>props.onFavorite(book)}><Heart size={15} fill={saved?.favorite?'currentColor':'none'}/>{saved?.favorite?'已收藏':saved?'收藏':'加入书架'}</button></div></div></article>;})}</div>}
        {result.message && <div className={`source-message ${result.needsBrowser?'attention':''}`}><span>{result.message}{source.adapter==='youshu' && result.needsBrowser && <small className="public-index-hint">也可查找搜索引擎收录的公开书页，收录可能不完整。</small>}</span><div className="source-message-actions">{source.adapter==='youshu' && result.needsBrowser && <button onClick={()=>void browseIndex(source)}>搜索公开网页<ExternalLink size={14}/></button>}{result.needsBrowser && <button onClick={()=>void browse(source)}>{result.issue==='login'?'登录站点':result.issue==='verification'?'前往验证':'打开站点'}<ArrowRight size={14}/></button>}</div></div>}
        {result.status==='loading' && <div className="source-loading"><LoaderCircle size={18} className="spin"/><span>正在从{source.name}寻找…</span></div>}
        {result.hasNext && result.status!=='loading' && <button className="load-more" onClick={()=>void load(source,submitted,result.page+1,runId.current,result)}>加载更多<ArrowRight size={14}/></button>}
      </section>;})}</> : <><div className="discovery-section-title"><h2>你的找书地图</h2><span>可随时添加自己喜欢的网站</span></div><div className="source-directory">{props.sources.map((source,i)=><button key={source.id} className={!source.enabled?'disabled-source':''} onClick={()=>void browse(source)}><span className={`source-monogram tone-${i%4}`}>{source.name.slice(0,1)}</span><div><strong>{source.name}{!source.enabled && <small>已停用搜索</small>}</strong><p>{source.description || new URL(source.homepage).hostname}</p></div><ExternalLink size={15}/></button>)}<button className="add-source-card" onClick={()=>setManager(true)}><Plus size={25}/><div><strong>添加搜索网站</strong><p>支持搜索链接、表单和自定义解析规则</p></div></button></div><p className="discovery-footnote">搜索结果来自各站点。需要登录或验证时，在站点窗口完成后点击「登录完成，重试」；之后搜索会自动使用已保存的登录状态。收藏会保存在本机书架。</p></>}
    {!enabled.length && <EmptyState title="先选一处书海" description="在站点管理中启用或添加一个搜索网站。" action={<button className="button secondary" onClick={()=>setManager(true)}>管理站点</button>}/>}
    {manager && <SourceManager sources={props.sources} onChange={props.onSources} onClose={()=>setManager(false)} notify={props.notify}/>}
  </div>;
}

export function OnlineDetail({ book, sources, saved, onClose, onFavorite, onReview, onRefresh, onDownloads, onRead, onClearCache, notify }: { book: RemoteBook; sources:BookSource[];saved?:Book;onClose:()=>void;onFavorite:()=>void;onReview:()=>void;onRefresh:(book:RemoteBook)=>void;onDownloads:()=>void;onRead:()=>void;onClearCache:()=>void;notify:(message:string)=>void }) {
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const source = sources.find(s=>s.id===book.sourceId) || {...defaultSources[0],id:book.sourceId,name:book.sourceName,adapter:'generic' as const,homepage:new URL(book.url).origin};
  const original = async () => { try { await openSource(source,{url:book.url},'detail'); } catch(e){setError((e as Error).message);} };
  const refresh = async () => { setBusy(true);setError('');try { onRefresh(parseDetail(source,await fetchSource({url:book.url,charset:source.charset}),book));notify('书籍资料已更新'); } catch(e){setError((e as Error).message);}finally{setBusy(false);} };
  return <Modal title="从书海带回的故事" subtitle={`来源：${book.sourceName} · 在线书目`} onClose={onClose} wide><div className="online-detail-top"><RemoteCover book={book}/><div><span className="online-source-tag">{book.sourceName}</span><h2>{book.title}</h2><p>{book.author}</p><button className="button secondary small" onClick={()=>void refresh()} disabled={busy}>{busy?<LoaderCircle size={14} className="spin"/>:<BookOpen size={14}/>}更新书籍资料</button></div></div>{book.description && <p className="online-description">{book.description}</p>}{!!book.tags?.length && <div className="online-tags">{book.tags.map((tag,i)=><span key={i}>{tag}</span>)}</div>}<p className="subtle-callout">加载到本地后，收藏作品可直接阅读本地文件。也可前往原站查看目录。</p><EncyclopediaPanel title={book.title} author={book.author}/><DownloadEntry onClick={onDownloads}/>{saved?.cache&&<div className="cache-book-status"><span>本地文件已就绪 · {saved.format}</span><button className="button secondary small" onClick={onRead}>阅读本地文件</button><button className="button text-button small" onClick={onClearCache}>清空缓存</button></div>}{error && <div className="error-message" role="alert">{error}</div>}<div className="modal-actions"><button className={`button secondary ${saved?.favorite?'favorited':''}`} onClick={onFavorite}><Heart size={16} fill={saved?.favorite?'currentColor':'none'}/>{saved?.favorite?'取消收藏':saved?'收藏这本书':'加入书架并收藏'}</button>{saved && <button className="button secondary" onClick={onReview}><Check size={16}/>写书评</button>}<button className="button primary" onClick={()=>void original()}>前往原站<ExternalLink size={16}/></button></div></Modal>;
}
