// Explicit live smoke check. Not part of offline unit tests; one search per built-in source.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const output=path.resolve('test-results',`sources-${Date.now()}`);await fs.mkdir(output,{recursive:true});
const compiled=ts.transpileModule(await fs.readFile('src/lib/sources.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
await fs.writeFile(path.join(output,'sources.mjs'),compiled);
const dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.document=dom.window.document;
const {defaultSources,searchRequest,parseSearch,parseDetail}=await import(pathToFileURL(path.join(output,'sources.mjs')).href);
const {fetchSource}=createRequire(import.meta.url)('../electron/sources.cjs');const results=[];const pending=[...defaultSources];
await Promise.all(Array.from({length:3},async()=>{while(pending.length){const source=pending.shift();const query=source.id==='nlc'?'红楼梦':'剑';try{
  const response=await fetchSource(searchRequest(source,query));const page=parseSearch(source,response);
  const row={name:source.name,id:source.id,query,status:response.status,count:page.books.length,hasNext:page.hasNext,needsBrowser:!!page.needsBrowser,message:page.message||'',examples:page.books.slice(0,2).map(b=>({title:b.title,author:b.author,url:b.url}))};
  if(page.books.length && ['nlc','zongheng','fanqie','ciweimao'].includes(source.id)){
    try{const detail=parseDetail(source,await fetchSource({url:page.books[0].url}),page.books[0]);row.detail={title:detail.title,author:detail.author,hasDescription:!!detail.description,hasCover:!!detail.coverUrl};}catch(error){row.detailError=error.message;}
    const next=parseSearch(source,await fetchSource(page.nextUrl?{url:page.nextUrl}:searchRequest(source,query,2)));row.secondPageCount=next.books.length;row.newBooksOnSecondPage=next.books.filter(b=>!page.books.some(a=>a.url===b.url)).length;row.secondPageDiffers=row.newBooksOnSecondPage>0;
  }
  results.push(row);console.log(JSON.stringify(row));
}catch(error){const row={name:source.name,id:source.id,error:error.message};results.push(row);console.log(JSON.stringify(row));}}}));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));console.log(`Evidence: ${output}`);dom.window.close();
