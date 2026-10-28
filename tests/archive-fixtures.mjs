import JSZip from 'jszip';
import {crc32} from 'node:zlib';
// Self-generated files; no external copyrighted archives or extraction tools.
export async function archiveFixtures(){
 const zip=new JSZip();zip.file('book.txt','第一章\n压缩包里的测试书籍。');
 const rarHeader=(type,length)=>{const header=Buffer.alloc(length);header[2]=type;header.writeUInt16LE(length,5);header.writeUInt16LE(crc32(header.subarray(2))&65535,0);return header;};
 const rar=Buffer.concat([Buffer.from('526172211a0700','hex'),rarHeader(0x73,13),rarHeader(0x7b,7)]);
 const seven=Buffer.alloc(32);Buffer.from('377abcaf271c0004','hex').copy(seven);seven.writeUInt32LE(crc32(seven.subarray(12)),8);
 return {ZIP:await zip.generateAsync({type:'nodebuffer'}),RAR:rar,'7Z':seven};
}
