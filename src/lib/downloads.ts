import type { Book, DownloadFileFormat, DownloadProvider, DownloadTarget, LibraryState, RemoteBook, SourceResponse } from '../types';
import { fetchSource, safeUrl } from './sources';
import {extractDownloadResources,resourceFromUrl,unwrapTransferUrl,type DownloadResource} from './download-resources';

export type DownloadFormat = 'all' | 'archive' | DownloadFileFormat;
export const downloadFormats:DownloadFormat[]=['all','EPUB','PDF','TXT','archive','ZIP','RAR','7Z'];
export const isArchiveFormat=(format?:string)=>!!format && ['ZIP','RAR','7Z'].includes(format);
export const matchesDownloadFormat=(format:string|undefined,filter:DownloadFormat)=>filter==='all' || (filter==='archive'?isArchiveFormat(format):format===filter);
export interface DownloadQuery { title: string; author: string; includeAuthor: boolean; format: DownloadFormat }
export interface DownloadCandidate { id: string; providerId: string; title: string; author: string; url: string; summary: string; restricted?: boolean; directFile?:DownloadFile }
export interface DownloadPage { books: DownloadCandidate[]; nextUrl?: string; message?:string }
export interface DownloadFile { name: string; format: DownloadFileFormat; url: string; size?: string; referrer?:string; preparedId?:string }
export interface DownloadPageLink { title:string; url:string }
export interface DownloadFiles { resources?:DownloadResource[]; files: DownloadFile[]; message?: string; rights?: string; pages?:DownloadPageLink[]; pageUrl?:string; title?:string; description?:string }

export const defaultDownloadProviders: DownloadProvider[] = [
  { id:'download-archive', name:'Internet Archive', homepage:'https://archive.org/', searchUrl:'https://archive.org/search?query={query}&and%5B%5D=mediatype%3Atexts', adapter:'archive', kind:'catalog', enabled:true, description:'汇总书目，检查公开的书籍与压缩包文件' },
  { id:'download-gutenberg', name:'Project Gutenberg', homepage:'https://www.gutenberg.org/', searchUrl:'https://www.gutenberg.org/ebooks/search/?query={query}', adapter:'gutenberg', kind:'catalog', enabled:true, description:'经典作品，支持 EPUB、TXT；中文可尝试繁体书名' },
  { id:'download-bing', name:'必应', homepage:'https://www.bing.com/', searchUrl:'https://www.bing.com/search?q={query}', adapter:'link', kind:'engine', enabled:true, description:'搜索书名、作者及下载格式' },
  { id:'download-baidu', name:'百度', homepage:'https://www.baidu.com/', searchUrl:'https://www.baidu.com/s?wd={query}', adapter:'link', kind:'engine', enabled:true, description:'搜索中文电子书与下载页面' },
  { id:'download-google', name:'Google', homepage:'https://www.google.com/', searchUrl:'https://www.google.com/search?q={query}', adapter:'link', kind:'engine', enabled:true, description:'搜索各站收录的电子书页面' },
  { id:'download-standard', name:'Standard Ebooks', homepage:'https://standardebooks.org/', searchUrl:'https://standardebooks.org/ebooks?query={query}', adapter:'link', kind:'site', enabled:true, description:'读取英文经典书目和 EPUB 文件' },
  { id:'download-shuge', name:'书格', homepage:'https://www.shuge.org/', searchUrl:'https://www.shuge.org/?s={query}', adapter:'link', kind:'site', enabled:true, description:'查找古籍、善本及原站分享的数字资源' },
  { id:'download-wikisource', name:'中文维基文库', homepage:'https://zh.wikisource.org/', searchUrl:'https://zh.wikisource.org/w/index.php?title=Special%3ASearch&search={query}&ns0=1', adapter:'link', kind:'site', enabled:true, description:'查找中文作品及原站提供的导出方式' },
];

