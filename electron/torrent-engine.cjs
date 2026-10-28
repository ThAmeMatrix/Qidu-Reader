const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {randomBytes,randomUUID} = require('node:crypto');
const {setTimeout:delay} = require('node:timers/promises');
const {formatFromName}=require('./download-formats.cjs');
const {validateUrl} = require('./web.cjs');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const LIMIT=100*1024*1024, META_LIMIT=5*1024*1024;
function magnet(value){
  if(typeof value!=='string'||value.length>16384)throw new Error('磁链过长或无效');
  let url;try{url=new URL(value);}catch{throw new Error('磁链格式无效');}
  const xt=url.searchParams.getAll('xt').find(v=>/^urn:btih:/i.test(v));
  if(url.protocol!=='magnet:'||!xt)throw new Error('目前支持带有 btih 信息的 BitTorrent v1 / 混合磁链');
  let hash=xt.slice(9).toLowerCase();
  if(/^[a-z2-7]{32}$/i.test(hash)){let bits=0,n=0;const bytes=[];for(const c of hash.toUpperCase()){n=(n<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((n>>>bits)&255);}}hash=Buffer.from(bytes).toString('hex');}
  if(!/^[a-f0-9]{40}$/.test(hash))throw new Error('磁链的文件指纹无效');
  const clean=new URL('magnet:?xt=urn:btih:'+hash);
  for(const key of ['dn','tr','xs','ws'])for(const v of url.searchParams.getAll(key).slice(0,20)){
    if(key==='dn'){clean.searchParams.set(key,v.slice(0,200));continue;}
    try{const u=new URL(v);if((key==='tr'?['http:','https:','udp:','ws:','wss:']:['http:','https:']).includes(u.protocol)&&!u.username&&!u.password&&v.length<=2048)clean.searchParams.append(key,v);}catch{}
  }
  return {url:clean.href,hash,exactSources:clean.searchParams.getAll('xs')};
}
function inside(root,value){const r=path.resolve(root),p=path.resolve(value);if(!p.startsWith(r+path.sep))throw new Error('种子中的文件路径不安全');return p;}
function safeFiles(items,root){
  if(!Array.isArray(items)||!items.length||items.length>2000)throw new Error('种子中的文件列表无效或过大');
  return items.map(f=>{
    const p=inside(root,f.path),relative=path.relative(root,p);
    if(relative.length>600 || relative.split(/[\\/]/).some(v=>!v || /[<>:"|?*\x00-\x1f]/.test(v) || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(v) || /[. ]$/.test(v)))throw new Error('种子包含无法安全保存的文件名');
    const index=Number(f.index),size=Number(f.length);if(!Number.isSafeInteger(index)||index<1||!Number.isSafeInteger(size)||size<0)throw new Error('种子中的文件信息无效');
    const format=formatFromName(relative);
    return {index,name:relative.replaceAll('\\','/'),size,format,available:!!format&&size>0&&size<=LIMIT};
  });
}
function createTorrentEngine({binary,directory,fetch:sourceFetch=fetch,metadataTimeout=90000,stallTimeout=90000,localOnly=false}){
  let ready,child,endpoint,secret,closed=false;const requests=new Map(),activeHashes=new Set(),cache=new Map(),inspecting=new Set();
  async function rpc(method,params=[]){
    const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'aria2.'+method,params:['token:'+secret,...params]}),signal:AbortSignal.timeout(6000)});
    if(!r.ok)throw new Error('磁链下载引擎无法连接');const text=await r.text();if(text.length>4*1024*1024)throw new Error('下载引擎响应过大');const body=JSON.parse(text);if(body.error)throw new Error(String(body.error.message||'磁链任务失败'));return body.result;
  }
  async function start(){
    if(closed)throw new Error('磁链服务已关闭');if(ready)return ready;
    ready=(async()=>{
      await fs.access(binary).catch(()=>{throw new Error('缺少磁链下载引擎，请使用完整桌面发行版');});await fs.mkdir(directory,{recursive:true});
      for(const id of await fs.readdir(path.join(directory,'metadata')).catch(()=>[])){
        if(!UUID.test(id))continue;try{const file=path.join(directory,'metadata',id,'info.json');if((await fs.stat(file)).size>1024*1024)continue;const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.id!==id||!Array.isArray(value.files)||!value.files.length||value.files.length>2000||!/[a-f0-9]{40}/i.test(value.infoHash))continue;await fs.access(path.join(directory,'metadata',id,'source.torrent'));let changed=false;value.files=value.files.map(f=>{const format=formatFromName(f.name),available=!!format&&Number.isSafeInteger(f.size)&&f.size>0&&f.size<=LIMIT;if(format!==f.format||available!==f.available)changed=true;return {...f,format,available};});if(changed)await fs.writeFile(file,JSON.stringify(value));cache.set(/^magnet:/i.test(value.url)?magnet(value.url).hash:validateUrl(value.url).href,value);}catch{}
      }
      const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
      secret=randomBytes(32).toString('hex');endpoint=`http://127.0.0.1:${port}/jsonrpc`;
      const args=['--no-conf=true','--enable-rpc=true','--rpc-listen-all=false','--rpc-allow-origin-all=false','--rpc-listen-port='+port,'--rpc-secret='+secret,'--stop-with-process='+process.pid,'--dir='+directory,'--dht-file-path='+path.join(directory,'dht.dat'),'--dht-file-path6='+path.join(directory,'dht6.dat'),'--enable-dht='+!localOnly,'--enable-dht6=false','--bt-enable-lpd=false','--enable-peer-exchange='+!localOnly,'--seed-time=0','--max-upload-limit=16K','--file-allocation=none','--max-concurrent-downloads=4','--summary-interval=0','--console-log-level=error','--download-result=hide','--auto-file-renaming=false','--allow-overwrite=false'];
      child=spawn(binary,args,{windowsHide:true,stdio:['ignore','ignore','ignore']});let failed;child.on('error',e=>{failed=e;});child.on('exit',()=>{if(!closed)ready=undefined;});
      for(let attempt=0;attempt<60;attempt++){if(failed)throw new Error('无法启动磁链引擎：'+failed.message);try{await rpc('getVersion');return;}catch{}await delay(100);}
      child.kill();throw new Error('磁链下载引擎启动超时');
    })();try{return await ready;}catch(e){ready=undefined;throw e;}
  }
  const forget=async gid=>{if(gid){await rpc('forceRemove',[gid]).catch(()=>{});await rpc('removeDownloadResult',[gid]).catch(()=>{});}};
  const cleanup=async dir=>{inside(directory,dir);await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});};
  async function metadata(url,signal){
    let target=validateUrl(url);
    for(let hop=0;hop<=5;hop++){
      const r=await sourceFetch(target.href,{method:'GET',redirect:'manual',signal,headers:{Accept:'application/x-bittorrent,application/octet-stream'}});
      if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next||hop===5)throw new Error('种子地址重定向过多');target=validateUrl(new URL(next,target).href);continue;}
      if(r.status!==200){await r.body?.cancel();throw new Error(`种子无法读取（HTTP ${r.status}）`);}
      if(/html|json/.test(r.headers.get('content-type')||'')){await r.body?.cancel();throw new Error('返回的是网页，请选择实际的 .torrent 文件链接');}
      if(Number(r.headers.get('content-length'))>META_LIMIT){await r.body?.cancel();throw new Error('种子文件超过 5 MB');}
      const chunks=[];let length=0;for await(const chunk of r.body){length+=chunk.length;if(length>META_LIMIT)throw new Error('种子文件超过 5 MB');chunks.push(chunk);}const bytes=Buffer.concat(chunks);if(!bytes.length||bytes[0]!==100)throw new Error('没有返回有效的种子文件');return bytes;
    }
  }
  async function inspect(value,requestId){
    if(!UUID.test(requestId)||requests.has(requestId))throw new Error('解析请求编号无效');
    const isMagnet=/^magnet:/i.test(value),parsed=isMagnet?magnet(value):undefined,url=parsed?.url||validateUrl(value).href;
    const controller=new AbortController(),signal=controller.signal;requests.set(requestId,controller);const timeout=setTimeout(()=>controller.abort(),metadataTimeout);
    let gid,probe,ok=false,locked=false;const key=parsed?.hash||url;const id=randomUUID(),folder=path.join(directory,'metadata',id);
    try{
      await start();while(inspecting.has(key))await delay(100,undefined,{signal});if(signal.aborted)throw new Error('已取消解析');if(cache.has(key)){ok=true;return cache.get(key);}inspecting.add(key);locked=true;await fs.mkdir(folder,{recursive:true});let bytes;
      if(parsed){
        for(const source of parsed.exactSources){try{bytes=await metadata(source,signal);break;}catch{if(signal.aborted)throw new Error('已取消解析');}}
        if(!bytes){
          gid=await rpc('addUri',[[url],{dir:folder,'bt-metadata-only':'true','bt-save-metadata':'true','bt-stop-timeout':String(Math.ceil(metadataTimeout/1000)),'follow-torrent':'false'}]);
          while(!signal.aborted){const state=await rpc('tellStatus',[gid,['status','errorMessage']]);if(state.status==='error')throw new Error(state.errorMessage||'没有找到可用的资源节点');if(state.status==='complete')break;await delay(400,undefined,{signal});}
          if(signal.aborted)throw new Error('磁链解析已取消或超时；暂无可用节点时可稍后重试');
          const file=path.join(folder,parsed.hash+'.torrent'),stat=await fs.stat(file);if(stat.size>META_LIMIT)throw new Error('种子元数据过大');bytes=await fs.readFile(file);
        }
      }else bytes=await metadata(url,signal);
      await forget(gid);gid=undefined;
      const probeDir=path.join(folder,'probe');await fs.mkdir(probeDir,{recursive:true});
      probe=await rpc('addTorrent',[bytes.toString('base64'),[],{dir:probeDir,pause:'true','seed-time':'0'}]);
      const state=await rpc('tellStatus',[probe,['infoHash','files','bittorrent','pieceLength']]);if(parsed && state.infoHash?.toLowerCase()!==parsed.hash)throw new Error('种子文件与磁链指纹不一致');
      if(Number(state.pieceLength)>16*1024*1024)throw new Error('种子分片过大，请选择其他资源');
      const files=safeFiles(state.files,probeDir);if(signal.aborted)throw new Error('已取消解析');
      const result={id,url,infoHash:state.infoHash,name:String(state.bittorrent?.info?.name||files[0].name).slice(0,300),files};
      await fs.writeFile(path.join(folder,'source.torrent'),bytes);await fs.writeFile(path.join(folder,'info.json'),JSON.stringify(result));ok=true;cache.set(key,result);return result;
    }catch(e){if(signal.aborted)throw new Error('已取消解析或等待节点超时，请稍后重试');throw e;}
    finally{clearTimeout(timeout);requests.delete(requestId);if(locked)inspecting.delete(key);await forget(gid);await forget(probe);if(!ok)await cleanup(folder).catch(()=>{});}
  }
  async function transfer(job,destination,{signal,onProgress}){
    if(!UUID.test(job.resourceId)||!Number.isSafeInteger(job.fileIndex)||job.fileIndex<1)throw new Error('请重新解析磁链并选择文件');
    const folder=path.join(directory,'metadata',job.resourceId);const info=JSON.parse(await fs.readFile(path.join(folder,'info.json'),'utf8'));
    const file=info.files.find(f=>f.index===job.fileIndex);if(!file?.available||file.format!==job.format||info.url!==job.url)throw new Error('选择的文件信息无效，请重新解析');
    const torrentPath=path.join(folder,'source.torrent');if((await fs.stat(torrentPath)).size>META_LIMIT)throw new Error('种子元数据过大');const bytes=await fs.readFile(torrentPath);
    while(activeHashes.has(info.infoHash))await delay(300,undefined,{signal});
    const dest=path.join(directory,'transfers',job.id);inside(directory,dest);let gid;activeHashes.add(info.infoHash);
    try{
      await fs.mkdir(dest,{recursive:true});
      await start();if(signal.aborted)throw new Error('已取消下载');
      gid=await rpc('addTorrent',[bytes.toString('base64'),[],{dir:dest,pause:'true','select-file':String(job.fileIndex),'seed-time':'0','file-allocation':'none','bt-stop-timeout':String(Math.ceil(stallTimeout/1000))}]);
      const files=safeFiles(await rpc('getFiles',[gid]),dest),chosen=files.find(f=>f.index===job.fileIndex);if(chosen?.name!==file.name||chosen.size!==file.size)throw new Error('种子文件列表发生变化');
      await rpc('unpause',[gid]);let changed=Date.now(),previous=-1;
      while(!signal.aborted){
        const state=await rpc('tellStatus',[gid,['status','files','downloadSpeed','numSeeders','connections','errorMessage']]);const selected=state.files?.find(f=>Number(f.index)===job.fileIndex),received=Number(selected?.completedLength)||0;
        if(received!==previous){previous=received;changed=Date.now();}onProgress({received,total:file.size,peers:Number(state.connections)||0,speed:Number(state.downloadSpeed)||0});
        if(state.status==='error')throw new Error(state.errorMessage||'磁链下载失败，可能没有可用节点');if(state.status==='removed')throw new Error('任务已移除');
        if(state.status==='complete'){
          const source=inside(dest,selected.path),stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.size||stat.size>LIMIT)throw new Error('下载文件不完整');await fs.copyFile(source,destination);return;
        }
        if(Date.now()-changed>stallTimeout)throw new Error('长时间没有可用节点或传输进展，请稍后重试');await delay(400,undefined,{signal});
      }
      throw new Error('已取消下载');
    }finally{await forget(gid);activeHashes.delete(info.infoHash);await cleanup(dest).catch(()=>{});}
  }
  return {inspect,transfer,cancel:id=>requests.get(id)?.abort(),close:async()=>{closed=true;for(const c of requests.values())c.abort();if(child){await rpc('forceShutdown').catch(()=>{});child.kill();}},magnet};
}
module.exports={createTorrentEngine,magnet,safeFiles,inside};
