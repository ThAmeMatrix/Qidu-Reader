// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createRequire } from 'node:module';
const { fetchSource } = createRequire(import.meta.url)('../electron/sources.cjs');
let server:http.Server;let base:string;
beforeAll(async()=>{
  server=http.createServer(async(req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'file:///C:/secret'});res.end();return;}
    if(req.url==='/binary'){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('binary');return;}
    if(req.url==='/download'){res.writeHead(302,{Location:'/opaque'});res.end();return;}
    if(req.url==='/opaque'){res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''%E4%B9%A6.pdf",'Content-Length':20*1024*1024});res.end();return;}
    if(req.url==='/too-big'){res.writeHead(200,{'Content-Type':'text/html','Content-Length':9*1024*1024});res.end();return;}
    if(req.url==='/gbk'){res.writeHead(200,{'Content-Type':'text/html'});res.end(Buffer.concat([Buffer.from('<meta charset="gbk">'),Buffer.from([0xd6,0xd0,0xce,0xc4])]));return;}
    let body='';for await(const chunk of req)body+=chunk;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({method:req.method,body}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
afterAll(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
describe('desktop source transport',()=>{
  it('posts search forms and decodes declared legacy charsets',async()=>{
    const post=await fetchSource({url:base,method:'POST',body:'q=%E7%A7%8B'});expect(JSON.parse(post.text)).toEqual({method:'POST',body:'q=%E7%A7%8B'});
    expect((await fetchSource({url:base+'/gbk'})).text).toContain('中文');
  });
  it('rejects file redirects, binary content and oversize pages',async()=>{
    await expect(fetchSource({url:base+'/redirect'})).rejects.toThrow('http');
    await expect(fetchSource({url:base+'/binary'})).rejects.toThrow('非文本');
    await expect(fetchSource({url:base+'/too-big'})).rejects.toThrow('8 MB');
    await expect(fetchSource({url:base,method:'DELETE'})).rejects.toThrow('GET / POST');
  });
  it('inspects redirected file headers without reading the binary into a search response',async()=>{
    const result=await fetchSource({url:base+'/download',downloadPage:true});
    expect(result).toMatchObject({url:base+'/opaque',text:'',download:{name:'书.pdf',format:'PDF'}});
    await expect(fetchSource({url:base+'/opaque'})).rejects.toThrow('非文本');
  });
});
