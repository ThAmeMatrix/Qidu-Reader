const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const LIMIT=100*1024*1024;
const binary=path.join(__dirname,'../vendor/sevenzip/7z.exe');
function run(executable,args,limit,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new Error('解压已取消'));return;}
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let size=0,error='',failure;const chunks=[];
  const stop=message=>{failure=new Error(message);child.kill();};
  const abort=()=>stop('解压已取消'),timer=setTimeout(()=>stop('解压超时，请选择较小的压缩包'),60000);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',data=>{size+=data.length;if(size>limit)stop('解压内容超过大小限制');else chunks.push(data);});
  child.stderr.on('data',data=>{error=(error+data.toString()).slice(-4000);});
  child.on('error',e=>{failure=new Error(e.code==='ENOENT'?'解压组件缺失，请重新下载完整桌面版':e.message);});
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure)reject(failure);else if(code!==0)reject(new Error(/password|encrypted|data error/i.test(error)?'压缩包需要正确的解压密码，或文件已损坏':'压缩包无法读取，可能不完整或已损坏'));else resolve(Buffer.concat(chunks));});
 });
}
function entriesFromList(text){
 const records=text.split(/\r?\n\s*\r?\n/).map(block=>Object.fromEntries(block.split(/\r?\n/).flatMap(line=>{const i=line.indexOf(' = ');return i<0?[]:[[line.slice(0,i),line.slice(i+3)]];}))).filter(r=>r.Path);
 if(records.length>2000)throw new Error('压缩包文件过多（上限 2000 个）');
 const seen=new Set();let total=0;
 return records.flatMap(r=>{
  const name=r.Path.replaceAll('\\','/');
  if(name.startsWith('/')||/[:\x00-\x1f]/.test(name)||name.split('/').includes('..')||r['Symbolic Link']||r['Hard Link']||/^l/.test(r.Mode||''))throw new Error('压缩包含不安全的路径或链接');
  if(r.Folder==='+'||/^D/.test(r.Attributes||''))return [];
  if(seen.has(name))throw new Error('压缩包含重复文件路径');seen.add(name);
  const size=Number(r.Size);if(!Number.isSafeInteger(size)||size<0)throw new Error('压缩包文件大小无效');total+=size;if(total>512*1024*1024)throw new Error('压缩包展开大小超过 512 MB');
  const format=name.match(/\.(txt|epub|pdf|zip|rar|7z)$/i)?.[1].toUpperCase();
  return format&&size>0&&size<=LIMIT&&!/(^|\/)(__MACOSX|\.)/.test(name)?[{name:r.Path,format,size}]:[];
 });
}
function chooseEntry(entries,title){
 const normalize=s=>s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');const key=normalize(title||'');
 const score=e=>{const name=normalize(path.win32.basename(e.name).replace(/\.[^.]+$/,''));return (key.length>1&&name.includes(key)?100:0)+({EPUB:30,TXT:25,PDF:20,ZIP:3,RAR:2,'7Z':1}[e.format]||0)-(/readme|说明|广告|网址|必读/i.test(e.name)?80:0);};
 return [...entries].sort((a,b)=>score(b)-score(a)||b.size-a.size||a.name.localeCompare(b.name))[0];
}
async function extractArchive(file,{title='',password='',signal,executable=binary}={}){
 if(typeof password!=='string'||password.length>200)throw new Error('解压密码过长');
 const temp=await fs.mkdtemp(path.join(path.dirname(file),'extract-'));let current=file;
 try{
  for(let depth=0;depth<4;depth++){
   const args=['-bd','-sccUTF-8','-p'+(password||'-')];
   const entries=entriesFromList((await run(executable,['l','-slt','-ba',...args,'--',current],2*1024*1024,signal)).toString('utf8'));
   const selected=chooseEntry(entries,title);if(!selected)throw new Error('压缩包中没有可阅读的 TXT、EPUB 或 PDF 文件');
   const data=await run(executable,['x','-so','-spd',...args,'--',current,selected.name],LIMIT,signal);
   if(data.length!==selected.size)throw new Error('解压文件不完整');
   if(['TXT','EPUB','PDF'].includes(selected.format))return {name:path.win32.basename(selected.name),format:selected.format,data};
   current=path.join(temp,'nested-'+depth+'.'+selected.format.toLowerCase());await fs.writeFile(current,data);
  }
  throw new Error('压缩嵌套超过四层，请选择内层书籍压缩包');
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
module.exports={extractArchive,entriesFromList,chooseEntry};
