import JSZip from 'jszip';
import {crc32} from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export const novel='正文 第一章 初见\n这是自动解压得到的第一章正文。\n\n第 ２ 章 重逢\n第二章内容完整保留。\n\n番外 尾声\n故事结束。';
export async function readingArchives(directory){
 await fs.mkdir(directory,{recursive:true});const data=Buffer.from(novel),name=Buffer.from('book.txt');
 const header=(type,size)=>{const b=Buffer.alloc(size);b[2]=type;b.writeUInt16LE(size,5);return b;},seal=b=>{b.writeUInt16LE(crc32(b.subarray(2))&65535,0);return b;};
 const h=header(0x74,32+name.length);h.writeUInt16LE(0x8000,3);h.writeUInt32LE(data.length,7);h.writeUInt32LE(data.length,11);h[15]=2;h.writeUInt32LE(crc32(data),16);h[24]=20;h[25]=0x30;h.writeUInt16LE(name.length,26);h.writeUInt32LE(32,28);name.copy(h,32);
 const rar=Buffer.concat([Buffer.from('526172211a0700','hex'),seal(header(0x73,13)),seal(h),data,seal(header(0x7b,7))]);
 const zip=new JSZip();zip.file('books/book.txt',novel);zip.file('README.txt','说明文件，不应作为正文。');
 await fs.writeFile(path.join(directory,'book.txt'),data);
 const binary=path.resolve('vendor/sevenzip/7z.exe');
 await promisify(execFile)(binary,['a','-t7z',path.join(directory,'book.7z'),'book.txt'],{cwd:directory,windowsHide:true});
 await promisify(execFile)(binary,['a','-tzip','-psecret','-mem=AES256',path.join(directory,'locked.zip'),'book.txt'],{cwd:directory,windowsHide:true});
 const nested=new JSZip();nested.file('inner.7z',await fs.readFile(path.join(directory,'book.7z')));
 return {ZIP:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),RAR:rar,'7Z':await fs.readFile(path.join(directory,'book.7z')),locked:await fs.readFile(path.join(directory,'locked.zip')),nested:await nested.generateAsync({type:'nodebuffer'})};
}