export function migrateDownloadState(state: LibraryState): LibraryState {
  return state.downloadProviders === undefined ? { ...state, downloadProviders: structuredClone(defaultDownloadProviders) } : state;
}
export function downloadTarget(book: Book | RemoteBook): DownloadTarget {
  return { title:book.title, author:/^(?:作者未提供|未知作者|佚名)$/.test(book.author) ? '' : book.author,
    url:'url' in book ? book.url : book.online?.url || book.sourceUrl, sourceName:'sourceName' in book ? book.sourceName : book.online?.sourceName,bookId:'id' in book&&!book.sample?book.id:undefined,work:'url' in book?book:book.online };
}
export function validateDownloadProvider(value: unknown): asserts value is DownloadProvider {
  if (!value || typeof value !== 'object') throw new Error('下载站点配置无效');
  const p = value as DownloadProvider;
  if (typeof p.id !== 'string' || !/^[\w-]{1,80}$/.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || typeof p.enabled !== 'boolean') throw new Error('请填写有效的站点名称');
  if (!['link','archive','gutenberg'].includes(p.adapter) || !['engine','catalog','site'].includes(p.kind)) throw new Error('站点类型无效');
  if (typeof p.homepage !== 'string' || !safeUrl(p.homepage) || typeof p.searchUrl !== 'string' || !safeUrl(p.searchUrl)) throw new Error('请输入完整的 http / https 地址');
  if (!/\{(?:query|title)\}/.test(p.searchUrl) || /[{}]/.test(p.searchUrl.replace(/\{(?:query|title|author|format)\}/g,''))) throw new Error('搜索地址需包含 {query} 或 {title}，仅支持 query、title、author、format 占位符');
  if (/[{}]/.test(p.homepage) || /[{}]|%7[bd]/i.test(new URL(p.searchUrl).host)) throw new Error('网站域名不能包含占位符');
  if (p.description !== undefined && (typeof p.description !== 'string' || p.description.length > 300)) throw new Error('站点说明过长');
  if (p.selectors !== undefined) {
    if (!p.selectors || typeof p.selectors!=='object' || Array.isArray(p.selectors)) throw new Error('解析规则无效');
    for (const [key,value] of Object.entries(p.selectors)) {
      if (!['item','title','link','description','next'].includes(key) || typeof value!=='string' || value.length>1000) throw new Error('解析规则无效');
      if(value)try{document.createDocumentFragment().querySelector(value);}catch{throw new Error('解析规则中的 CSS 选择器无效');}
    }
  }
  if (p.adapter !== 'link') {
    const origin = p.adapter === 'archive' ? 'https://archive.org' : 'https://www.gutenberg.org';
    if (p.kind !== 'catalog' || new URL(p.homepage).origin !== origin || new URL(p.searchUrl).origin !== origin) throw new Error('自动读取目录须使用其官方站点');
  }
}

