// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
// @ts-expect-error fixtures shared with desktop tests
import {readingArchives,novel} from './reading-fixtures.mjs';
const {extractArchive,entriesFromList,chooseEntry}=createRequire(import.meta.url)('../electron/archive.cjs');
const {createDownloadManager}=createRequire(import.meta.url)('../electron/downloads.cjs');
let directory:string,archives:Record<string,Buffer>;
beforeAll(async()=>{directory=await fs.mkdtemp(path.join(os.tmpdir(),'qidu-extract-'));archives=await readingArchives(directory);});
afterAll(()=>fs.rm(directory,{recursive:true,force:true}));
describe('automatic archive extraction',()=>{
 for(const format of ['ZIP','RAR','7Z','nested'])it('extracts real '+format+' content without extracting unrelated files',async()=>{const file=path.join(directory,'fixture-'+format+'.zip');await fs.writeFile(file,archives[format]);const result=await extractArchive(file);expect(result.name).toBe('book.txt');expect(result.data.toString()).toBe(novel);expect(result.format).toBe('TXT');expect((await fs.readdir(directory)).some(n=>n.startsWith('extract-'))).toBe(false);});
 it('requires the archive password and permits a correct retry',async()=>{const file=path.join(directory,'locked.zip');await expect(extractArchive(file)).rejects.toThrow('密码');expect((await extractArchive(file,{password:'secret'})).data.toString()).toBe(novel);});
 it('rejects traversal, links, duplicate entries and expanded size overflow',()=>{for(const listing of ['Path = ../outside.txt\nSize = 9','Path = safe.txt\nSize = 9\nSymbolic Link = outside','Path = a.txt\nSize = 1\n\nPath = a.txt\nSize = 1','Path = book.txt\nSize = 999999999'])expect(()=>entriesFromList(listing)).toThrow();});
 it('prefers the requested work over other books and documentation',()=>{expect(chooseEntry([{name:'README.txt',format:'TXT',size:99},{name:'other.epub',format:'EPUB',size:999},{name:'目标小说.txt',format:'TXT',size:50}],'目标小说').name).toBe('目标小说.txt');});
 it('atomically replaces the archive with its readable file, persists and removes the extracted cache',async()=>{const cache=path.join(directory,'cache');const m=createDownloadManager({directory:cache,fetch:async()=>new Response(new Uint8Array(archives.ZIP))});await m.ready;const original=await m.start({url:'https://example.org/book.zip',name:'book.zip',format:'ZIP',bookTitle:'目标作品',bookAuthor:'作者',bookId:'work-test',autoLoad:true});await expect.poll(async()=>(await m.list())[0].status).toBe('completed');const job=await m.extract({id:original.id});expect(job).toMatchObject({id:original.id,bookId:'work-test',format:'TXT',archive:{format:'ZIP'}});expect(Buffer.from((await m.read(job.id)).data).toString()).toBe(novel);expect(await fs.access(path.join(cache,job.id+'.zip')).then(()=>true).catch(()=>false)).toBe(false);await m.close();const restored=createDownloadManager({directory:cache});expect((await restored.list())[0].archive.format).toBe('ZIP');await restored.remove(job.id);expect((await fs.readdir(cache)).filter(n=>n.endsWith('.txt'))).toEqual([]);await restored.close();});
 it('preserves the original download when extraction fails',async()=>{const cache=path.join(directory,'locked-cache');const m=createDownloadManager({directory:cache,fetch:async()=>new Response(new Uint8Array(archives.locked))});const job=await m.start({url:'https://example.org/locked.zip',name:'locked.zip',format:'ZIP',bookTitle:'加密作品',bookAuthor:''});await expect.poll(async()=>(await m.list())[0].status).toBe('completed');await expect(m.extract({id:job.id})).rejects.toThrow('密码');expect((await m.list())[0].format).toBe('ZIP');expect(Buffer.from((await m.read(job.id)).data)).toEqual(archives.locked);await m.close();});
});
