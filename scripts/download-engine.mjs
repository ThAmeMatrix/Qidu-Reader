import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../vendor/aria2');
const version='1.37.0',base='https://github.com/aria2/aria2/releases/download/release-1.37.0/';
const records=[
 {name:'aria2-1.37.0-win-64bit-build1.zip',sha256:'67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288',bytes:2475379},
 {name:'aria2-1.37.0.tar.xz',sha256:'60a420ad7085eb616cb6e2bdf0a7206d68ff3d37fb5a956dc44242eb2f79b66b',bytes:1705256},
].map(record=>({...record,url:base+record.name}));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function download(record){
 const response=await fetch(record.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`aria2 download HTTP ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==record.bytes || digest(bytes)!==record.sha256)throw new Error('aria2 release checksum does not match the pinned build');return bytes;
}
export async function ensureDownloadEngine(){
 await mkdir(directory,{recursive:true});
 let binaryReady=false;
 try{binaryReady=digest(await readFile(path.join(directory,'aria2c.exe')))==='be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2';for(const name of ['COPYING','AUTHORS','README.html'])await readFile(path.join(directory,name));}catch{binaryReady=false;}
 if(!binaryReady){const zip=await JSZip.loadAsync(await download(records[0]));for(const name of ['aria2c.exe','COPYING','AUTHORS','README.html']){const file=Object.values(zip.files).find(file=>file.name.endsWith('/'+name));if(!file)throw new Error('Missing aria2 release file: '+name);await writeFile(path.join(directory,name),await file.async('nodebuffer'));}}
 let sourceReady=false;try{sourceReady=digest(await readFile(path.join(directory,records[1].name)))===records[1].sha256;}catch{}
 if(!sourceReady)await writeFile(path.join(directory,records[1].name),await download(records[1]));
 await writeFile(path.join(directory,'provenance.json'),JSON.stringify({version,records},null,2));
 return directory;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('aria2 assets ready:',await ensureDownloadEngine());
