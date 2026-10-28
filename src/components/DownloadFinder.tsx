import {followDownloadPages} from '../lib/download-chain';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, FileDown, Link, LoaderCircle, Pencil, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import type { DownloadJob, DownloadProvider, DownloadTarget } from '../types';
import { defaultDownloadProviders, downloadFormats, matchesDownloadFormat, readDownloadPage, resolveDownloadFiles, searchDownloadCatalog, validateDownloadProvider, type DownloadCandidate, type DownloadFiles, type DownloadFormat, type DownloadPage, type DownloadQuery } from '../lib/downloads';
import { IconButton, Modal } from './ui';
import { DownloadQueue, type DownloadActions } from './Downloads';
import {ResourceLinks} from './DownloadResources';
import {readTransferInput,resourceFromUrl} from '../lib/download-resources';
import '../downloads.css';

export function DownloadEntry({ onClick }: { onClick: () => void }) {
  return <button className="download-entry" onClick={onClick}><FileDown size={21}/><span><strong>查找下载方案</strong><small>站内汇总书籍与压缩包，直接下载</small></span><ArrowRight size={18}/></button>;
}
type CatalogResult = DownloadPage & { status:'loading'|'done'|'error'; pagesLoaded:number };
type FileResult = DownloadFiles & { status:'loading'|'done'|'error'; trail:DownloadFiles[] };
interface Props { target:DownloadTarget; providers:DownloadProvider[]; onProviders:(providers:DownloadProvider[])=>void; onClose:()=>void; notify:(message:string)=>void; actions:DownloadActions; onImport:(job:DownloadJob)=>Promise<void>; importing?:string }
const pageProvider:DownloadProvider={id:'download-page',name:'指定页面',homepage:'https://example.org/',searchUrl:'https://example.org/?q={query}',enabled:true,kind:'site',adapter:'link'};
const errorMessage=(e:unknown)=>(e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');

export function DownloadFinder({target,providers,onProviders,onClose,notify,actions:baseActions,onImport,importing}:Props) {
  const [bindingId]=useState(()=>target.bookId||(target.work?crypto.randomUUID():undefined));
  const actions={...baseActions,start:(request:Parameters<typeof baseActions.start>[0])=>{const loaded=baseActions.jobs.find(job=>job.status==='completed'&&job.bookId===bindingId&&job.url===request.url&&job.fileIndex===request.fileIndex&&(job.format===request.format||job.archive?.format===request.format));return loaded?baseActions.read(loaded):baseActions.start({...request,bookId:bindingId,work:target.work,autoLoad:true});}};
  const [title,setTitle]=useState(target.title.slice(0,200)),[author,setAuthor]=useState(target.author.slice(0,200));
  const [includeAuthor,setIncludeAuthor]=useState(false),[format,setFormat]=useState<DownloadFormat>('all');
  const [submitted,setSubmitted]=useState<DownloadQuery>({title:target.title.slice(0,200),author:target.author.slice(0,200),includeAuthor:false,format:'all'});
  const submittedRef=useRef(submitted);submittedRef.current=submitted;
  const [results,setResults]=useState<Record<string,CatalogResult>>({}),[files,setFiles]=useState<Record<string,FileResult>>({});
  const [managing,setManaging]=useState(false),[filter,setFilter]=useState('all');
  const [pageUrl,setPageUrl]=useState(''),[manual,setManual]=useState<DownloadCandidate>();
  const runId=useRef(0),abort=useRef<AbortController|undefined>(undefined),inspections=useRef(new Map<string,number>());
  const enabled=providers.filter(p=>p.enabled),shown=enabled.filter(p=>filter==='all'||p.id===filter);
  const busy=Object.values(results).some(r=>r.status==='loading');
  const total=shown.reduce((sum,p)=>sum+(results[p.id]?.books.length||0),0);
  const changed=title.trim()!==submitted.title || author.trim()!==submitted.author || includeAuthor!==submitted.includeAuthor;
  useEffect(()=>{if(!managing)search(submittedRef.current);return()=>{runId.current++;abort.current?.abort();};},[providers,managing]);
  useEffect(()=>{if(filter!=='all' && !enabled.some(p=>p.id===filter))setFilter('all');},[providers,filter]);

  async function load(provider:DownloadProvider,query:DownloadQuery,id:number,previous?:CatalogResult) {
    setResults(all=>({...all,[provider.id]:{books:previous?.books||[],status:'loading',pagesLoaded:previous?.pagesLoaded||0}}));
    try{
      const result=await searchDownloadCatalog(provider,query,abort.current?.signal,previous?.nextUrl);if(id!==runId.current)return;
      const old=previous?.books||[],seen=new Set(old.map(b=>b.url)),added=result.books.filter(b=>!seen.has(b.url));
      const pagesLoaded=(previous?.pagesLoaded||0)+1;
      setResults(all=>({...all,[provider.id]:{...result,books:[...old,...added],status:'done',pagesLoaded,nextUrl:added.length && pagesLoaded<20?result.nextUrl:undefined}}));
    }catch(e){if(id===runId.current)setResults(all=>({...all,[provider.id]:{books:previous?.books||[],nextUrl:previous?.nextUrl,pagesLoaded:previous?.pagesLoaded||0,status:'error',message:errorMessage(e)}}));}
  }
  function search(query:DownloadQuery) {
    if(!query.title.trim())return;abort.current?.abort();abort.current=new AbortController();const id=++runId.current;
    setSubmitted(query);setFormat(query.format);setFiles({});setManual(undefined);inspections.current.clear();
    const pending=providers.filter(p=>p.enabled);
    setResults(Object.fromEntries(pending.map(p=>[p.id,{books:[],status:'loading',pagesLoaded:0}])));
    void Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{while(pending.length && id===runId.current)await load(pending.shift()!,query,id);}));
  }
  function stop(){
    runId.current++;abort.current?.abort();
    setResults(all=>Object.fromEntries(Object.entries(all).map(([key,r])=>[key,r.status==='loading'?{...r,status:'error',message:'已停止查找，可重试此来源'}:r])));
    setFiles(all=>Object.fromEntries(Object.entries(all).map(([key,r])=>[key,r.status==='loading'?{...r,status:'error',message:'已停止，可重新读取页面'}:r])));
  }
  function retry(provider:DownloadProvider,previous?:CatalogResult){if(abort.current?.signal.aborted)abort.current=new AbortController();void load(provider,submitted,runId.current,previous);}
  async function inspect(provider:DownloadProvider,book:DownloadCandidate,url?:string) {
    if(abort.current?.signal.aborted)abort.current=new AbortController();
    const key=`${provider.id}:${book.id}`,old=files[key],id=runId.current,sequence=(inspections.current.get(key)||0)+1;inspections.current.set(key,sequence);
    const snapshot=old && {resources:old.resources,files:old.files,message:old.message,rights:old.rights,pages:old.pages,pageUrl:old.pageUrl,title:old.title,description:old.description};
    const trail=url && old?.status==='done'?[...old.trail,snapshot!].slice(-10):[];
    setFiles(all=>({...all,[key]:{files:[],status:'loading',trail}}));
    try{
      const resource=(!url && (old?.resources?.find(item=>item.url===book.url) || old?.pageUrl===book.url && old.resources?.length===1 && old.resources[0])) || resourceFromUrl(url||book.url);
      let result:DownloadFiles=resource?{files:[],resources:[resource],pageUrl:resource.url}:url?await readDownloadPage(url,abort.current?.signal):await resolveDownloadFiles(provider,book,abort.current?.signal);
      result=await followDownloadPages(result,abort.current?.signal,value=>{if(id===runId.current&&inspections.current.get(key)===sequence)setFiles(all=>({...all,[key]:{...all[key],message:'正在继续解析 '+new URL(value).hostname}}));});
      if(id===runId.current && inspections.current.get(key)===sequence)setFiles(all=>({...all,[key]:{...result,pageUrl:result.pageUrl || book.url,status:'done',trail}}));
    }catch(e){if(id===runId.current && inspections.current.get(key)===sequence)setFiles(all=>({...all,[key]:{files:[],status:'error',message:errorMessage(e),trail}}));}
  }
  function readManual(value:string){
    const input=readTransferInput(value);if(!input){notify('请粘贴网页、网盘分享、磁链或 .torrent 地址');return;}
    const book:DownloadCandidate={id:input.url,providerId:pageProvider.id,title:submitted.title,author:submitted.author,summary:'解析分享资源和下载文件',url:input.url};
    setManual(book);if(input.resource)setFiles(all=>({...all,[`${pageProvider.id}:${book.id}`]:{files:[],resources:[input.resource!],pageUrl:input.url,status:'done',trail:[]}}));else void inspect(pageProvider,book);
  }
  useEffect(()=>{if(target.initialUrl)readManual(target.initialUrl);},[]);
  function renderBook(provider:DownloadProvider,book:DownloadCandidate){
    const key=`${provider.id}:${book.id}`,detail=files[key],matches=detail?.files.filter(f=>matchesDownloadFormat(f.format,format))||[];
    return <article className="download-candidate" key={key}>
      <div className="download-candidate-top"><div><button className="download-book-title" onClick={()=>void inspect(provider,book)}>{book.title}</button><p>{book.author!==new URL(book.url).hostname?book.author:''}{book.restricted && <span>需借阅或登录</span>}</p><small className="download-result-host">{new URL(book.url).hostname}</small>{book.summary && <p className="download-summary">{book.summary}</p>}</div><button className="button secondary small" disabled={detail?.status==='loading'} onClick={()=>void inspect(provider,book)}>{detail?.status==='loading'?<LoaderCircle size={14} className="spin"/>:<FileDown size={14}/>}{detail?.status==='loading'?'正在读取':detail?.status==='error'?'重试读取':provider.adapter==='link'?'解析下载':'检查文件'}</button></div>
      {detail && detail.trail.length>0 && <button className="download-page-back" onClick={()=>{inspections.current.set(key,(inspections.current.get(key)||0)+1);setFiles(all=>({...all,[key]:{...detail.trail.at(-1)!,status:'done',trail:detail.trail.slice(0,-1)}}));}}><ArrowLeft size={13}/>返回上一层页面</button>}
      {detail?.title && <div className="download-page-summary"><strong>{detail.title}</strong>{detail.description && <p>{detail.description}</p>}</div>}
      {detail?.status==='done' && !!matches.length && <div className="download-file-list">{matches.map(file=>{
        const job=actions.jobs.find(j=>j.url===file.url && (j.format===file.format||j.archive?.format===file.format) && j.bookId===bindingId),downloading=job && ['queued','downloading'].includes(job.status);
        return <button className="download-file" key={file.url} aria-label={`下载 ${file.name}`} title={file.name} disabled={!!downloading} onClick={()=>void actions.start({url:file.url,name:file.name,format:file.format,preparedId:file.preparedId,referrer:file.referrer || detail.pageUrl || book.url,bookTitle:book.title,bookAuthor:book.author===new URL(book.url).hostname?'':book.author})}><span className="download-format-badge">{file.format}</span><span className="download-file-name">{file.name}</span>{file.size && <small>{file.size}</small>}{downloading?<LoaderCircle size={15} className="spin"/>:job?.status==='completed'?<Check size={15}/>:<Download size={15}/>}<small>{downloading?'下载中':job?.status==='completed'?'立即阅读':'加载到本地'}</small></button>;
      })}</div>}
      {detail?.status==='done' && detail.files.length>0 && !matches.length && <p className="download-file-message">此记录没有 {format==='archive'?'压缩包':format} 文件；已发现 {[...new Set(detail.files.map(f=>f.format))].join('、')}，可切换格式查看。</p>}
      {detail?.message && <p className={`download-file-message ${detail.status==='error'?'is-error':''}`} role={detail.status==='error'?'alert':undefined}>{detail.message}</p>}
      {!!detail?.pages?.length && <div className="download-page-links">{detail.pages.map(link=><button key={link.url} disabled={detail.status==='loading'} onClick={()=>void inspect(provider,book,link.url)}><Link size={13}/><span>{link.title}<small>{new URL(link.url).hostname}</small></span><ArrowRight size={13}/></button>)}</div>}
      {!!detail?.resources?.length && <ResourceLinks format={format} resources={detail.resources} target={{...target,bookId:bindingId,title:target.title,author:target.author}} actions={actions} notify={notify}/>}
      {detail?.rights && <p className="download-rights">原站权利说明：{detail.rights}</p>}
    </article>;
  }
  return <Modal title={managing?'管理下载站点':'查找下载方案'} subtitle={managing?'在当前应用中读取各站结果，可为自定义网站设置解析规则。':`为《${target.title}》查找、下载并带回书架`} onClose={onClose} wide><div className="download-finder">
    {managing?<DownloadSites providers={providers} query={submitted} onChange={onProviders} onBack={()=>setManaging(false)} notify={notify}/>:<>
      <form className="download-search" onSubmit={e=>{e.preventDefault();search({title:title.trim(),author:author.trim(),includeAuthor,format});}}><div className="download-search-fields"><label>书名<input className="form-input" aria-label="下载查找书名" data-autofocus maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>作者<input className="form-input" aria-label="下载查找作者" maxLength={200} value={author} onChange={e=>setAuthor(e.target.value)}/></label></div><div className="download-search-options"><label className="download-checkbox"><input type="checkbox" checked={includeAuthor} onChange={e=>setIncludeAuthor(e.target.checked)}/>同时匹配作者</label><span>网页 · 网盘 · 磁链</span><button className="button primary" disabled={!title.trim()}><Search size={15}/>重新查找</button></div></form>
      {changed && <p className="download-notice" role="status">检索条件已更改，点击「重新查找」更新结果。</p>}
      <div className="download-toolbar"><div className="download-formats" aria-label="下载格式">{downloadFormats.map(value=><button key={value} aria-pressed={format===value} className={format===value?'selected':''} onClick={()=>setFormat(value)}>{value==='all'?'全部格式':value==='archive'?'压缩包':value}</button>)}</div><button className="button text-button small" onClick={()=>setManaging(true)}><Settings2 size={15}/>管理下载站点</button></div>
      <p className="download-caption">格式按钮筛选已读取的文件；点击重新查找，将所选格式用于搜索引擎。选择「加载到本地」后下载并关联到作品；压缩包会自动解压书籍，完成后可立即阅读。</p>
      {actions.jobs.length>0 && <details className="finder-download-tasks" open><summary><Download size={15}/>下载任务<span>{actions.jobs.filter(j=>j.status==='downloading'||j.status==='queued').length} 项进行中</span></summary><DownloadQueue actions={actions} onImport={onImport} importing={importing} compact/></details>}
      <div className="download-provider-filter" aria-label="下载搜索来源"><button aria-pressed={filter==='all'} className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>全部来源</button>{enabled.map(p=><button key={p.id} aria-label={p.name} aria-pressed={filter===p.id} className={filter===p.id?'selected':''} onClick={()=>setFilter(p.id)}>{p.name}{results[p.id]?.status==='loading'?<LoaderCircle size={11} className="spin"/>:<small>{results[p.id]?.books.length||0}</small>}</button>)}</div>
      <details className="download-paste"><summary><Link size={13}/>读取指定页面或下载地址</summary><form onSubmit={e=>{e.preventDefault();readManual(pageUrl);}}><input className="form-input" aria-label="下载页面地址" value={pageUrl} onChange={e=>setPageUrl(e.target.value)} placeholder="粘贴网页、网盘分享（含提取码）、磁链或种子地址" maxLength={16384}/><button className="button secondary small" disabled={!pageUrl.trim()}>在此读取</button></form>{target.url && <button className="button text-button small" onClick={()=>readManual(target.url!)}>读取{target.sourceName || '书籍'}原页</button>}</details>
      {manual && <section className="download-catalog manual-download-page" aria-label="指定页面下载结果"><div className="download-catalog-heading"><strong>指定页面</strong><button onClick={()=>setManual(undefined)}>收起</button></div>{renderBook(pageProvider,manual)}</section>}
      <div className="download-section-heading"><h3><BookOpen size={17}/>下载搜索结果<span>{total} 条候选</span></h3>{busy && <button onClick={stop}><X size={13}/>停止查找</button>}</div>
      {!enabled.length && <p className="download-empty">请在站点管理中启用一个来源，或读取指定下载页面。</p>}
      <div className="download-catalogs">{shown.map(provider=>{const result=results[provider.id];return <section className="download-catalog" key={provider.id} aria-label={`${provider.name}下载结果`}><div className="download-catalog-heading"><div><strong>{provider.name}</strong><small>{result?.status==='loading'?'正在查找…':`${result?.books.length||0} 条结果`}</small></div><button onClick={()=>retry(provider)} disabled={result?.status==='loading'}>重试</button></div>{result?.books.map(book=>renderBook(provider,book))}{result?.status==='loading' && <div className="download-loading" role="status"><LoaderCircle size={17} className="spin"/>正在查找《{submitted.title}》…</div>}{result?.status==='error' && <p className="download-file-message is-error" role="alert">{result.message}</p>}{result?.status==='done' && !result.books.length && <p className="download-empty">此来源没有匹配结果，可调整书名或取消匹配作者。</p>}{result?.nextUrl && result.status!=='loading' && <button className="load-more" onClick={()=>retry(provider,result)}>加载更多结果<ArrowRight size={14}/></button>}</section>;})}</div>
      <p className="download-caption download-footnote">点击结果可解析文件、中转页、网盘与磁链。需要登录、验证或借阅的来源会显示状态；下载时会核验文件格式，避免保存错误页面。</p>
    </>}
  </div></Modal>;
}

