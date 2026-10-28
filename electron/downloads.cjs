const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const { validateUrl } = require('./web.cjs');
const {formats,formatFromName,formatFromMime}=require('./download-formats.cjs');
const { magnet } = require('./torrent-engine.cjs');

const LIMIT = 100 * 1024 * 1024;
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function filename(value, format) {
  let name = String(value || '电子书').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,140);
  if (/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = '_'+name;
  name = name.replace(/\.(?:epub|pdf|txt|zip|rar|7z)$/i,'');
  return `${name || '电子书'}.${format.toLowerCase()}`;
}
function validateDownloadRequest(request) {
  if (!request || typeof request !== 'object' || !formats.includes(request.format)) throw new Error('支持下载 EPUB、PDF、TXT、ZIP、RAR、7Z');
  const url = request.resourceId && /^magnet:/i.test(request.url) ? magnet(request.url).url : validateUrl(request.url).href;
  if(request.resourceId!==undefined && (!idPattern.test(request.resourceId)||!Number.isSafeInteger(request.fileIndex)||request.fileIndex<1))throw new Error('请重新解析种子并选择文件');
  if(request.source!==undefined && !['torrent','browser'].includes(request.source))throw new Error('下载来源无效');
  if(request.source==='torrent'&&!request.resourceId)throw new Error('种子文件资料不完整');
  if(request.cloudUrl!==undefined)validateUrl(request.cloudUrl);
  if(request.cloudPassword!==undefined && !/^[a-zA-Z0-9]{1,16}$/.test(request.cloudPassword))throw new Error('分享提取码无效');
  if(request.bookId!==undefined && (typeof request.bookId!=='string'||!/^[\w-]{1,80}$/.test(request.bookId)))throw new Error('作品标识无效');
  if(request.autoLoad!==undefined && typeof request.autoLoad!=='boolean')throw new Error('加载方式无效');
  if(request.work!==undefined){const w=request.work;if(!w||typeof w!=='object')throw new Error('作品资料无效');validateUrl(w.url);for(const key of ['sourceId','sourceName','title','author','description'])if(typeof w[key]!=='string'||w[key].length>(key==='description'?20000:1000))throw new Error('作品资料无效');}
  if (request.referrer !== undefined) validateUrl(request.referrer);
  for (const key of ['name','bookTitle','bookAuthor']) if (typeof request[key] !== 'string' || request[key].length > 2000) throw new Error('下载资料无效');
  return {bookId:request.bookId,work:request.work?{sourceId:request.work.sourceId,sourceName:request.work.sourceName,url:request.work.url,title:request.work.title,author:request.work.author,description:request.work.description}:undefined,autoLoad:request.autoLoad,url,name:filename(request.name || request.bookTitle,request.format),format:request.format,referrer:request.referrer,bookTitle:request.bookTitle.slice(0,1000),bookAuthor:request.bookAuthor.slice(0,1000),...(request.resourceId?{resourceId:request.resourceId,fileIndex:request.fileIndex,source:'torrent'}:{}),...(request.source==='browser'?{source:'browser',cloudUrl:request.cloudUrl||url,cloudPassword:request.cloudPassword}:{})};
}
function checkPrefix(bytes, format, contentType) {
  if (/html|json|javascript|x-msdownload|x-dosexec/i.test(contentType)) throw new Error('站点返回了网页或验证信息，没有返回书籍文件');
  if (bytes.subarray(0,2).toString()==='MZ') throw new Error('返回的内容不是可阅读的书籍文件');
  if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<script\b)/i.test(bytes.toString('utf8'))) throw new Error('返回的是网页，不能作为书籍保存');
  if (format==='ZIP' && !(bytes.length>=22 && ['504b0304','504b0506'].includes(bytes.subarray(0,4).toString('hex'))))throw new Error('下载内容不是有效的 ZIP 压缩包');
  if (format==='RAR' && !(bytes.length>=7 && (bytes.subarray(0,7).toString('hex')==='526172211a0700' || bytes.subarray(0,8).toString('hex')==='526172211a070100')))throw new Error('下载内容不是有效的 RAR 压缩包');
  if (format==='7Z' && !(bytes.length>=32 && bytes.subarray(0,6).toString('hex')==='377abcaf271c'))throw new Error('下载内容不是有效的 7Z 压缩包');
  if (format==='PDF' && !bytes.subarray(0,1024).toString('latin1').includes('%PDF-')) throw new Error('下载内容不是有效的 PDF 文件');
  if (format==='EPUB' && (bytes.length<4 || bytes.readUInt32LE(0)!==0x04034b50)) throw new Error('下载内容不是有效的 EPUB 文件');
  if (format==='TXT') {
    const utf16 = bytes[0]===0xff && bytes[1]===0xfe || bytes[0]===0xfe && bytes[1]===0xff;
    const text = new TextDecoder(utf16 ? (bytes[0]===0xff?'utf-16le':'utf-16be') : 'utf-8').decode(bytes).replace(/^\uFEFF/,'').trimStart();
    if (/^(?:<!doctype\s+html|<html\b|<head\b|<script\b|<\?xml\b|\{\s*"(?:error|code|message)"\s*:)/i.test(text)) throw new Error('返回的是页面或错误信息，不能作为 TXT 保存');
    if (!utf16 && (bytes.includes(0) || bytes.subarray(0,2).toString()==='PK' || text.startsWith('%PDF-') || [...bytes].filter(n=>n<9 || n>13 && n<32).length>Math.max(2,bytes.length*.02))) throw new Error('下载内容不是文本文件');
  }
}
async function checkEpub(filePath, size) {
  const file = await fs.open(filePath,'r');
  try {
    const tail = Buffer.alloc(Math.min(size,65557));await file.read(tail,0,tail.length,size-tail.length);
    let end = -1;
    for (let i=tail.length-22;i>=0;i--) if (tail.readUInt32LE(i)===0x06054b50 && i+22+tail.readUInt16LE(i+20)===tail.length) {end=i;break;}
    if (end<0) throw new Error('EPUB 压缩目录不完整');
    const directorySize=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
    if (directorySize>8*1024*1024 || offset+directorySize>size) throw new Error('EPUB 压缩目录无效');
    const directory=Buffer.alloc(directorySize);await file.read(directory,0,directory.length,offset);
    for(let at=0;at+46<=directory.length;){
      if(directory.readUInt32LE(at)!==0x02014b50)break;
      const nameSize=directory.readUInt16LE(at+28),extra=directory.readUInt16LE(at+30),comment=directory.readUInt16LE(at+32);
      if(at+46+nameSize+extra+comment>directory.length)break;
      const name=directory.subarray(at+46,at+46+nameSize).toString();
      if(name==='mimetype'){
        const compressed=directory.readUInt32LE(at+20),method=directory.readUInt16LE(at+10),localOffset=directory.readUInt32LE(at+42);
        if(compressed>4096 || localOffset+30+compressed>size || ![0,8].includes(method) || directory.readUInt16LE(at+8)&1)break;
        const local=Buffer.alloc(30);await file.read(local,0,30,localOffset);
        if(local.readUInt32LE(0)!==0x04034b50)break;
        const start=localOffset+30+local.readUInt16LE(26)+local.readUInt16LE(28);
        if(start+compressed>size)break;
        const data=Buffer.alloc(compressed);await file.read(data,0,data.length,start);
        const value=method===8?inflateRawSync(data,{maxOutputLength:512}):data;
        if(value.toString().trim()==='application/epub+zip')return;
        break;
      }
      at+=46+nameSize+extra+comment;
    }
    throw new Error('下载内容不是 EPUB 书籍（缺少正确的 mimetype）');
  } finally {await file.close();}
}

