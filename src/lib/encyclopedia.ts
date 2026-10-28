import type {SourceResponse} from '../types';
import {fetchSource,safeUrl} from './sources';
export interface EncyclopediaEntry {title:string;summary:string;url:string;source:'百度百科'|'维基百科'|'百度百科·公开索引';fetchedAt:number;description?:string}
export interface EncyclopediaResult {entries:EncyclopediaEntry[];errors:string[];updatedAt:number}
const plain=(value:unknown,max=6000)=>typeof value==='string'?new DOMParser().parseFromString(value,'text/html').body.textContent?.trim().slice(0,max)||'':'';
const validUrl=(value:unknown)=>typeof value==='string'&&safeUrl(value)&&/^(?:baike\.baidu\.com|(?:zh|en)\.(?:m\.)?wikipedia\.org)$/.test(new URL(value).hostname);
function check(response:SourceResponse){if(response.status!==200||response.access)throw new Error(`站点暂不可用（${response.status}${response.access?'，需要验证':''}）`);}
export function parseBaike(response:SourceResponse):EncyclopediaEntry{
 check(response);if(!validUrl(response.url)||new URL(response.url).hostname!=='baike.baidu.com')throw new Error('百科跳转到其他页面');
 const doc=new DOMParser().parseFromString(response.text,'text/html');
 if(/安全验证|百度安全|验证码|请登录|页面不存在/.test(doc.title))throw new Error('百度百科需要验证或词条不存在');
 const title=plain(doc.querySelector('h1')?.textContent||doc.title.replace(/[_-]百度百科.*$/,''),250);
 const summary=plain(doc.querySelector('.lemma-summary,[class*="lemmaSummary"],[class*="lemma-summary"]')?.textContent||doc.querySelector('meta[name="description"],meta[property="og:description"]')?.getAttribute('content'),5000);
 if(!title||summary.length<30||!new URL(response.url).pathname.startsWith('/item/'))throw new Error('没有识别到百科概述');
 return {title,summary,url:response.url,source:'百度百科',fetchedAt:Date.now()};
}
export function parseWikiSummary(response:SourceResponse):EncyclopediaEntry{
 check(response);const value=JSON.parse(response.text);if(value.type==='disambiguation')throw new Error('有同名词条，请补充作者或作品类型');
 const title=plain(value.title,250),summary=plain(value.extract),url=value.content_urls?.desktop?.page;
 if(!title||summary.length<20||!validUrl(url)||!new URL(url).hostname.endsWith('wikipedia.org'))throw new Error('没有识别到维基百科概述');
 return {title,summary,url,source:'维基百科',fetchedAt:Date.now(),description:plain(value.description,300)};
}
export function parseBaikeIndex(response:SourceResponse,keyword:string):EncyclopediaEntry[]{
 check(response);const doc=new DOMParser().parseFromString(response.text,'application/xml'),entries:EncyclopediaEntry[]=[];
 for(const item of [...doc.querySelectorAll('item')].slice(0,12)){
  const url=item.querySelector('link')?.textContent||'',title=plain(item.querySelector('title')?.textContent,250),summary=plain(item.querySelector('description')?.textContent,1200);
  if(validUrl(url)&&new URL(url).hostname==='baike.baidu.com'&&new URL(url).pathname.startsWith('/item/')&&title.includes(keyword)&&summary.length>25)entries.push({title,summary,url,source:'百度百科·公开索引',fetchedAt:Date.now(),description:'搜索引擎收录的摘要，可能不完整'});
 }
 return entries.slice(0,3);
}
export async function lookupEncyclopedia(keyword:string,author:string,signal?:AbortSignal):Promise<EncyclopediaResult>{
 keyword=keyword.trim().slice(0,150);if(!keyword)throw new Error('请输入作品名称');
 const tasks=[(async()=>{
  const url='https://baike.baidu.com/item/'+encodeURIComponent(keyword);
  try{return [parseBaike(await fetchSource({url},signal))];}catch(e){
   if(signal?.aborted)throw e;
   try{const result=parseBaikeIndex(await fetchSource({url:'https://www.bing.com/search?format=rss&q='+encodeURIComponent('site:baike.baidu.com/item/ '+keyword+' '+author)},signal),keyword);if(result.length)return result;}catch{}
   if(signal?.aborted)throw e;
   return [parseBaike(await fetchSource({url,render:true},signal))];
  }
 })(),(async()=>{
  const host=/[\u3400-\u9fff]/.test(keyword)?'zh.wikipedia.org':'en.wikipedia.org',url='https://'+host+'/api/rest_v1/page/summary/'+encodeURIComponent(keyword);
  try{return [parseWikiSummary(await fetchSource({url},signal))];}catch(e){
   if(signal?.aborted)throw e;
   const search=new URL('https://'+host+'/w/api.php');for(const [key,value] of Object.entries({action:'query',list:'search',srsearch:keyword,srlimit:'3',srnamespace:'0',format:'json',origin:'*'}))search.searchParams.set(key,value);
   const response=await fetchSource({url:search.href},signal);check(response);const data=JSON.parse(response.text);if(!Array.isArray(data.query?.search))throw e;
   const results=await Promise.allSettled(data.query.search.slice(0,3).map(async(item:{title:string})=>parseWikiSummary(await fetchSource({url:'https://'+host+'/api/rest_v1/page/summary/'+encodeURIComponent(item.title)},signal))));
   const entries=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);if(!entries.length)throw e;return entries;
  }
 })()];
 const results=await Promise.allSettled(tasks);if(signal?.aborted)throw new DOMException('已取消','AbortError');
 return {entries:results.flatMap(result=>result.status==='fulfilled'?result.value:[]).sort((a,b)=>Number(!!author&&b.summary.includes(author))-Number(!!author&&a.summary.includes(author))),errors:results.flatMap((result,i)=>result.status==='rejected'?[(i?'维基百科':'百度百科')+'：'+result.reason.message]:[]),updatedAt:Date.now()};
}
const CACHE='qidu-encyclopedia-v1';
export function readEncyclopediaCache(key:string):EncyclopediaResult|undefined{
 try{const all=JSON.parse(localStorage.getItem(CACHE)||'{}'),value=all[key];if(value&&Array.isArray(value.entries)&&value.entries.length<=6&&Array.isArray(value.errors)&&Date.now()-value.updatedAt<7*86400000&&value.entries.every((entry:EncyclopediaEntry)=>validUrl(entry.url)&&typeof entry.title==='string'&&entry.title.length<=250&&typeof entry.summary==='string'&&entry.summary.length<=6000))return value;}catch{}
}
export function saveEncyclopediaCache(key:string,result:EncyclopediaResult){
 if(!result.entries.length)return;try{const all=JSON.parse(localStorage.getItem(CACHE)||'{}');all[key]=result;const newest=Object.entries(all).sort((a,b)=>(b[1] as EncyclopediaResult).updatedAt-(a[1] as EncyclopediaResult).updatedAt).slice(0,50);localStorage.setItem(CACHE,JSON.stringify(Object.fromEntries(newest)));}catch{}
}