function DownloadSites({providers,query,onChange,onBack,notify}: {providers:DownloadProvider[];query:DownloadQuery;onChange:(providers:DownloadProvider[])=>void;onBack:()=>void;notify:(text:string)=>void}) {
  const [editing,setEditing] = useState<DownloadProvider>(); const [error,setError] = useState('');
  const [removed,setRemoved] = useState<DownloadProvider>();
  const [preview,setPreview]=useState<{busy:boolean;books:DownloadCandidate[];message?:string}>();
  const previewVersion=useRef(0);
  useEffect(()=>{previewVersion.current++;setPreview(undefined);return()=>{previewVersion.current++;};},[editing]);
  async function test(){
    if(!editing)return;const id=++previewVersion.current;setPreview({busy:true,books:[]});
    try{const provider={...editing,homepage:new URL(editing.searchUrl).origin+'/'};validateDownloadProvider(provider);const result=await searchDownloadCatalog(provider,query);if(id===previewVersion.current)setPreview({busy:false,books:result.books,message:result.books.length?`读取到 ${result.books.length} 条结果`:'没有匹配结果'});}
    catch(e){if(id===previewVersion.current)setPreview({busy:false,books:[],message:errorMessage(e)});}
  }
  const save = (e:React.FormEvent) => {
    e.preventDefault();if (!editing) return;
    try {
      const provider = {...editing,name:editing.name.trim(),searchUrl:editing.searchUrl.trim(),homepage:new URL(editing.searchUrl.trim()).origin+'/'};
      validateDownloadProvider(provider);
      if (!providers.some(p=>p.id===provider.id) && providers.length>=50) throw new Error('最多可保存 50 个下载站点');
      onChange(providers.some(p=>p.id===provider.id)?providers.map(p=>p.id===provider.id?provider:p):[...providers,provider]);setEditing(undefined);setError('');notify('下载站点已保存');
    } catch(e) {setError((e as Error).message);}
  };
  const add = () => {setError('');setEditing({id:`download-${crypto.randomUUID()}`,name:'',homepage:'https://example.com/',searchUrl:'',enabled:true,adapter:'link',kind:'site'});};
  return <div className="download-manager">
    <button className="source-editor-back" onClick={()=>{if(editing){setEditing(undefined);setError('');}else onBack();}}><ArrowLeft size={15}/>{editing?'返回站点列表':'返回下载结果'}</button>
    {editing ? <form className="source-editor" onSubmit={save}><label>站点名称<input className="form-input" aria-label="下载站点名称" autoFocus required value={editing.name} maxLength={60} onChange={e=>setEditing({...editing,name:e.target.value})}/></label><label>站点类型<select className="form-input" aria-label="下载站点类型" value={editing.kind} onChange={e=>setEditing({...editing,kind:e.target.value as DownloadProvider['kind']})}><option value="site">下载网站（站内解析）</option><option value="engine">搜索引擎（自动附带下载格式）</option></select></label><label>搜索链接<input className="form-input" aria-label="下载站点搜索链接" required value={editing.searchUrl} maxLength={4096} placeholder="https://example.com/search?q={query}" onChange={e=>setEditing({...editing,searchUrl:e.target.value})}/></label><p className="source-field-help">把网站搜索后的地址粘贴到这里，将关键词换为 <code>{'{query}'}</code>。也可使用 <code>{'{title}'}</code>、<code>{'{author}'}</code>、<code>{'{format}'}</code>；作者仅在勾选匹配作者时填入，全部格式时 format 为空。普通下载站的 query 只含书名与选中的作者，可自行在链接中组合格式。</p><label>站点说明<input className="form-input" aria-label="下载站点说明" value={editing.description || ''} maxLength={300} onChange={e=>setEditing({...editing,description:e.target.value})}/></label><details className="source-advanced"><summary>自定义结果解析规则</summary><p className="source-field-help">通常自动识别即可。如果网站结构特殊，可填写 CSS 选择器。只读取结果文字和链接，不执行结果中的脚本。</p>{([['item','结果条目'],['title','结果标题'],['link','结果链接'],['description','结果简介'],['next','下一页']] as const).map(([key,label])=><label key={key}>{label}<input className="form-input" aria-label={`下载解析${label}`} value={editing.selectors?.[key] || ''} maxLength={1000} onChange={e=>setEditing({...editing,selectors:{...editing.selectors,[key]:e.target.value}})}/></label>)}</details>{preview && <div className="download-parser-preview" role="status"><p>{preview.busy?'正在读取站点结果…':preview.message}</p>{preview.books.slice(0,5).map(book=><p key={book.id}><strong>{book.title}</strong><small>{new URL(book.url).hostname}</small></p>)}</div>}{error && <p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" disabled={preview?.busy} onClick={()=>void test()}>{preview?.busy?'正在读取…':'预览结果'}</button><button className="button primary">保存下载站点</button></div></form> : <>
      <div className="download-provider-list">{providers.map(p=><div className="download-provider-row" key={p.id}><label><input type="checkbox" aria-label={`启用下载站 ${p.name}`} checked={p.enabled} onChange={e=>onChange(providers.map(v=>v.id===p.id?{...v,enabled:e.target.checked}:v))}/><span><strong>{p.name}<small>{p.adapter!=='link'?'自动读取目录':p.kind==='engine'?'搜索引擎':'网页解析'}</small></strong><em>{p.description || new URL(p.homepage).hostname}</em></span></label>{p.adapter==='link' && <IconButton label={`编辑下载站 ${p.name}`} onClick={()=>{setError('');setEditing({...p});}}><Pencil size={14}/></IconButton>}<IconButton label={`删除下载站 ${p.name}`} onClick={()=>{setRemoved(p);onChange(providers.filter(v=>v.id!==p.id));}}><Trash2 size={14}/></IconButton></div>)}</div>
      {!providers.length && <p className="download-empty">暂无下载站点。可以添加常用站点，或恢复内置入口。</p>}
      {removed && !providers.some(p=>p.id===removed.id) && <p className="download-undo">已移除 {removed.name}<button onClick={()=>{if(providers.length<50)onChange([...providers,removed]);setRemoved(undefined);}}>撤销</button></p>}
      <div className="download-manager-actions"><button className="button secondary" disabled={providers.length>=50} onClick={add}><Plus size={15}/>添加下载站点</button><button className="button text-button small" onClick={()=>{const missing=defaultDownloadProviders.filter(p=>!providers.some(v=>v.id===p.id));onChange([...providers,...structuredClone(missing)].slice(0,50));notify('已补回缺少的内置入口，现有设置已保留');}}>补回内置入口</button></div>
    </>}
  </div>;
}
