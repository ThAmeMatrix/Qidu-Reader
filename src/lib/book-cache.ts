import type {Book,BookPayload,DownloadJob,DownloadRequest} from '../types';
import {getPayload} from './storage';
import {importFile} from './importers';
export function cacheSource(job:DownloadJob):DownloadRequest {
 const {url,name,format,referrer,bookTitle,bookAuthor,resourceId,fileIndex,source,cloudUrl,cloudPassword,bookId,work}=job;
 return {url,name:job.archive?.name||name,format:job.archive?.format||format,referrer,bookTitle,bookAuthor,resourceId,fileIndex,source,cloudUrl,cloudPassword,bookId,work,autoLoad:true};
}
export function cachedBook(imported:Book,job:DownloadJob,existing?:Book):Book {
 const work=existing?.online||job.work;
 return {...imported,...existing,id:existing?.id||job.bookId||imported.id,format:imported.format,size:imported.size,fingerprint:imported.fingerprint,sample:false,
  title:existing?.title||work?.title||(imported.format==='EPUB'?imported.title:job.bookTitle||imported.title),author:existing?.author||work?.author||job.bookAuthor||imported.author,
  coverImage:existing?.coverImage||imported.coverImage,description:existing?.description||work?.description||imported.description,
  sourceUrl:work?.url||existing?.sourceUrl||(/^https?:/.test(job.url)?job.url:job.referrer),online:work,
  favorite:existing?.favorite??true,cache:{downloadId:job.id,name:job.name,loadedAt:Date.now()},cacheSource:cacheSource(job)};
}
export function withoutCache(book:Book):Book {
 return {...book,cache:undefined,size:0,fingerprint:undefined,format:book.online?'WEB':book.format};
}
export async function readablePayload(book:Book):Promise<BookPayload|undefined>{
 // Backups may contain a portable copy. Live downloads retain a single native file.
 const stored=await getPayload(book.id);if(stored)return stored;
 if(!book.cache?.downloadId)return;
 if(!window.desktop?.downloads)throw new Error('此文件保存在桌面版，请在桌面版阅读或恢复完整备份');
 const file=await window.desktop.downloads.read(book.cache.downloadId);
 const {payload}=await importFile(new File([new Uint8Array(file.data).buffer],file.name));
 return {...payload,id:book.id};
}
