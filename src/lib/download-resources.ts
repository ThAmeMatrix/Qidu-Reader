import {safeUrl} from './sources';
export interface DownloadResource {kind:'cloud'|'magnet'|'torrent';url:string;title:string;provider:string;password?:string}
const providers:[RegExp,string][]=[
  [/(^|\.)(pan|yun)\.baidu\.com$/,'百度网盘'],[/(^|\.)pan\.quark\.cn$/,'夸克网盘'],[/(^|\.)(alipan|aliyundrive)\.com$/,'阿里云盘'],[/(^|\.)(drive|fast)\.uc\.cn$/,'UC 网盘'],[/(^|\.)cloud\.189\.cn$/,'天翼云盘'],[/(^|\.)(123pan|123865|123912)\.(com|cn)$/,'123 云盘'],[/(^|\.)(lanzou[a-z]*|lanz[a-z]{1,3})\.(com|cn)$/,'蓝奏云'],[/(^|\.)drive\.google\.com$/,'Google Drive'],[/(^|\.)(onedrive\.live\.com|1drv\.ms)$/,'OneDrive'],[/(^|\.)dropbox\.com$/,'Dropbox'],[/(^|\.)mypikpak\.com$/,'PikPak'],
];
const codePattern=/(?:提取[码碼]|访问[码碼]|分享密[码碼]|(?<!解压|解壓|压缩|壓縮)密[码碼]|(?<![a-z])pwd|pass(?:word|code)?|access\s*code)\s*[：:=]?\s*([a-zA-Z0-9]{1,16})(?![a-zA-Z0-9])/i;
function cleanBaiduUrl(url:URL){
  // A copied share often has prose glued to pwd, including percent-encoded prose.
  // Keep the explicit access code and leave archive passwords out of the URL.
  for(const key of ['pwd','password','passcode','accessCode','code']){
    const value=url.searchParams.get(key);if(!value)continue;
    const code=value.match(/^([a-zA-Z0-9]{1,16})(?=$|[\s，。；、：:;（(]|解[压壓]|提取|访问)/)?.[1];
    if(code && code!==value)url.searchParams.set(key,code);
  }
  for(const key of [...url.searchParams.keys()])if(/^解[压壓]|^压缩|^壓縮/.test(key))url.searchParams.delete(key);
  if(/^#(?:解[压壓]|压缩|壓縮)/.test(decodeSafe(url.hash)))url.hash='';
  return url.href;
}
export function unwrapTransferUrl(value:string,base?:string):string|undefined{
  let text=value.trim().replace(/&amp;/g,'&');
  if(/^thunder:\/\//i.test(text)){try{text=new TextDecoder().decode(Uint8Array.from(atob(text.slice(10)),c=>c.charCodeAt(0)));if(!text.startsWith('AA')||!text.endsWith('ZZ'))return;text=text.slice(2,-2);}catch{return;}}
  if(/^magnet:\?/i.test(text)){if(text.length>16384)return;try{const url=new URL(text);if(!url.searchParams.getAll('xt').some(v=>/^urn:bt(?:ih|mh):/i.test(v)))return;return url.href;}catch{return;}}
  const safe=safeUrl(text,base);if(!safe)return;const parsed=new URL(safe);
  return /(^|\.)(pan|yun)\.baidu\.com$/.test(parsed.hostname)?cleanBaiduUrl(parsed):safe;
}
export function resourceFromUrl(value:string,context='',base?:string):DownloadResource|undefined{
  const url=unwrapTransferUrl(value,base);if(!url)return;
  const parsed=new URL(url);
  if(parsed.protocol==='magnet:')return {kind:'magnet',url,title:parsed.searchParams.get('dn')?.slice(0,200)||'磁链资源',provider:'BitTorrent'};
  if(/\.torrent$/i.test(parsed.pathname))return {kind:'torrent',url,title:decodeSafe(parsed.pathname.split('/').pop()||'种子文件'),provider:'BitTorrent'};
  const provider=providers.find(([pattern])=>pattern.test(parsed.hostname))?.[1];if(!provider)return;
  const password=['pwd','password','passcode','accessCode','code'].map(k=>parsed.searchParams.get(k)).find(v=>v&&/^[a-zA-Z0-9]{1,16}$/.test(v)) || parsed.hash.match(/(?:pwd|code)=([a-zA-Z0-9]{1,16})/i)?.[1] || context.slice(0,240).match(codePattern)?.[1];
  // Only attach the code to provider-documented query keys; retain all other
  // codes separately for the user to enter into the original sharing page.
  if(password && provider==='百度网盘' && !parsed.searchParams.has('pwd'))parsed.searchParams.set('pwd',password);
  return {kind:'cloud',url:parsed.href,title:provider+'分享',provider,password:password||undefined};
}
function decodeSafe(text:string){try{return decodeURIComponent(text);}catch{return text;}}
const textLinks=/(?:magnet:\?[^\s<>"'\u3000]+|thunder:\/\/[a-zA-Z0-9+/=]+|https?:\/\/[^\s<>"'\u3000]+)/gi;
const trimLink=(value:string)=>value.replace(/[，。；、）】》〉,;\])]+$/,'');
export function extractDownloadResources(root:Element,base:string):DownloadResource[]{
  const found=new Map<string,DownloadResource>();
  const add=(url:string,context='',title='')=>{
    const resource=resourceFromUrl(trimLink(url),context,base);if(!resource)return;
    const key=new URL(resource.url);if(resource.kind==='cloud'){key.searchParams.delete('pwd');key.hash='';}
    const old=found.get(key.href);if(old){if(!old.password&&resource.password)found.set(key.href,{...old,password:resource.password,url:resource.url});return;}
    if(found.size<80)found.set(key.href,{...resource,title:title.trim().slice(0,200)||resource.title});
  };
  for(const field of [...root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input[readonly],textarea')].slice(0,200)){
    if(field instanceof HTMLInputElement && !['text','url'].includes(field.type))continue;
    const value=field.value.trim();if(value.length<=16384 && /^(?:magnet:\?|thunder:\/\/|https?:\/\/)/i.test(value))for(const link of value.matchAll(textLinks))add(link[0],value.slice(link.index!+link[0].length));
  }
  for(const a of [...root.querySelectorAll('a[href],[data-clipboard-text]')].slice(0,3000)){
    const raw=a.getAttribute('href')||a.getAttribute('data-clipboard-text')||'';
    const parent=a.closest('p,li,td')||a.parentElement;
    const range=a.ownerDocument.createRange();range.setStartAfter(a);range.setEnd(parent!,parent!.childNodes.length);
    add(raw,range.toString().slice(0,180)||parent?.textContent?.slice(0,180)||'',a.textContent||'');
  }
  const walker=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null;let scanned=0;
  while((node=walker.nextNode())&&scanned<300000){
    if(node.parentElement?.closest('script,style,noscript,input,textarea,a[href]'))continue;
    const text=node.textContent||'';scanned+=text.length;
    for(const match of text.matchAll(textLinks)){
      const range=node.ownerDocument!.createRange(),parent=node.parentElement?.closest('p,li,td')||node.parentElement;
      let context=text.slice(match.index!+match[0].length,match.index!+match[0].length+180);
      if(parent){range.setStart(node,match.index!+match[0].length);range.setEnd(parent,parent.childNodes.length);context=range.toString().slice(0,180);}
      // Stop before another link so its extraction code is never borrowed.
      add(match[0],context.split(/https?:\/\/|magnet:\?/i)[0]);
    }
  }
  return [...found.values()];
}
export function readTransferInput(value:string):{url:string;resource?:DownloadResource}|undefined{
  const text=value.trim(),first=text.match(textLinks)?.[0],url=unwrapTransferUrl(trimLink(first||text));if(!url)return;
  const resource=resourceFromUrl(url,text.slice((first?text.indexOf(first)+first.length:0)));return {url:resource?.url||url,resource};
}
