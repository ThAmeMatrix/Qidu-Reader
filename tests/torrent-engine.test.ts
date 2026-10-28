// @vitest-environment node
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
// @ts-expect-error shared deterministic fixture module
import {torrentFixture,serveSeed,bencode} from './torrent-fixtures.mjs';
// @ts-expect-error shared generated archive fixtures
import {archiveFixtures} from './archive-fixtures.mjs';
const {createTorrentEngine,magnet,safeFiles}=createRequire(import.meta.url)('../electron/torrent-engine.cjs');
const {createDownloadManager}=createRequire(import.meta.url)('../electron/downloads.cjs');
let server:http.Server,base:string,dir:string,engine:ReturnType<typeof createTorrentEngine>,fixture:ReturnType<typeof torrentFixture>,seeder:ChildProcess|undefined;
let seedPort=0;
const files:Record<string,Buffer>={'first.txt':Buffer.from('第一章\n通过磁链传输的真实文件。\n'.repeat(400)),'second.txt':Buffer.from('第二本书。\n'.repeat(100))};
beforeAll(async()=>{
 files['books.zip']=(await archiveFixtures()).ZIP;
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'qidu-torrent-'));
 server=http.createServer((req,res)=>{
  if(req.url?.startsWith('/announce')){const peer=Buffer.from([127,0,0,1,seedPort>>8,seedPort&255]);res.end(bencode({interval:1,'min interval':1,peers:peer}));return;}
  if(req.url==='/book.torrent'){res.setHeader('Content-Type','application/x-bittorrent');res.end(fixture.bytes);return;}
  if(req.url==='/fake.torrent'){res.setHeader('Content-Type','text/html');res.end('<h1>请登录</h1>');return;}
  if(req.url==='/stall.torrent'){res.writeHead(200,{'Content-Type':'application/x-bittorrent'});res.write('d');return;}
  serveSeed(req,res,files);
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+(server.address() as net.AddressInfo).port;
 fixture=torrentFixture(base,files);engine=createTorrentEngine({binary:path.resolve('vendor/aria2/aria2c.exe'),directory:path.join(dir,'engine'),localOnly:true,metadataTimeout:15000,stallTimeout:10000});
});
afterAll(async()=>{await engine?.close();seeder?.kill();server?.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
describe('native torrent downloads',()=>{
 it('normalizes v1 magnets and rejects unsafe metadata file paths',()=>{
  expect(magnet(fixture.magnet).hash).toBe(fixture.hash);
  expect(magnet('magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').hash).toBe('0'.repeat(40));
  expect(()=>magnet('magnet:?xt=urn:btmh:invalid')).toThrow('btih');expect(()=>magnet('file:///secret')).toThrow();
  expect(()=>safeFiles([{index:'1',path:path.join(dir,'..','outside.txt'),length:'1'}],dir)).toThrow('路径');
 });
 it('resolves a magnet exact-source into a real file list and caches repeated inspections',async()=>{
  const result=await engine.inspect(fixture.magnet,randomUUID());expect(result.files.map((f:{format:string})=>f.format)).toEqual(['TXT','TXT','ZIP']);expect(result.infoHash).toBe(fixture.hash);
  expect((await engine.inspect(fixture.magnet,randomUUID())).id).toBe(result.id);
 });
 it('downloads selected files through the real engine into the normal queue and reuses metadata after restart',async()=>{
  const resource=await engine.inspect(fixture.magnet,randomUUID());const manager=createDownloadManager({directory:path.join(dir,'jobs'),torrentTransfer:(...args:unknown[])=>engine.transfer(...args)});
  try{
   const first=await manager.start({url:resource.url,name:'first.txt',format:'TXT',bookTitle:'第一本',bookAuthor:'测试',resourceId:resource.id,fileIndex:1,source:'torrent'});
   const second=await manager.start({url:resource.url,name:'second.txt',format:'TXT',bookTitle:'第二本',bookAuthor:'测试',resourceId:resource.id,fileIndex:2,source:'torrent'});
   const zipped=await manager.start({url:resource.url,name:'books.zip',format:'ZIP',bookTitle:'书籍合集',bookAuthor:'测试',resourceId:resource.id,fileIndex:3,source:'torrent'});
   expect(first.id).not.toBe(second.id);await expect.poll(async()=>(await manager.list()).every((j:{status:string})=>j.status==='completed'),{timeout:20000,interval:200}).toBe(true);
   expect(Buffer.from((await manager.read(first.id)).data)).toEqual(files['first.txt']);expect(Buffer.from((await manager.read(second.id)).data)).toEqual(files['second.txt']);
   expect(Buffer.from((await manager.read(zipped.id)).data)).toEqual(files['books.zip']);
   const metadataFile=path.join(dir,'engine','metadata',resource.id,'info.json'),oldMetadata=JSON.parse(await fs.readFile(metadataFile,'utf8'));oldMetadata.files[2].available=false;delete oldMetadata.files[2].format;await fs.writeFile(metadataFile,JSON.stringify(oldMetadata));
   await engine.close();engine=createTorrentEngine({binary:path.resolve('vendor/aria2/aria2c.exe'),directory:path.join(dir,'engine'),localOnly:true});const restored=await engine.inspect(fixture.magnet,randomUUID());expect(restored.id).toBe(resource.id);expect(restored.files[2]).toMatchObject({available:true,format:'ZIP'});expect(JSON.parse(await fs.readFile(metadataFile,'utf8')).files[2].available).toBe(true);
  }finally{await manager.close();}
 },30000);
 it('cancels a stalled metadata request and rejects HTML responses and mismatched exact sources',async()=>{
  const id=randomUUID(),pending=engine.inspect(base+'/stall.torrent',id);setTimeout(()=>engine.cancel(id),200);await expect(pending).rejects.toThrow(/取消|超时/);
  await expect(engine.inspect(base+'/fake.torrent',randomUUID())).rejects.toThrow('网页');
  await expect(engine.inspect('magnet:?xt=urn:btih:'+'1'.repeat(40)+'&xs='+encodeURIComponent(base+'/book.torrent'),randomUUID())).rejects.toThrow('不一致');
 });
 it('resolves a magnet without xs by fetching BEP9 metadata from a real local BitTorrent peer',async()=>{
  seedPort=await new Promise<number>((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
  const peerFiles={'peer.txt':Buffer.from('A local metadata peer.\n'.repeat(900))},peerFixture=torrentFixture(base,peerFiles,{name:'Peer fixture'});
  const seedDir=path.join(dir,'seed');await fs.mkdir(path.join(seedDir,'Peer fixture'),{recursive:true});await fs.writeFile(path.join(seedDir,'Peer fixture','peer.txt'),peerFiles['peer.txt']);await fs.writeFile(path.join(dir,'peer.torrent'),peerFixture.bytes);
  seeder=spawn(path.resolve('vendor/aria2/aria2c.exe'),['--no-conf=true','--enable-dht=false','--enable-dht6=false','--bt-enable-lpd=false','--listen-port='+seedPort,'--seed-time=2','--seed-ratio=10','--check-integrity=true','--file-allocation=none','--console-log-level=error','--dir='+seedDir,'--stop-with-process='+process.pid,path.join(dir,'peer.torrent')],{windowsHide:true,stdio:'ignore'});
  const uri=`magnet:?xt=urn:btih:${peerFixture.hash}&tr=${encodeURIComponent(base+'/announce')}`;
  try{const resource=await engine.inspect(uri,randomUUID());expect(resource.infoHash).toBe(peerFixture.hash);expect(resource.files[0].name).toContain('peer.txt');const destination=path.join(dir,'peer-download.txt');await engine.transfer({id:randomUUID(),resourceId:resource.id,fileIndex:1,format:'TXT',url:resource.url},destination,{signal:AbortSignal.timeout(20000),onProgress:()=>{}});expect(await fs.readFile(destination)).toEqual(peerFiles['peer.txt']);}finally{seeder.kill();seeder=undefined;}
 },30000);
});
