// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const {createDownloadManager}=createRequire(import.meta.url)('../electron/downloads.cjs');
const roots:string[]=[],managers:ReturnType<typeof createDownloadManager>[]=[];
const data=Buffer.from('第一章\n真实文件内容。\n'.repeat(100));
class Download extends EventEmitter{
 paused=false;resumed=false;cancelled=false;savePath='';
 getFilename(){return 'book.txt';}getMimeType(){return 'text/plain';}getURL(){return 'https://cloud.example/ticket';}getTotalBytes(){return data.length;}getReceivedBytes(){return data.length;}
 pause(){this.paused=true;}setSavePath(value:string){this.savePath=value;}
 resume(){this.resumed=true;void fs.writeFile(this.savePath,data).then(()=>this.emit('done',{},'completed'));}
 cancel(){this.cancelled=true;this.emit('done',{},'cancelled');}
}
async function manager(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'qidu-prepared-'));roots.push(directory);const m=createDownloadManager({directory});managers.push(m);await m.ready;return {m,directory};}
afterEach(async()=>{for(const m of managers.splice(0))await m.close();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const context={url:'https://pan.baidu.com/s/book?pwd=8888',password:'8888',bookTitle:'分享作品',bookAuthor:'作者',bookId:'work-id'};
describe('prepared browser transfers',()=>{
 it('pauses the native item without creating a job until explicitly loaded, retaining POST session context',async()=>{const {m,directory}=await manager(),item=new Download();const request=await m.prepareBrowser(item,context);expect(item.paused).toBe(true);expect(item.resumed).toBe(false);expect(await m.list()).toEqual([]);expect((await fs.readdir(directory)).filter(n=>n.endsWith('.txt'))).toEqual([]);const job=await m.start({...request,autoLoad:true});await expect.poll(async()=>(await m.list())[0]?.status).toBe('completed');expect((await m.read(job.id)).data).toEqual(new Uint8Array(data));expect((await m.list())[0]).toMatchObject({bookId:'work-id',autoLoad:true,cloudPassword:'8888',source:'browser'});await m.acknowledge(job.id);expect((await m.list())[0].autoLoad).toBe(false);await expect(m.start(request)).rejects.toThrow('过期');await m.remove(job.id);expect((await fs.readdir(directory)).filter(n=>n.endsWith('.txt'))).toEqual([]);});
 it('cleans unaccepted partial files when closing and rejects obsolete handles',async()=>{const {m,directory}=await manager(),item=new Download();const request=await m.prepareBrowser(item,context);await fs.writeFile(item.savePath,'incomplete');await m.close();expect(item.cancelled).toBe(true);expect((await fs.readdir(directory)).filter(n=>n.endsWith('.part'))).toEqual([]);expect(await m.list()).toEqual([]);await expect(m.start(request)).rejects.toThrow('关闭');});
 it('handles a tiny download completing before resume without hanging or duplicating its file',async()=>{const {m}=await manager(),item=new Download();const request=await m.prepareBrowser(item,context);await fs.writeFile(item.savePath,data);item.emit('done',{},'completed');const job=await m.start({...request,autoLoad:true});await expect.poll(async()=>(await m.list())[0]?.status).toBe('completed');expect(item.resumed).toBe(false);expect((await m.read(job.id)).data.length).toBe(data.length);});
});