export function downloadSearchUrl(provider: DownloadProvider, query: DownloadQuery): string {
  const author = query.includeAuthor ? query.author.trim() : '';
  const format = query.format === 'all' ? '' : query.format === 'archive' ? '压缩包' : query.format;
  const words = [query.title.trim(), author];
  if (provider.kind === 'engine') words.push(format || '电子书', '下载');
  const values = { title:query.title.trim(), author, format, query:words.filter(Boolean).join(' ') };
  const url = safeUrl(provider.searchUrl.replace(/\{(query|title|author|format)\}/g, (_,key: keyof typeof values) => encodeURIComponent(values[key])));
  if (!url) throw new Error('搜索地址无效');
  return url;
}

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function plain(value: unknown, max = 600): string {
  const text = Array.isArray(value) ? value.filter(v=>typeof v==='string').join(' · ') : typeof value === 'string' ? value : '';
  return new DOMParser().parseFromString(text.slice(0,20000),'text/html').body.textContent?.replace(/\s+/g,' ').trim().slice(0,max) || '';
}
const flag = (v: unknown) => v === true || v === 1 || v === 'true' || v === '1';
const archiveId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(v);
function assertResponse(response: SourceResponse, origin: string) {
  if (response.access === 'login' || response.status === 401 || /\/(?:login|signin)(?:\/|$)/i.test(new URL(response.url).pathname)) throw new Error('该来源需要登录，当前无法读取，可选择其他来源');
  if (response.access === 'verification' || [202,403,429].includes(response.status)) throw new Error('来源暂时限制访问，请稍后重试或选择其他来源');
  if (response.status < 200 || response.status >= 300) throw new Error(`目录暂时无法读取（HTTP ${response.status}）`);
  if (!response.text.trim() && !response.download) throw new Error('目录返回了空响应，请稍后重试');
  if (new URL(response.url).origin !== origin) throw new Error('目录跳转到了其他网站，未能读取，请重试');
}
function json(response: SourceResponse): Record<string, unknown> {
  try { return object(JSON.parse(response.text)); } catch { throw new Error('目录没有返回有效数据，请重试或选择其他来源'); }
}
function catalogUrl(provider: DownloadProvider, query: DownloadQuery) {
  if (provider.adapter === 'gutenberg') {
    const url = new URL('https://www.gutenberg.org/ebooks/search/');
    url.searchParams.set('query',[query.title.trim(),query.includeAuthor ? query.author.trim() : ''].filter(Boolean).join(' '));
    return url.href;
  }
  const quoted = (text: string) => `"${text.replace(/[\\"]/g,'\\$&')}"`;
  const terms = [`title:(${quoted(query.title.trim())})`, 'mediatype:texts'];
  if (query.includeAuthor && query.author.trim()) terms.push(`creator:(${quoted(query.author.trim())})`);
  const url = new URL('https://archive.org/advancedsearch.php');
  url.search = new URLSearchParams({q:terms.join(' AND '),output:'json',rows:'10',page:'1','fl[]':'identifier,title,creator,description,access-restricted-item'}).toString();
  return url.href;
}

export function parseDownloadSearch(provider: DownloadProvider, response: SourceResponse): DownloadPage {
  const origin = provider.adapter === 'archive' ? 'https://archive.org' : 'https://www.gutenberg.org';
  assertResponse(response,origin);
  if (provider.adapter === 'archive') {
    const data = json(response), result = object(data.response);
    if (data.error || !Array.isArray(result.docs) || !Number.isSafeInteger(result.numFound) || Number(result.numFound) < 0) throw new Error('目录数据不完整，请稍后重试');
    const seen = new Set<string>();
    const books = result.docs.slice(0,50).flatMap(value => {
      const book = object(value), id = book.identifier, title = plain(book.title,1000);
      if (!archiveId(id) || !title || seen.has(id)) return [];
      seen.add(id);
      return [{ id,providerId:provider.id,title,author:plain(book.creator,1000) || '作者未提供',summary:plain(book.description),url:`${origin}/details/${encodeURIComponent(id)}`,restricted:flag(book['access-restricted-item']) }];
    });
    if (result.docs.length && !books.length) throw new Error('没有识别到有效书目，目录数据可能已变更');
    const url = new URL(response.url), page = Math.max(1,Number(url.searchParams.get('page')) || 1);
    const more = books.length > 0 && page * 10 < Number(result.numFound) && page < 20;
    if (more) url.searchParams.set('page',String(page+1));
    return { books,nextUrl:more ? url.href : undefined };
  }
  const doc = new DOMParser().parseFromString(response.text,'text/html');
  if (/^(?:just a moment|access denied|(?:login|sign in)(?:\s*[-|]|$))/i.test(doc.title)) throw new Error('目录需要验证或登录，当前无法读取');
  const seen = new Set<string>();
  const books = [...doc.querySelectorAll('li.booklink')].slice(0,50).flatMap(item => {
    const url = safeUrl(item.querySelector('a.link')?.getAttribute('href'),origin);
    const id = url && new URL(url).origin === origin ? new URL(url).pathname.match(/^\/ebooks\/(\d+)\/?$/)?.[1] : undefined;
    const title = plain(item.querySelector('.title')?.textContent,1000);
    if (!id || !url || !title || seen.has(id)) return [];
    seen.add(id);
    return [{ id,providerId:provider.id,title,author:plain(item.querySelector('.subtitle')?.textContent,1000) || '作者未提供',summary:plain(item.querySelector('.extra')?.textContent),url }];
  });
  if (!books.length && !/no (?:results|records|books)(?: were)? found|no results|no books matching/i.test(doc.body.textContent || '')) throw new Error('没有识别到目录结果，页面可能已变更，请重试或选择其他来源');
  const next = doc.querySelector('a[accesskey="+"],a[title="Go to the next page of results."]');
  const url = safeUrl(next?.getAttribute('href'),response.url);
  const current = new URL(response.url), candidate = url ? new URL(url) : undefined;
  const nextUrl = candidate?.origin === origin && candidate.pathname === '/ebooks/search/' && candidate.searchParams.get('query') === current.searchParams.get('query') && Number(candidate.searchParams.get('start_index')) > Number(current.searchParams.get('start_index') || 1) ? url : undefined;
  return { books,nextUrl:books.length ? nextUrl : undefined };
}