// Owns only UUID-named files inside its private directory. Renderers never
// supply local paths. The injectable transport also permits offline tests.
function createDownloadManager({directory,fetch:requestFetch=fetch,userAgent='QiduReader/1.4',onChange=()=>{},limit=LIMIT,idleTimeout=30000,timeout=300000,torrentTransfer,archiveExtract=require('./archive.cjs').extractArchive}) {
  const jobs=new Map(),active=new Map(),tasks=new Set(),browserItems=new Map(),prepared=new Map(),extractions=new Map();let writing=Promise.resolve(),closed=false,lastProgress=0,closing;
  const manifest=path.join(directory,'downloads.json');
  const filePath=(job,partial=false)=>path.join(directory,`${job.id}.${job.format.toLowerCase()}${partial?'.part':''}`);
  const list=()=>[...jobs.values()].sort((a,b)=>b.createdAt-a.createdAt).map(j=>({...j}));
  const emit=()=>onChange(list());
  const persist=()=>{
    const data=JSON.stringify(list());
    writing=writing.catch(()=>{}).then(async()=>{await fs.writeFile(manifest+'.tmp',data);await fs.rename(manifest+'.tmp',manifest);});
    return writing;
  };
  const ready=(async()=>{
    await fs.mkdir(directory,{recursive:true});
    for(const name of await fs.readdir(directory))if(/^[a-f0-9-]{36}\.(?:txt|epub|pdf|zip|rar|7z)\.part$/i.test(name))await fs.unlink(path.join(directory,name)).catch(()=>{});
    let saved;try{saved=JSON.parse(await fs.readFile(manifest,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('下载记录无法读取，请检查本地资料目录');return;}
    if(!Array.isArray(saved))throw new Error('下载记录格式无效');
    for(const value of saved.slice(0,100)){
      if(!value || !idPattern.test(value.id))continue;
      try{
        const request=validateDownloadRequest(value);
        const job={...request,...(value.archive&&['ZIP','RAR','7Z'].includes(value.archive.format)?{archive:{name:String(value.archive.name).slice(0,200),format:value.archive.format}}:{}),id:value.id,createdAt:Number(value.createdAt)||Date.now(),received:0,status:'cancelled'};
        if(value.status==='completed'){
          const stat=await fs.stat(filePath(job)).catch(()=>null);
          if(stat?.isFile() && stat.size>0 && stat.size<=limit){job.status='completed';job.received=stat.size;job.total=stat.size;}
          else {job.status='failed';job.error='已下载文件不存在，请重新下载';}
        }else if(value.status==='failed'){job.status='failed';job.error=String(value.error||'下载失败').slice(0,500);}
        else job.error='上次下载未完成，可点击重试';
        jobs.set(job.id,job);await fs.unlink(filePath(job,true)).catch(()=>{});
      }catch{/* Ignore invalid records, never derive paths from them. */}
    }
  })();
  const get=id=>{if(typeof id!=='string'||!idPattern.test(id)||!jobs.has(id))throw new Error('下载任务不存在');return jobs.get(id);};
  async function transfer(job,controller){
    let file,reader,timer,totalTimer,timedOut=false;
    const reset=()=>{if(job.resourceId)return;clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},idleTimeout);};
    totalTimer=setTimeout(()=>{timedOut=true;controller.abort();},job.resourceId?3600000:timeout);reset();
    const abort=()=>{void reader?.cancel().catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
    try{
      if(job.resourceId || job.source==='browser'){
        const progress=value=>{if(value.received>limit)throw new Error('文件超过 100 MB');if(value.received!==job.received)reset();Object.assign(job,value);emit();};
        if(job.resourceId){if(!torrentTransfer)throw new Error('磁链下载引擎不可用');await torrentTransfer(job,filePath(job,true),{signal:controller.signal,onProgress:progress});}
        else await transferBrowser(job,controller.signal,progress);
        const stat=await fs.stat(filePath(job,true));if(!stat.size||stat.size>limit)throw new Error('文件为空或超过 100 MB');
        const handle=await fs.open(filePath(job,true),'r');try{const prefix=Buffer.alloc(Math.min(4096,stat.size));await handle.read(prefix,0,prefix.length,0);checkPrefix(prefix,job.format,browserItems.get(job.id)?.mime||'');}finally{await handle.close();}
        job.received=stat.size;job.total=stat.size;
      }else{
      let url=validateUrl(job.url),response;
      for(let redirects=0;redirects<=5;redirects++){
        if(controller.signal.aborted)throw new Error('已取消');
        response=await requestFetch(url.href,{method:'GET',redirect:'manual',signal:controller.signal,headers:{'User-Agent':userAgent,Accept:'application/epub+zip,application/pdf,text/plain,application/zip,application/vnd.rar,application/x-7z-compressed,application/octet-stream',...(job.referrer?{Referer:new URL(job.referrer).origin+'/'}:{})}});
        if([301,302,303,307,308].includes(response.status)){
          const location=response.headers.get('location');await response.body?.cancel();
          if(!location || redirects===5)throw new Error('下载地址重定向过多');url=validateUrl(new URL(location,url).href);reset();continue;
        }
        break;
      }
      if([401,403,429].includes(response.status)){await response.body?.cancel();throw new Error('站点需要登录、验证或暂时限制下载，请稍后重试');}
      if(response.status!==200){await response.body?.cancel();throw new Error(`下载失败（HTTP ${response.status}）`);}
      const length=Number(response.headers.get('content-length')),encoding=response.headers.get('content-encoding');
      if(length>limit){await response.body?.cancel();throw new Error('文件超过 100 MB，无法下载到当前书库');}
      const type=response.headers.get('content-type')||'';
      if(/html|json|javascript|x-msdownload|x-dosexec/i.test(type)){await response.body?.cancel();throw new Error('站点返回了网页或验证信息，没有返回书籍文件');}
      if(!response.body)throw new Error('文件为空');
      const disposition=response.headers.get('content-disposition')||'';
      let suggested;try{suggested=decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]||'');}catch{}
      suggested=suggested||disposition.match(/filename="([^"]+)"|filename=([^;\s]+)/i)?.slice(1).find(Boolean);
      if(suggested && suggested.toLowerCase().endsWith('.'+job.format.toLowerCase()))job.name=filename(suggested,job.format);
      job.total=!encoding && Number.isFinite(length) && length>0?length:undefined;emit();
      file=await fs.open(filePath(job,true),'w');reader=response.body.getReader();let prefix=Buffer.alloc(0),checked=false;
      while(true){
        const {value,done}=await reader.read();if(controller.signal.aborted)throw new Error('已取消');if(done)break;reset();
        job.received+=value.byteLength;if(job.received>limit)throw new Error('文件超过 100 MB，下载已停止');
        if(prefix.length<4096)prefix=Buffer.concat([prefix,Buffer.from(value).subarray(0,4096-prefix.length)]);
        if(!checked && prefix.length>=4096){checkPrefix(prefix,job.format,type);checked=true;}
        await file.writeFile(value);
        if(Date.now()-lastProgress>150){lastProgress=Date.now();emit();}
      }
      if(!job.received)throw new Error('文件为空');
      checkPrefix(prefix,job.format,type);
      if(job.total!==undefined && job.received!==job.total)throw new Error('文件未传输完整，请重试');
      await file.close();file=undefined;
      }
      if(job.format==='EPUB')await checkEpub(filePath(job,true),job.received);
      if(controller.signal.aborted)throw new Error('已取消');
      await fs.rename(filePath(job,true),filePath(job));job.status='completed';job.total=job.received;job.error=undefined;
    }catch(error){
      await reader?.cancel().catch(()=>{});await file?.close().catch(()=>{});file=undefined;
      await fs.unlink(filePath(job,true)).catch(()=>{});
      job.status=controller.signal.aborted&&!timedOut?'cancelled':'failed';job.error=timedOut?'下载响应超时，请重试':job.status==='cancelled'?'已取消下载':String(error.message||'下载失败').slice(0,500);
    }finally{
      clearTimeout(timer);clearTimeout(totalTimer);controller.signal.removeEventListener('abort',abort);active.delete(job.id);browserItems.delete(job.id);
      try{await persist();}catch{job.error=(job.error?job.error+'；':'')+'下载记录保存失败';}
      emit();pump();
    }
  }
  function transferBrowser(job,signal,onProgress){
    return new Promise((resolve,reject)=>{
      const entry=browserItems.get(job.id);if(!entry){reject(new Error('请重新打开网盘并点击文件下载'));return;}
      if(entry.completed){resolve();return;}
      const item=entry.item;
      const abort=()=>{item.cancel();};
      const done=(_event,state)=>{signal.removeEventListener('abort',abort);item.removeListener('updated',progress);state==='completed'?resolve():reject(new Error(state==='cancelled'?'已取消下载':'网盘传输中断，请重新获取下载链接'));};
      const progress=()=>{try{onProgress({received:item.getReceivedBytes(),total:item.getTotalBytes()||undefined});}catch{item.cancel();}};
      item.on('updated',progress);item.once('done',done);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)item.cancel();else item.resume();
    });
  }
  async function prepareBrowser(item,context){
    const format=formatFromName(item.getFilename()) || formatFromMime(item.getMimeType());
    if(!format){item.cancel();throw new Error('请选择 EPUB、PDF、TXT 或 ZIP、RAR、7Z 文件；不接收客户端安装程序');}
    if(item.getTotalBytes()>limit){item.cancel();throw new Error('文件超过 100 MB，请选择较小的文件');}
    const sourceUrl=/^https?:/i.test(item.getURL())?item.getURL():context.url;
    const input=validateDownloadRequest({url:sourceUrl,name:item.getFilename(),format,bookTitle:context.bookTitle||item.getFilename(),bookAuthor:context.bookAuthor||'',source:'browser',cloudUrl:context.url,cloudPassword:context.password,bookId:context.bookId,work:context.work});
    const job={...input,id:randomUUID(),status:'queued',received:0,total:item.getTotalBytes()||undefined,createdAt:Date.now()};
    item.pause();item.setSavePath(filePath(job,true));
    const entry={item,mime:item.getMimeType(),job,completed:false};
    item.once('done',(_e,state)=>{entry.completed=state==='completed';if(state!=='completed'&&prepared.has(job.id)){clearTimeout(entry.timer);prepared.delete(job.id);void fs.unlink(filePath(job,true)).catch(()=>{});}});
    await ready;if(closed||prepared.size>=20){item.cancel();throw new Error('待加载文件过多，请先加载已有文件或重新解析');}
    entry.timer=setTimeout(()=>{prepared.delete(job.id);try{item.cancel();}catch{}void fs.unlink(filePath(job,true)).catch(()=>{});},10*60*1000);entry.timer.unref?.();prepared.set(job.id,entry);
    return {...input,preparedId:job.id};
  }
  async function startPrepared(request){
    const entry=prepared.get(request.preparedId);if(!entry)throw new Error('下载地址已过期，请重新解析该分享');
    if(jobs.size>=100)throw new Error('请先清理部分下载记录');
    const input=validateDownloadRequest({...entry.job,bookId:request.bookId||entry.job.bookId,work:request.work||entry.job.work,autoLoad:request.autoLoad});
    const job={...entry.job,...input};clearTimeout(entry.timer);prepared.delete(job.id);jobs.set(job.id,job);browserItems.set(job.id,entry);
    try{await persist();}catch(e){try{entry.item.cancel();}catch{}jobs.delete(job.id);browserItems.delete(job.id);await fs.unlink(filePath(job,true)).catch(()=>{});throw e;}
    emit();pump();return {...job};
  }
  async function captureBrowser(item,context){const request=await prepareBrowser(item,context);return startPrepared({...request,autoLoad:context.autoLoad});}
  function pump(){
    if(closed)return;
    for(const job of jobs.values()){
      if(active.size>=2)break;if(job.status!=='queued')continue;
      const controller=new AbortController();active.set(job.id,controller);job.status='downloading';emit();const task=transfer(job,controller);tasks.add(task);void task.finally(()=>tasks.delete(task));
    }
  }
  return {
    ready,captureBrowser,prepareBrowser,list:async()=>{await ready;return list();},
    start:async request=>{await ready;if(closed)throw new Error('下载服务已关闭');if(request?.preparedId)return startPrepared(request);if(request?.source==='browser')throw new Error('网盘任务须从应用内网盘窗口发起');const input=validateDownloadRequest(request);const existing=[...jobs.values()].find(j=>j.bookId===input.bookId && j.url===input.url && j.format===input.format && j.fileIndex===input.fileIndex && ['queued','downloading','completed'].includes(j.status));if(existing)return {...existing};if(jobs.size>=100)throw new Error('请先清理部分下载记录（最多 100 项）');const job={...input,id:randomUUID(),status:'queued',received:0,createdAt:Date.now()};jobs.set(job.id,job);try{await persist();}catch(error){jobs.delete(job.id);throw error;}emit();pump();return {...job};},
    cancel:async id=>{await ready;const job=get(id);if(job.status==='queued'){try{browserItems.get(id)?.item.cancel();}catch{}browserItems.delete(id);await fs.unlink(filePath(job,true)).catch(()=>{});job.status='cancelled';job.error='已取消下载';await persist();emit();}else active.get(id)?.abort();},
    extract:async request=>{
      await ready;const job=get(request?.id);if(job.status!=='completed')throw new Error('请等待下载完成');
      if(!['ZIP','RAR','7Z'].includes(job.format))return {...job};
      if(extractions.has(job.id))throw new Error('正在解压，请稍候');
      const controller=new AbortController();extractions.set(job.id,controller);
      const task=(async()=>{const original={...job},oldPath=filePath(job);let output;
        try{const result=await archiveExtract(oldPath,{title:job.bookTitle,password:request.password,signal:controller.signal});
          checkPrefix(result.data.subarray(0,4096),result.format,'');
          const next={...job,archive:{name:job.name,format:job.format},name:filename(result.name,result.format),format:result.format,received:result.data.length,total:result.data.length,error:undefined};output=filePath(next);
          await fs.writeFile(output+'.part',result.data);if(result.format==='EPUB')await checkEpub(output+'.part',result.data.length);
          await fs.rename(output+'.part',output);Object.assign(job,next);await persist();await fs.unlink(oldPath).catch(()=>{});emit();return {...job};
        }catch(e){Object.assign(job,original);job.error='解压失败：'+e.message;if(output){await fs.unlink(output+'.part').catch(()=>{});await fs.unlink(output).catch(()=>{});}await persist();emit();throw e;}
        finally{extractions.delete(job.id);}
      })();tasks.add(task);try{return await task;}finally{tasks.delete(task);}
    },
    acknowledge:async id=>{await ready;const job=get(id);if(job.status!=='completed')throw new Error('请等待下载完成');job.autoLoad=false;await persist();emit();},
    retry:async id=>{await ready;const job=get(id);if(!['failed','cancelled'].includes(job.status))return;if(job.source==='browser')throw new Error('请重新打开网盘，点击文件下载以获取新链接');job.status='queued';job.received=0;job.total=undefined;job.error=undefined;await persist();emit();pump();},
    read:async id=>{await ready;const job=get(id);if(job.status!=='completed')throw new Error('请等待下载完成');const stat=await fs.stat(filePath(job));if(!stat.isFile()||stat.size>limit)throw new Error('下载文件无效');return {name:job.name,data:new Uint8Array(await fs.readFile(filePath(job)))};},
    save:async(id,pick)=>{await ready;const job=get(id);if(job.status!=='completed')throw new Error('请等待下载完成');const destination=await pick(job.name,job.format);if(!destination)return false;await fs.copyFile(filePath(job),destination);return true;},
    remove:async id=>{await ready;const job=get(id);if(extractions.has(id))throw new Error('正在解压，请稍候');if(['queued','downloading'].includes(job.status)||active.has(id))throw new Error('请先取消下载');await fs.unlink(filePath(job)).catch(error=>{if(error.code!=='ENOENT')throw error;});if(job.archive)await fs.unlink(filePath({...job,format:job.archive.format})).catch(error=>{if(error.code!=='ENOENT')throw error;});jobs.delete(id);await persist();emit();},
    close:()=>closing||(closing=(async()=>{closed=true;await ready;for(const entry of prepared.values()){clearTimeout(entry.timer);try{entry.item.cancel();}catch{}await fs.unlink(filePath(entry.job,true)).catch(()=>{});}prepared.clear();for(const entry of browserItems.values()){try{entry.item.cancel();}catch{}}for(const controller of active.values())controller.abort();for(const controller of extractions.values())controller.abort();await Promise.allSettled([...tasks]);for(const job of jobs.values())if(job.status==='queued'){try{browserItems.get(job.id)?.item.cancel();}catch{}browserItems.delete(job.id);await fs.unlink(filePath(job,true)).catch(()=>{});job.status='cancelled';job.error='上次下载未完成，可点击重试';}await persist();})()),
  };
}
module.exports={createDownloadManager,validateDownloadRequest,checkPrefix,checkEpub,filename};
