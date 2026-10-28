import {describe,it,expect} from 'vitest';
import {extractDownloadResources,readTransferInput,resourceFromUrl,unwrapTransferUrl} from '../src/lib/download-resources';
import {parseDownloadPage} from '../src/lib/downloads';
const hash='0123456789abcdef0123456789abcdef01234567';
function root(html:string){return new DOMParser().parseFromString(html,'text/html').body;}
describe('download resources',()=>{
 it('finds ordinary links, plain-text shares and magnets while keeping each extraction code associated',()=>{
  const html=`<main><p><a href="https://pan.baidu.com/s/one">第一本</a> 提取码：abcd</p><p>https://pan.quark.cn/s/two 提取码: ef56</p><p>magnet:?xt=urn:btih:${hash}&amp;dn=Book</p><p><a href="/books.torrent">种子</a></p><script>https://pan.baidu.com/s/evil</script></main>`;
  const parsed=parseDownloadPage({text:html,url:'https://books.example/book',status:200,contentType:'text/html'});
  expect(parsed.resources).toHaveLength(4);expect(parsed.resources?.[0]).toMatchObject({password:'abcd',provider:'百度网盘'});expect(parsed.resources?.find(r=>r.provider==='夸克网盘')?.password).toBe('ef56');expect(parsed.resources?.find(r=>r.kind==='torrent')?.url).toBe('https://books.example/books.torrent');expect(parsed.files).toEqual([]);expect(parsed.pages).toEqual([]);
 });
 it('accepts a copied share message and thunder-wrapped magnets without allowing other schemes',()=>{
  const input=readTransferInput('给你分享一本书 https://pan.baidu.com/s/abc 提取码：d4e5');expect(input?.resource?.password).toBe('d4e5');
  const magnet='magnet:?xt=urn:btih:'+hash;expect(unwrapTransferUrl('thunder://'+btoa('AA'+magnet+'ZZ'))).toBe(magnet);
  for(const link of ['javascript:alert(1)','file:///C:/private.txt','thunder://broken','magnet:?dn=NoHash','https://user:pass@pan.baidu.com/s/abc'])expect(readTransferInput(link)).toBeUndefined();
 });
 it('deduplicates the same cloud resource and preserves an explicit query password',()=>{
  const html='<p><a href="https://pan.baidu.com/s/id?pwd=code">书</a>提取码: wrong</p><p>https://pan.baidu.com/s/id 提取码: code</p><p>https://pan.baidu.com.evil.example/s/id</p>';
  const resources=extractDownloadResources(root(html),'https://books.example/');expect(resources).toHaveLength(1);expect(resources[0].password).toBe('code');
  expect(resourceFromUrl('https://www.alipan.com/s/id')?.provider).toBe('阿里云盘');
 });
 it('does not turn a plain executable or navigation page into a cloud resource',()=>{
  expect(resourceFromUrl('https://books.example/setup.exe')).toBeUndefined();expect(resourceFromUrl('https://books.example/download')).toBeUndefined();
 });
 it('reads public copy fields and codes in adjacent spans without reading password inputs',()=>{
  const html=`<main><form><input readonly value="magnet:?xt=urn:btih:${hash}"><input readonly type="password" value="https://pan.baidu.com/s/private"></form><p><span>https://pan.quark.cn/s/one</span><span> 提取码:abcd</span></p><p>https://pan.baidu.com/s/two https://pan.quark.cn/s/three 提取码:ef56</p></main>`;
  const parsed=parseDownloadPage({text:html,url:'https://books.example/',status:200,contentType:'text/html'});expect(parsed.resources).toHaveLength(4);
  expect(parsed.resources?.find(r=>r.url.includes('/one'))?.password).toBe('abcd');expect(parsed.resources?.find(r=>r.url.includes('/two'))?.password).toBeUndefined();expect(parsed.resources?.find(r=>r.url.includes('/three'))?.password).toBe('ef56');
 });

 it('normalizes a Baidu pwd followed immediately by an archive password',()=>{
  for(const suffix of ['解压码：8888','解压密码：different','解壓密碼：9999',encodeURIComponent('解压码：8888')]){
   const link='https://pan.baidu.com/s/book?pwd=8888'+suffix;
   const result=readTransferInput(link);expect(result?.url).toBe('https://pan.baidu.com/s/book?pwd=8888');expect(result?.resource?.password).toBe('8888');
   const parsed=parseDownloadPage({text:`<main><p>${link}</p><a href="${link}">百度下载</a></main>`,url:'https://books.example/',status:200,contentType:'text/html'});
   expect(parsed.resources).toHaveLength(1);expect(parsed.resources?.[0].url).toBe('https://pan.baidu.com/s/book?pwd=8888');
  }
 });
 it('keeps explicit pwd ahead of other codes and does not use an archive password as the share code',()=>{
  expect(readTransferInput('https://pan.baidu.com/s/book?pwd=Ab12 解压密码：9999 提取码：wrong')?.resource?.password).toBe('Ab12');
  expect(readTransferInput('https://pan.baidu.com/s/book pwd=8888解压码：9999')?.resource?.password).toBe('8888');
  expect(readTransferInput('https://pan.baidu.com/s/book 解压密码：9999')?.resource?.password).toBeUndefined();
  expect(readTransferInput('https://pan.baidu.com/s/book 解压码：9999')?.resource?.password).toBeUndefined();
  expect(readTransferInput('https://pan.baidu.com/s/book?pwd=Ab12&foo=bar')?.url).toBe('https://pan.baidu.com/s/book?pwd=Ab12&foo=bar');
 });

});
