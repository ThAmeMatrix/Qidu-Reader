import {isArchiveFormat} from '../lib/downloads';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, BookPlus, Check, Download, LoaderCircle, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { DownloadJob, DownloadRequest } from '../types';
import { IconButton } from './ui';

function message(error:unknown) { return (error as Error).message?.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'') || '操作失败，请重试'; }
export function useDownloads(notify:(text:string)=>void) {
  const [jobs,setJobs]=useState<DownloadJob[]>([]);const notifyRef=useRef(notify);notifyRef.current=notify;
  useEffect(()=>{
    const api=window.desktop?.downloads;if(!api)return;
    let disposed=false,updated=false;
    const unsubscribe=api.onChange(value=>{updated=true;if(!disposed)setJobs(value);});
    void api.list().then(value=>{if(!disposed && !updated)setJobs(value);}).catch(e=>{if(!disposed)notifyRef.current(message(e));});
    return ()=>{disposed=true;unsubscribe();};
  },[]);
  const api=()=>{if(!window.desktop?.downloads)throw new Error('请使用桌面版进行站内下载');return window.desktop.downloads;};
  const run=async(action:()=>Promise<unknown>)=>{try{await action();}catch(e){notifyRef.current(message(e));}};
  return {jobs,read:async(_job:DownloadJob,_password?:string)=>{notifyRef.current('请从书架打开这本书');},
    start:(request:DownloadRequest)=>run(async()=>{const job=await api().start(request);notifyRef.current(job.status==='completed'?'文件已下载，可在下载任务中加入书架':'已加入下载队列');}),
    cancel:(id:string)=>run(()=>api().cancel(id)),retry:(id:string)=>run(()=>api().retry(id)),remove:(id:string)=>run(()=>api().remove(id)),
    openCloud:(job:DownloadJob)=>run(()=>api().openCloud({id:crypto.randomUUID(),url:job.cloudUrl||job.url,password:job.cloudPassword,bookTitle:job.bookTitle,bookAuthor:job.bookAuthor})),
    save:(id:string)=>run(async()=>{if(await api().save(id))notifyRef.current('文件已保存到所选位置');}),
  };
}
export type DownloadActions=ReturnType<typeof useDownloads>;
const size=(bytes:number)=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:bytes>=1024?`${(bytes/1024).toFixed(1)} KB`:`${bytes} B`;
const states={queued:'等待下载',downloading:'正在下载',completed:'下载完成',failed:'下载失败',cancelled:'已取消'};
export function DownloadQueue({actions,onImport,importing,compact=false}:{actions:DownloadActions;onImport:(job:DownloadJob)=>Promise<void>;importing?:string;compact?:boolean}) {
  const [expanded,setExpanded]=useState(false);const [passwords,setPasswords]=useState<Record<string,string>>({});const jobs=compact&&!expanded?actions.jobs.slice(0,3):actions.jobs;
  return <div className={`download-queue ${compact?'compact':''}`}>
    {!actions.jobs.length && <p className="download-empty">还没有下载任务。在搜索结果中选择一个文件即可开始。</p>}
    {jobs.map(job=>{
      const percent=job.total?Math.min(100,Math.round(job.received/job.total*100)):undefined;
      const archive=isArchiveFormat(job.format);
      const busy=job.status==='downloading'||job.status==='queued';
      return <article className="download-job" key={job.id} data-status={job.status} aria-label={`下载任务 ${job.name}`}>
        <div className="download-job-top"><span className="download-format-badge">{job.format}</span><div><strong title={job.name}>{job.name}</strong><small>{states[job.status]}{job.source==='torrent'?' · 磁链':job.source==='browser'?' · 网盘':''} · {size(job.received)}{job.total?` / ${size(job.total)}`:''}{job.status==='downloading' && percent!==undefined?` · ${percent}%`:''}{job.source==='torrent'&&busy?` · ${job.peers||0} 个连接${job.speed?' · '+size(job.speed)+'/s':''}`:''}</small></div>{busy?<LoaderCircle size={16} className="spin"/>:job.status==='completed'?<Check size={17}/>:<Download size={17}/>}</div>
        {busy && <div className={`download-progress ${percent===undefined?'indeterminate':''}`} role="progressbar" aria-label={`${job.name}下载进度`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{width:percent===undefined?'30%':`${percent}%`}}/></div>}
        {job.status==='completed'&&archive&&<p className="download-caption">下载完成后自动解压并关联作品；若需要密码，可填写后重试。</p>}
        {archive&&job.status==='completed'&&<input className="form-input" type="password" aria-label={`解压密码 ${job.name}`} placeholder="解压密码（加密压缩包需要）" value={passwords[job.id]||''} onChange={e=>setPasswords({...passwords,[job.id]:e.target.value})} maxLength={200}/>}
        {job.archive&&<p className="download-caption">已从 {job.archive.name} 自动解压，当前文件可直接阅读。</p>}
        {job.error && <p className="download-job-error">{job.error}</p>}
        <div className="download-job-actions">
          {busy && <button onClick={()=>void actions.cancel(job.id)}><X size={13}/>取消下载</button>}
          {['failed','cancelled'].includes(job.status) && <button onClick={()=>void (job.source==='browser'?actions.openCloud(job):actions.retry(job.id))}><RotateCcw size={13}/>{job.source==='browser'?'重新打开网盘':'重新下载'}</button>}
          {job.status==='completed' && <><button disabled={!!importing} onClick={()=>void actions.read(job,passwords[job.id])}><BookOpen size={13}/>{importing===job.id?'正在准备…':archive?'解压并阅读':'立即阅读'}</button>{!archive&&<button disabled={!!importing} onClick={()=>void onImport(job)}>{importing===job.id?<LoaderCircle size={13} className="spin"/>:<BookPlus size={13}/>}{importing===job.id?'正在入架':'加入书架'}</button>}<button onClick={()=>void actions.save(job.id)}><Save size={13}/>另存文件</button></>}
          {!busy && <IconButton label={`清理下载 ${job.name}`} disabled={importing===job.id} onClick={()=>void actions.remove(job.id)}><Trash2 size={13}/></IconButton>}
        </div>
      </article>;
    })}
    {compact && actions.jobs.length>3 && <button className="load-more" onClick={()=>setExpanded(!expanded)}>{expanded?'收起下载列表':`查看全部 ${actions.jobs.length} 个任务`}</button>}
    {!compact && <p className="download-caption">单文件上限 100 MB。压缩包自动提取书籍并关联原作品，完成后可立即阅读；清理会删除对应的本地文件，作品收藏、书评和进度仍保留。退出应用会停止未完成的任务，下次打开后可重试。</p>}
  </div>;
}