export async function searchDownloadCatalog(provider: DownloadProvider, query: DownloadQuery, signal?: AbortSignal, nextUrl?: string): Promise<DownloadPage> {
  if (provider.adapter === 'link') return searchDownloadWebsite(provider,query,signal,nextUrl);
  const first = catalogUrl(provider,query), url = nextUrl || first;
  if (new URL(url).origin !== new URL(first).origin || new URL(url).pathname !== new URL(first).pathname) throw new Error('目录翻页地址无效');
  const response = await fetchSource({url,charset:'utf-8'},signal);
  if (signal?.aborted) throw new DOMException('已取消','AbortError');
  return parseDownloadSearch(provider,response);
}

export function parseDownloadFiles(provider: DownloadProvider, book: DownloadCandidate, response: SourceResponse): DownloadFiles {
  const origin = provider.adapter === 'archive' ? 'https://archive.org' : 'https://www.gutenberg.org';
  assertResponse(response,origin);
  if (provider.adapter === 'archive') {
    const data = json(response), metadata = object(data.metadata);
    if (flag(data.is_dark) || flag(metadata['access-restricted-item']) || flag(object(data.item_access).is_restricted) || book.restricted) return { files:[],message:'此记录受访问限制，需要登录或借阅，当前没有可下载文件' };
    if (!Array.isArray(data.files) || (metadata.identifier !== undefined && metadata.identifier !== book.id)) throw new Error('没有读到有效的文件清单，请重试');
    const seen = new Set<string>();
    const files = data.files.slice(0,5000).flatMap(value => {
      const f = object(value), name = f.name;
      if (typeof name !== 'string' || name.length > 2000 || /[\\\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(part=>part==='.' || part==='..') || flag(f.private) || /encrypted|borrow|loan|drm/i.test(String(f.format || ''))) return [];
      const format = name.match(/\.(epub|pdf|txt|zip|rar|7z)$/i)?.[1].toUpperCase() as DownloadFile['format'] | undefined;
      if (!format || seen.has(name)) return [];
      seen.add(name);
      const size = Number(f.size);
      return [{ name,format,url:`${origin}/download/${encodeURIComponent(book.id)}/${name.split('/').map(encodeURIComponent).join('/')}`,size:Number.isFinite(size) && size > 0 ? fileSize(size) : undefined }];
    }).slice(0,120);
    return { files,rights:plain(metadata.licenseurl || metadata.rights,300),message:files.length ? undefined : '目录未提供公开的书籍或 ZIP / RAR / 7Z 压缩包，可选择其他书目或来源' };
  }
  const doc = new DOMParser().parseFromString(response.text,'text/html');
  if (/^(?:just a moment|access denied|(?:login|sign in)(?:\s*[-|]|$))/i.test(doc.title)) throw new Error('书目需要验证或登录，当前无法读取');
  if (new URL(response.url).pathname.replace(/\/$/,'') !== `/ebooks/${book.id}`) throw new Error('书目跳转到了其他页面，请重试');
  const files: DownloadFile[] = [], seen = new Set<string>();
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = safeUrl(a.getAttribute('href'),response.url);
    if (!url || new URL(url).origin !== origin || seen.has(url)) continue;
    const path = new URL(url).pathname;
    const direct = new RegExp(`^/ebooks/${book.id}\\.(epub3?(?:\\.images|\\.noimages)?|txt(?:\\.utf-8)?|pdf)$`,'i').exec(path);
    const stored = (path.startsWith(`/files/${book.id}/`) || path.startsWith(`/cache/epub/${book.id}/`)) && /\.(epub|pdf|txt|zip|rar|7z)$/i.exec(path);
    const ext = direct?.[1].split('.')[0] || (stored ? stored[1] : undefined);
    if (!ext) continue;
    const format = (ext.toLowerCase().startsWith('epub') ? 'EPUB' : ext.toUpperCase()) as DownloadFile['format'];
    const row = a.closest('.featured-format-row,.other-format-row,tr');
    const size = plain(row?.querySelector('.featured-format-size,.other-format-size,td:last-child')?.textContent,30);
    seen.add(url); files.push({url,format,name:plain(a.textContent,120) || format,size:/\d.*(?:B|bytes)/i.test(size) ? size : undefined});
    if (files.length >= 120) break;
  }
  if (!files.length && !doc.querySelector('h1[itemprop="name"],h1')) throw new Error('没有识别到书目页面，请重试');
  return {files,message:files.length ? undefined : '这份书目未提供可识别的书籍或 ZIP / RAR / 7Z 压缩包链接，可选择其他书目或来源'};
}
function fileSize(bytes: number) { return bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${(bytes/1024).toFixed(1)} KB`; }
export async function resolveDownloadFiles(provider: DownloadProvider, book: DownloadCandidate, signal?: AbortSignal): Promise<DownloadFiles> {
  if (provider.adapter === 'link') return book.directFile ? {files:[book.directFile],pageUrl:book.url} : readDownloadPage(book.url,signal);
  if (provider.adapter === 'archive' ? !archiveId(book.id) : !/^\d+$/.test(book.id)) throw new Error('书目编号无效');
  const url = provider.adapter === 'archive' ? `https://archive.org/metadata/${encodeURIComponent(book.id)}` : `https://www.gutenberg.org/ebooks/${book.id}`;
  const response = await fetchSource({url,charset:'utf-8'},signal);
  if (signal?.aborted) throw new DOMException('已取消','AbortError');
  return parseDownloadFiles(provider,book,response);
}
function pageDocument(response:SourceResponse):Document {
  assertResponse(response,new URL(response.url).origin);
  const doc=new DOMParser().parseFromString(response.text,'text/html');
  if (/^(?:just a moment|access denied|(?:login|sign in)(?:\s*[-|]|$)|百度安全验证|安全验证|用户登录)/i.test(doc.title) || doc.querySelector('#cf-challenge-running,.g-recaptcha,script[src*="/probe.js"]')) throw new Error('站点要求登录或验证，暂时无法在此读取；可重试或选择其他来源');
  return doc;
}
export function fileFromUrl(value:string, name='', mime='', referrer?:string):DownloadFile|undefined {
  const url=safeUrl(value);if(!url)return;
  const parsed=new URL(url);let path;try{path=decodeURIComponent(parsed.pathname);}catch{path=parsed.pathname;}
  if(/\/(?:wiki|w)\/(?:File|Image|文件|檔案|图像|圖像):/i.test(path))return; // MediaWiki description pages contain the actual file link.
  const extension=(text:string)=>text.match(/\.(epub|pdf|txt|zip|rar|7z)(?:$|[?#])/i)?.[1].toUpperCase() as DownloadFile['format']|undefined;
  if (/\.(?:exe|msi|bat|cmd|com|scr|ps1|js)$/i.test(path)) return;
  const format=extension(path) || ['filename','file','name','download'].map(key=>extension(parsed.searchParams.get(key)||'')).find(Boolean) || extension(name) || (/application\/epub\+zip/i.test(mime)?'EPUB':/application\/pdf/i.test(mime)?'PDF':/^text\/plain/i.test(mime)?'TXT':/application\/(?:zip|x-zip-compressed)(?:;|$)/i.test(mime)?'ZIP':/application\/(?:vnd\.rar|x-rar(?:-compressed)?)(?:;|$)/i.test(mime)?'RAR':/application\/x-7z-compressed(?:;|$)/i.test(mime)?'7Z':undefined);
  if(!format)return;
  return {url,format,name:name.trim().slice(0,200) || path.split('/').pop() || `电子书.${format.toLowerCase()}`,referrer};
}
function resultUrl(raw:string|null, base:string):string|undefined {
  const link=safeUrl(raw,base);if(!link)return;
  const url=new URL(link);
  if (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname==='/url') return safeUrl(url.searchParams.get('q') || url.searchParams.get('url'));
  if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname==='/ck/a') {
    const encoded=url.searchParams.get('u');if(encoded?.startsWith('a1'))try{return safeUrl(new TextDecoder().decode(Uint8Array.from(atob(encoded.slice(2).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));}catch{return;}
  }
  return link;
}
export function parseWebsiteDownloadSearch(provider:DownloadProvider,response:SourceResponse):DownloadPage {
  const doc=pageDocument(response),origin=new URL(response.url).origin,host=new URL(provider.homepage).hostname;
  const books:DownloadCandidate[]=[],seen=new Set<string>();
  const add=(title:string,url:string|undefined,summary='',author='')=>{
    if(!url || !title || seen.has(url))return;
    const normalized=new URL(url);normalized.hash='';if(seen.has(normalized.href))return;seen.add(normalized.href);
    books.push({id:normalized.href,providerId:provider.id,title:title.slice(0,1000),author:author || normalized.hostname,summary:summary.slice(0,600),url:normalized.href,directFile:fileFromUrl(normalized.href,title)});
  };
  if(/<rss[\s>]/i.test(response.text)){
    const rss=new DOMParser().parseFromString(response.text,'application/xml');
    if(rss.querySelector('parsererror') || !rss.querySelector('channel'))throw new Error('搜索引擎返回的订阅结果无效');
    for(const item of [...rss.querySelectorAll('channel > item')].slice(0,30))add(plain(item.querySelector('title')?.textContent,1000),safeUrl(item.querySelector('link')?.textContent),plain(item.querySelector('description')?.textContent));
    return {books};
  }
  const custom=provider.selectors;
  if(custom?.item){
    for(const item of [...doc.querySelectorAll(custom.item)].slice(0,50)){
      const a=item.matches(custom.link || 'a[href]')?item:item.querySelector(custom.link || 'h2 a,h3 a,a[href]');
      add(plain((custom.title?item.querySelector(custom.title):a)?.textContent,1000),resultUrl(a?.getAttribute('href')||null,response.url),plain((custom.description?item.querySelector(custom.description):item)?.textContent));
    }
  }else if(/(^|\.)standardebooks\.org$/.test(host)){
    for(const item of doc.querySelectorAll('li[typeof="schema:Book"]')) add(plain(item.querySelector('p:not(.author) [property="schema:name"]')?.textContent,1000),resultUrl(item.querySelector('a[property="schema:url"]')?.getAttribute('href')||null,response.url),'',plain(item.querySelector('.author')?.textContent,1000));
  }else if(/(^|\.)wikisource\.org$/.test(host)){
    for(const item of doc.querySelectorAll('.mw-search-result'))add(plain(item.querySelector('.mw-search-result-heading')?.textContent,1000),resultUrl(item.querySelector('.mw-search-result-heading a')?.getAttribute('href')||null,response.url),plain(item.querySelector('.searchresult')?.textContent));
    const path=decodeURIComponent(new URL(response.url).pathname);
    if(!books.length && path.startsWith('/wiki/') && !path.includes(':') && !/\/Main_Page$/.test(path) && doc.querySelector('#mw-content-text .mw-parser-output') && !doc.querySelector('.noarticletext'))add(plain(doc.querySelector('#firstHeading')?.textContent,1000),response.url,plain(doc.querySelector('meta[name="description"]')?.getAttribute('content')));
  }else{
    const headings=[...doc.querySelectorAll('h3,h2.entry-title,h2.post-title,article h2,.result h2,.b_algo h2,.search-result h2,.book-item h2')];
    for(const heading of headings){
      if(heading.closest('nav,footer,aside,[data-tuiguang]') || heading.closest('header') && !heading.closest('article,main'))continue;
      const container=heading.closest('.result,.c-container,.b_algo,.MjjYud,article,.post-entry,.search-result,.book-item') || heading.parentElement;
      const a=heading.closest('a[href]') || heading.querySelector('a[href]');
      const raw=container?.getAttribute('mu') || container?.getAttribute('data-landurl') || a?.getAttribute('href');
      const url=resultUrl(raw||null,response.url);
      if(/(^|\.)shuge\.org$/.test(host) && url && !new URL(url).pathname.startsWith('/view/'))continue;
      add(plain(heading.textContent,1000),url,plain(container?.querySelector('.c-abstract,.b_caption,.VwiC3b,.entry-content,.searchresult,.description,.excerpt,.grid-entry-excerpt')?.textContent));
      if(books.length>=30)break;
    }
  }
  const body=doc.body.textContent || '';
  if(!books.length && !/没有(?:找到|搜索到|相关)|暂无(?:搜索|相关)|未找到|抱歉，没有|no (?:results|records|books)(?: were)? found|no results|no ebooks|did not match any|nothing found|0 results|没有和您查询/i.test(body))throw new Error('暂未识别到搜索结果，页面可能需要动态加载、登录或自定义解析规则');
  const next=custom?.next?doc.querySelector(custom.next):doc.querySelector('a[rel="next"],a.mw-nextlink,a.next,a#pnnext,a.sb_pagN') || [...doc.querySelectorAll('.pagination a')].find(a=>/^(?:›|下一页|Next)$/i.test(a.textContent?.trim()||''));
  const nextUrl=resultUrl(next?.getAttribute('href')||null,response.url);
  return {books,nextUrl:nextUrl && new URL(nextUrl).origin===origin && nextUrl!==response.url && books.length ? nextUrl : undefined};
}
function relevantBooks(books:DownloadCandidate[],query:DownloadQuery):DownloadCandidate[]{
  const clean=(value:string)=>value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
  const title=clean(query.title);if(!title)return books;
  return books.filter(book=>{
    const text=clean(book.title+' '+book.summary);if(text.includes(title))return true;
    const words=query.title.toLowerCase().match(/[a-z]{3,}/g)?.filter(w=>!['the','and','for','with','from'].includes(w)) || [];
    return words.length>0 && words.every(word=>text.includes(word));
  });
}
async function searchDownloadWebsite(provider:DownloadProvider,query:DownloadQuery,signal?:AbortSignal,nextUrl?:string):Promise<DownloadPage>{
  const original=downloadSearchUrl(provider,query),url=new URL(nextUrl || original);
  if(url.origin!==new URL(original).origin)throw new Error('搜索翻页地址无效');
  const bing=/(^|\.)bing\.com$/.test(url.hostname);
  if(bing && !nextUrl)url.searchParams.set('format','rss');
  const parse=(response:SourceResponse)=>{
    if(signal?.aborted)throw new DOMException('已取消','AbortError');
    const result=parseWebsiteDownloadSearch(provider,response);
    if(provider.kind==='engine'){
      const filtered=relevantBooks(result.books,query);
      if(result.books.length && !filtered.length)throw new Error('搜索引擎返回的网页与当前书名不匹配，请调整关键词或重试');
      return {...result,books:filtered};
    }
    return result;
  };
  let first:SourceResponse|undefined;
  try{first=await fetchSource({url:url.href,charset:'auto'},signal);return parse(first);}catch(error){
    if(signal?.aborted || !window.desktop || first?.access || first && [401,403,429].includes(first.status))throw error;
    const response=await fetchSource({url:nextUrl || original,render:true,readySelector:provider.selectors?.item || (/(^|\.)standardebooks\.org$/.test(url.hostname)?'li[typeof="schema:Book"]':'h3,.entry-title,.mw-search-result')},signal);
    return parse(response);
  }
}
export function parseDownloadPage(response:SourceResponse):DownloadFiles {
  if(response.download){
    assertResponse(response,new URL(response.url).origin);
    const {format,name}=response.download,url=safeUrl(response.url);
    if(!url || !['EPUB','PDF','TXT','ZIP','RAR','7Z'].includes(format))throw new Error('下载文件信息无效');
    return {files:[{url,format,name}],pageUrl:url};
  }
  const doc=pageDocument(response),files:DownloadFile[]=[],pages:DownloadPageLink[]=[],seen=new Set<string>();
  const exports=/(^|\.)wikisource\.org$/.test(new URL(response.url).hostname)?[...doc.querySelectorAll<HTMLAnchorElement>('#wikisource-download-epub a,#wikisource-download-pdf a')]:[];
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,.comments-area,#comments,#footer,#socket').forEach(el=>el.remove());
  const root=doc.querySelector('#mw-content-text') || doc.querySelector('main,#main') || doc.querySelector('article,.entry-content,.post-content') || doc.body;
  const resources=extractDownloadResources(root,response.url);
  root.querySelectorAll('form,input,textarea').forEach(el=>el.remove());
  for(const a of [...exports,...root.querySelectorAll<HTMLAnchorElement>('a[href]')].slice(0,3000)){
    const raw=a.getAttribute('href')||'';const url=resultUrl(unwrapTransferUrl(raw,response.url)||raw,response.url);if(!url || seen.has(url) || url===response.url || /\.(?:exe|msi|bat|cmd|com|scr|ps1|js|azw3|mobi|jpe?g|png|gif|webp)$/i.test(new URL(url).pathname))continue;
    if(resourceFromUrl(url))continue;
    const title=plain(a.textContent,200),file=fileFromUrl(url,a.getAttribute('download') || title,a.getAttribute('type') || '',response.url);
    if(file){files.push(file);seen.add(url);}
    else if(pages.length<20 && /下载|download|获取文件|电子书|网盘|存储|export|导出|epub|pdf|txt|zip|rar|7z|pan\.baidu\.com|lanzou/i.test(title+' '+url) && !/打赏|捐赠|登录|注册|客户端|迅雷|app\b|评论|comment|批量|bulk/i.test(title+' '+new URL(url).pathname)){
      pages.push({url,title:title || new URL(url).hostname});seen.add(url);
    }
    if(files.length>=100)break;
  }
  const title=plain(doc.querySelector('h1')?.textContent || doc.title,300);
  root.querySelectorAll('*').forEach(el=>el.after(doc.createTextNode(' ')));
  const description=plain(doc.querySelector('meta[name="description"],meta[property="og:description"]')?.getAttribute('content') || root.textContent,1200);
  return {files,pages,resources,pageUrl:response.url,title,description,message:files.length?undefined:resources.length?'已找到网盘或磁链，可在下方继续解析和下载。':pages.length?'此页提供中转下载页面，可继续在下方读取。':'当前页面没有可直接下载的书籍或 ZIP / RAR / 7Z 压缩包链接；可能需要登录、借阅或站点未提供文件。'};
}
export async function readDownloadPage(value:string,signal?:AbortSignal):Promise<DownloadFiles>{
  const url=safeUrl(value);if(!url)throw new Error('请输入完整的 http / https 链接');
  const file=fileFromUrl(url);if(file)return {files:[file],pageUrl:url};
  let response=await fetchSource({url,charset:'auto',downloadPage:true},signal);
  if(signal?.aborted)throw new DOMException('已取消','AbortError');
  let result=parseDownloadPage(response);
  if(!result.files.length && !result.resources?.length && !result.pages?.length && window.desktop && /<script\b/i.test(response.text) && (result.description?.length || 0)<200){
    response=await fetchSource({url,render:true},signal);if(signal?.aborted)throw new DOMException('已取消','AbortError');result=parseDownloadPage(response);
  }
  return result;
}
