// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
// @ts-expect-error shared generated archive fixtures
import {archiveFixtures} from './archive-fixtures.mjs';
import type { DownloadJob, DownloadRequest } from '../src/types';
const {createDownloadManager,filename}=createRequire(import.meta.url)('../electron/downloads.cjs');
let server:http.Server,base:string,epub:Buffer,root:string;const managers:ReturnType<typeof createDownloadManager>[]=[];
let archives:Record<string,Buffer>;
const txt=Buffer.from('第一章 归来\n这是一份可以完整下载并导入书架的测试文字。\n'.repeat(200));
beforeAll(async()=>{
  archives=await archiveFixtures();
  root=await fs.mkdtemp(path.join(os.tmpdir(),'qidu-download-tests-'));const zip=new JSZip();zip.file('mimetype','application/epub+zip',{compression:'STORE'});zip.file('META-INF/container.xml','<container/>');epub=await zip.generateAsync({type:'nodebuffer'});
  server=http.createServer((req,res)=>{
    const route=(req.url||'').split('?')[0];
    if(route.startsWith('/archives/')){const format=route.split('.').pop()!.toUpperCase(),data=archives[format];res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':data.length});res.end(data);return;}
    if(/^\/fake\.(zip|rar|7z)$/.test(route)){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('<html>请登录后下载压缩包</html>');return;}
    if(route==='/redirect'){res.writeHead(302,{Location:'/book.txt'});res.end();return;}
    if(route==='/unsafe'){res.writeHead(302,{Location:'file:///C:/secret'});res.end();return;}
    if(route==='/blocked'){res.writeHead(403);res.end('denied');return;}
    if(route==='/html.txt'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('<html><h1>登录</h1></html>');return;}
    if(route==='/fake.pdf'){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('<html>%PDF-1.7</html>');return;}
    if(route==='/fake.epub'){res.writeHead(200,{'Content-Type':'application/epub+zip'});res.end(Buffer.from('PK\x03\x04not an epub'));return;}
    if(route==='/oversize'){res.writeHead(200,{'Content-Length':100*1024*1024+1});res.end();return;}
    if(route==='/chunked'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('x'.repeat(2048));return;}
    if(route==='/truncated'){res.writeHead(200,{'Content-Type':'text/plain','Content-Length':9000});res.write('不完整');setTimeout(()=>res.destroy(),10);return;}
    if(route==='/stall'){res.writeHead(200,{'Content-Type':'text/plain'});res.write('开始下载');return;}
    if(route==='/slow.txt'){
      res.writeHead(200,{'Content-Type':'text/plain','Content-Length':txt.length});let offset=0;
      const timer=setInterval(()=>{if(offset>=txt.length){clearInterval(timer);res.end();return;}res.write(txt.subarray(offset,offset+200));offset+=200;},15);res.on('close',()=>clearInterval(timer));return;
    }
    const data=route==='/book.epub'?epub:route==='/book.pdf'?Buffer.from('%PDF-1.7\nfixture\n%%EOF'):txt;
    res.writeHead(200,{'Content-Type':route.endsWith('.epub')?'application/epub+zip':route.endsWith('.pdf')?'application/pdf':'text/plain','Content-Length':data.length,...(route==='/book.txt'?{'Content-Disposition':"attachment; filename*=UTF-8''%E4%B8%8B%E8%BD%BD%E6%B5%8B%E8%AF%95.txt"}:{})});res.end(data);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
afterEach(async()=>{await Promise.all(managers.splice(0).map(m=>m.close()));server.closeAllConnections();});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(root,{recursive:true,force:true});});
function manager(extra:Record<string,unknown>={}){const m=createDownloadManager({directory:path.join(root,crypto.randomUUID()),...extra});managers.push(m);return m;}
const request=(url:string,format:DownloadRequest['format']='TXT'):DownloadRequest=>({url:base+url,format,name:'书籍.'+format.toLowerCase(),bookTitle:'下载测试',bookAuthor:'测试作者'});
async function finished(m:ReturnType<typeof manager>,id:string){let job:DownloadJob;await expect.poll(async()=>{job=(await m.list()).find((j:DownloadJob)=>j.id===id);return ['completed','failed','cancelled'].includes(job.status);},{timeout:8000,interval:20}).toBe(true);return job!;}

describe('native book download manager',()=>{
  it('keeps independent files for different works sharing the same download URL',async()=>{const m=manager();const a=await m.start({...request('/book.txt'),bookId:'work-a'}),b=await m.start({...request('/book.txt'),bookId:'work-b'});expect(a.id).not.toBe(b.id);expect((await finished(m,a.id)).status).toBe('completed');expect((await finished(m,b.id)).status).toBe('completed');await m.remove(a.id);expect(Buffer.from((await m.read(b.id)).data)).toEqual(txt);});

  it('streams and verifies TXT, PDF and EPUB, saves progress, and deduplicates a completed URL',async()=>{
    const snapshots:DownloadJob[][]=[];const m=manager({onChange:(jobs:DownloadJob[])=>snapshots.push(jobs)});
    for(const format of ['TXT','PDF','EPUB'] as const){const job=await m.start(request('/book.'+format.toLowerCase(),format));const completed=await finished(m,job.id);expect(completed.status).toBe('completed');expect(completed.received).toBe(completed.total);const file=await m.read(job.id);expect(file.data.length).toBe(completed.received);}
    const jobs=await m.list();expect(jobs).toHaveLength(3);const again=await m.start(request('/book.txt'));expect(again.id).toBe(jobs.find((j:DownloadJob)=>j.format==='TXT').id);expect(again.name).toBe('下载测试.txt');expect(snapshots.some(all=>all.some(j=>j.status==='downloading'))).toBe(true);
  });
  it('validates every redirect and rejects access pages, fake files and incomplete transfers',async()=>{
    const m=manager();const redirected=await m.start(request('/redirect'));expect((await finished(m,redirected.id)).status).toBe('completed');
    for(const [url,format] of [['/unsafe','TXT'],['/blocked','TXT'],['/html.txt','TXT'],['/fake.pdf','PDF'],['/fake.epub','EPUB'],['/oversize','TXT'],['/truncated','TXT']] as const){const job=await m.start(request(url,format));const result=await finished(m,job.id);expect(result.status,url).toBe('failed');await expect(m.read(job.id)).rejects.toThrow('等待');}
    await expect(m.start({...request('/book.txt'),url:'javascript:alert(1)'})).rejects.toThrow('http');await expect(m.read('../../escape')).rejects.toThrow('不存在');
  });
  it('enforces the streamed size limit without trusting Content-Length',async()=>{
    const directory=path.join(root,crypto.randomUUID()),m=manager({directory,limit:1024});const job=await m.start(request('/chunked'));expect((await finished(m,job.id)).status).toBe('failed');expect((await fs.readdir(directory)).filter(f=>f.endsWith('.part')||f.endsWith('.txt'))).toEqual([]);
  });
  it('cancels active and queued jobs, cleans partials, then permits a full retry',async()=>{
    const directory=path.join(root,crypto.randomUUID()),m=manager({directory});const a=await m.start(request('/slow.txt?a')),b=await m.start(request('/slow.txt?b')),c=await m.start(request('/book.txt?queued'));
    expect((await m.list()).find((j:DownloadJob)=>j.id===c.id).status).toBe('queued');await m.cancel(c.id);await m.cancel(a.id);await m.cancel(b.id);
    expect((await finished(m,a.id)).status).toBe('cancelled');expect((await finished(m,b.id)).status).toBe('cancelled');expect((await finished(m,c.id)).status).toBe('cancelled');
    expect((await fs.readdir(directory)).filter(f=>f.endsWith('.part'))).toEqual([]);await m.retry(c.id);expect((await finished(m,c.id)).status).toBe('completed');
  });
  it('times out a stalled stream and removes its partial file',async()=>{
    const m=manager({idleTimeout:50,timeout:2000});const job=await m.start(request('/stall'));const result=await finished(m,job.id);expect(result.status).toBe('failed');expect(result.error).toContain('超时');
  });
  it('persists completed files, exports only after destination selection, and cleans only its own cache',async()=>{
    const directory=path.join(root,crypto.randomUUID()),m=manager({directory});const job=await m.start(request('/book.txt'));await finished(m,job.id);await m.close();const restored=manager({directory});expect((await restored.list())[0].status).toBe('completed');expect(Buffer.from((await restored.read(job.id)).data)).toEqual(txt);
    const output=path.join(root,'saved.txt');expect(await restored.save(job.id,()=>undefined)).toBe(false);expect(await restored.save(job.id,()=>output)).toBe(true);expect(await fs.readFile(output)).toEqual(txt);await restored.remove(job.id);expect(await restored.list()).toEqual([]);expect(await fs.readFile(output)).toEqual(txt);await m.close();expect(JSON.parse(await fs.readFile(path.join(directory,'downloads.json'),'utf8'))).toEqual([]);
  });
  it('recovers interrupted jobs and ignores path-injection records',async()=>{
    const directory=path.join(root,crypto.randomUUID());await fs.mkdir(directory);const id=crypto.randomUUID();await fs.writeFile(path.join(directory,'downloads.json'),JSON.stringify([{...request('/book.txt'),id,status:'downloading',createdAt:1},{...request('/book.txt'),id:'../../outside',status:'completed'}]));await fs.writeFile(path.join(directory,`${id}.txt.part`),'partial');
    const m=manager({directory});const jobs=await m.list();expect(jobs).toHaveLength(1);expect(jobs[0].status).toBe('cancelled');expect((await fs.readdir(directory)).some(f=>f.endsWith('.part'))).toBe(false);
    expect(filename('../../CON.exe','TXT')).not.toMatch(/[\\/]/);expect(filename('CON','PDF')).toBe('_CON.pdf');
  });
  it('downloads and saves ZIP, RAR and 7Z while rejecting HTML disguised as archives',async()=>{
    const m=manager();for(const format of ['ZIP','RAR','7Z'] as const){
      const job=await m.start(request('/archives/book.'+format.toLowerCase(),format));expect((await finished(m,job.id)).status).toBe('completed');expect(Buffer.from((await m.read(job.id)).data)).toEqual(archives[format]);
      const output=path.join(root,'saved.'+format.toLowerCase());await m.save(job.id,()=>output);expect(await fs.readFile(output)).toEqual(archives[format]);
      const fake=await m.start(request('/fake.'+format.toLowerCase(),format));expect((await finished(m,fake.id)).status).toBe('failed');
    }
  });
  it('closes a queue with pending jobs and removes partial transfers',async()=>{
    const directory=path.join(root,crypto.randomUUID()),m=manager({directory});
    const first=await m.start(request('/slow.txt?close1')),second=await m.start(request('/slow.txt?close2')),third=await m.start(request('/archives/book.zip','ZIP'));
    await m.close();const jobs=await m.list();for(const id of [first.id,second.id,third.id])expect(jobs.find((j:DownloadJob)=>j.id===id).status).toBe('cancelled');
    expect((await fs.readdir(directory)).filter(name=>name.endsWith('.part'))).toEqual([]);
  });

});
