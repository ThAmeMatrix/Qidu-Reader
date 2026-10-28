import {useEffect,useRef,useState} from 'react';
import {CloudDownload,Copy,Download,FolderOpen,LoaderCircle,Magnet,Search,X} from 'lucide-react';
import type {DownloadTarget,TorrentResource} from '../types';
import type {DownloadResource} from '../lib/download-resources';
import {parseDownloadPage,matchesDownloadFormat,type DownloadFormat,type DownloadFiles} from '../lib/downloads';
import {followDownloadPages} from '../lib/download-chain';
import type {DownloadActions} from './Downloads';
const errorText=(e:unknown)=>(e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
const size=(n:number)=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${(n/1024).toFixed(1)} KB`:`${n} B`;
export function ResourceLinks({resources,target,actions,notify,format='all',seen=[]}:{seen?:string[];format?:DownloadFormat;resources:DownloadResource[];target:DownloadTarget;actions:DownloadActions;notify:(text:string)=>void}){
 return <div className="download-resources">{resources.filter(resource=>!seen.includes(resource.url)).map((resource,index)=><ResourceCard seen={seen} auto={index===0} format={format} key={resource.url} resource={resource} target={target} actions={actions} notify={notify}/>)}</div>;
}
function ResourceCard({resource,target,actions,notify,format,auto,seen}:{seen:string[];auto:boolean;format:DownloadFormat;resource:DownloadResource;target:DownloadTarget;actions:DownloadActions;notify:(text:string)=>void}){
 const [id]=useState(()=>crypto.randomUUID()),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[torrent,setTorrent]=useState<TorrentResource>(),[page,setPage]=useState<DownloadFiles>();
 const [filter,setFilter]=useState(''),[shown,setShown]=useState(30);const sequence=useRef(0),controller=useRef<AbortController|undefined>(undefined),pending=useRef<string|undefined>(undefined);
 useEffect(()=>{
  const api=window.desktop?.downloads;void api?.setCloudContext(id,true).catch(()=>{});
  const off=api?.onPage(value=>{if(value.contextId!==id)return;const version=sequence.current;void Promise.resolve().then(()=>followDownloadPages(parseDownloadPage(value),controller.current?.signal)).then(result=>{if(version===sequence.current){setPage(result);setMessage(result.message||'文件已读回，可加载到本地');}}).catch(e=>{if(version===sequence.current)setMessage(errorText(e));});});
  const prepared=api?.onPrepared(value=>{if(value.contextId!==id)return;const file=value.file;setPage(previous=>({...previous,files:[...(previous?.files||[]).filter(f=>(f.preparedId||f.url)!==(file.preparedId||file.url)),file]}));setBusy(false);setMessage('文件已就绪，选择「加载到本地」后下载。');});
  const status=api?.onResolveStatus(value=>{if(value.contextId!==id)return;setMessage(value.message);if(value.done)setBusy(false);});
  return()=>{sequence.current++;controller.current?.abort();void api?.setCloudContext(id,false).catch(()=>{});if(pending.current)void api?.cancelResolution(pending.current);off?.();prepared?.();status?.();};
 },[id]);
 useEffect(()=>{if(auto)void inspect();},[]);
 useEffect(()=>setShown(30),[format]);
 function stop(){sequence.current++;controller.current?.abort();if(pending.current)void window.desktop?.downloads.cancelResolution(pending.current);void window.desktop?.downloads.stopCloud(id);pending.current=undefined;setBusy(false);setMessage('已取消解析');}
 async function inspect(){
  if(!window.desktop?.downloads){notify('请使用桌面版解析网盘和磁链');return;}
  const version=++sequence.current;setBusy(true);setMessage('正在继续解析到文件…');setPage(undefined);setTorrent(undefined);controller.current?.abort();controller.current=new AbortController();let native=false;
  try{
   if(resource.kind==='cloud'){
    await window.desktop.downloads.openCloud({id,url:resource.url,password:resource.password,bookTitle:target.title,bookAuthor:target.author,bookId:target.bookId,work:target.work,resolve:true,restart:true});native=true;
   }else{
    const requestId=crypto.randomUUID();pending.current=requestId;const result=await window.desktop.downloads.resolveTorrent({url:resource.url,id:requestId});
    if(version===sequence.current){setTorrent(result);setShown(30);setMessage(result.files.some(f=>f.available)?'文件已找到，选择后加载到本地。':'资源中没有支持的文件，单文件上限 100 MB。');}
   }
  }catch(e){if(version===sequence.current)setMessage(errorText(e));}finally{if(version===sequence.current&&!native){pending.current=undefined;setBusy(false);}}
 }
 async function open(){try{await window.desktop?.downloads.openCloud({id,url:resource.url,password:resource.password,bookTitle:target.title,bookAuthor:target.author,bookId:target.bookId,work:target.work,resolve:true});}catch(e){setMessage(errorText(e));}}
 const selected=torrent?.files.filter(f=>matchesDownloadFormat(f.format,format)&&(!filter||f.name.toLowerCase().includes(filter.toLowerCase())))||[];
 const pageFiles=page?.files.filter(f=>matchesDownloadFormat(f.format,format))||[];
 return <section className="download-resource" aria-label={`${resource.provider}资源`}>
  <div className="download-resource-heading">{resource.kind==='cloud'?<CloudDownload size={18}/>:<Magnet size={18}/>}<div><strong>{resource.title}</strong><small>{resource.provider} · 自动解析到文件</small></div>{resource.password&&<button className="resource-code" title="复制提取码" onClick={()=>void navigator.clipboard.writeText(resource.password!).then(()=>notify('提取码已复制')).catch(()=>notify('提取码：'+resource.password))}>提取码 <b>{resource.password}</b><Copy size={12}/></button>}</div>
  <p className="resource-url" title={resource.url}>{resource.url}</p>
  <div className="resource-actions"><button className="button secondary small" disabled={busy} onClick={()=>void inspect()}>{busy?<LoaderCircle size={14} className="spin"/>:<Search size={14}/>} {busy?'正在解析':'重新解析文件'}</button>{resource.kind==='cloud'&&<button className="button primary small" onClick={()=>void open()}><FolderOpen size={14}/>网盘窗口</button>}{busy&&<button className="button text-button small" onClick={stop}><X size={13}/>取消解析</button>}</div>
  {message&&<p className="download-file-message" role="status">{message}</p>}
  {torrent&&<div className="torrent-files"><div className="torrent-file-heading"><span>{torrent.files.length} 个文件 · {torrent.files.filter(f=>f.available).length} 个可加载</span><input className="form-input" aria-label="筛选种子文件" placeholder="按文件名筛选" value={filter} onChange={e=>{setFilter(e.target.value);setShown(30);}}/></div>{!selected.length&&<p className="download-caption">没有匹配的文件，可切换格式或调整文件名筛选。</p>}{selected.slice(0,shown).map(file=><div className="torrent-file" key={file.index}><span><strong>{file.name}</strong><small>{size(file.size)}{!file.available?' · 暂不支持或超过大小限制':''}</small></span><button className="button secondary small" disabled={!file.available||actions.jobs.some(j=>j.resourceId===torrent.id&&j.fileIndex===file.index&&['queued','downloading'].includes(j.status))} onClick={()=>void actions.start({url:torrent.url,name:file.name,format:file.format!,resourceId:torrent.id,fileIndex:file.index,source:'torrent',bookTitle:target.title,bookAuthor:target.author})}><Download size={13}/>加载到本地</button></div>)}{selected.length>shown&&<button className="load-more" onClick={()=>setShown(shown+30)}>显示更多文件</button>}</div>}
  {!!page?.files.length&&!pageFiles.length&&<p className="download-caption">当前格式没有匹配的文件，可切换「全部格式」查看。</p>}
  {!!pageFiles.length&&<div className="download-file-list">{pageFiles.map(file=><button className="download-file" key={file.preparedId||file.url} disabled={!!file.preparedId&&actions.jobs.some(job=>job.id===file.preparedId&&['queued','downloading'].includes(job.status))} onClick={()=>void actions.start({url:file.url,name:file.name,format:file.format,preparedId:file.preparedId,referrer:page?.pageUrl||resource.url,bookTitle:target.title,bookAuthor:target.author})}><span className="download-format-badge">{file.format}</span><span className="download-file-name">{file.name}</span><Download size={14}/>{actions.jobs.some(job=>job.id===file.preparedId&&job.status==='completed')?'立即阅读':'加载到本地'}</button>)}</div>}
  {!!page?.resources?.filter(r=>r.url!==resource.url).length&&<ResourceLinks seen={[...seen,resource.url]} resources={page.resources.filter(r=>r.url!==resource.url)} target={target} actions={actions} notify={notify} format={format}/>}
 </section>;
}
