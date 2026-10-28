import type { BookSource, LibraryState, RemoteBook, SourceRequest, SourceResponse } from '../types';

export const defaultSources: BookSource[] = [
  { id: 'youshu', name: '优书网', homepage: 'https://www.youshu.me/', searchUrl: 'https://www.youshu.me/modules/article/search.php', method: 'POST', body: 'searchtype=all&searchkey={query}', description: '书籍评分与书评 · 搜索可能需要登录', adapter: 'youshu', enabled: true, builtin: true, charset: 'auto' },
  { id: 'qidian', name: '起点中文网', homepage: 'https://www.qidian.com/', searchUrl: 'https://www.qidian.com/search?kw={query}&page={page}', method: 'GET', description: '原创文学 · 遇到验证时可在站点窗口完成', adapter: 'qidian', enabled: true, builtin: true, charset: 'auto' },
  { id: 'zongheng', name: '纵横中文网', homepage: 'https://www.zongheng.com/', searchUrl: 'https://search.zongheng.com/search/book?keyword={query}&pageNo={page}&pageNum=20&sort=&isFromHuayu=0', browseUrl: 'https://search.zongheng.com/s?keyword={query}&pageNo={page}', method: 'GET', description: '原创小说 · 支持书名、作者与分页搜索', adapter: 'zongheng', enabled: true, builtin: true, charset: 'auto' },
  { id: 'nlc', name: '国家图书馆', homepage: 'http://find.nlc.cn/', searchUrl: 'http://find.nlc.cn/search/doSearch?query={query}&secQuery=&actualQuery={query}&searchType=2&docType=%E5%85%A8%E9%83%A8&isGroup=isGroup&targetFieldLog=%E5%85%A8%E9%83%A8%E5%AD%97%E6%AE%B5&fromHome=true&fromGuotu=fromGuoTu&pageNo={page}', method: 'GET', description: '文津搜索 · 图书、古籍及馆藏书目', adapter: 'nlc', enabled: true, builtin: true, charset: 'auto' },
  { id: 'linovelib', name: '哔哩轻小说', homepage: 'https://www.linovelib.com/', searchUrl: 'https://www.linovelib.com/S6/', method: 'POST', body: 'searchkey={query}', description: '轻小说书目 · 可读取站点窗口中的结果', adapter: 'linovelib', enabled: true, builtin: true, charset: 'auto' },
  { id: 'novelia', name: 'Novelia', homepage: 'https://n.novelia.cc/', searchUrl: 'https://n.novelia.cc/api/novel?page={page0}&pageSize=20&query={query}&provider=&type=0&level=0&translate=0&sort=0', browseUrl: 'https://n.novelia.cc/novel?query={query}&page={page}', method: 'GET', description: '轻小说机翻机器人 · 复用登录状态，自动读取搜索结果', adapter: 'novelia', enabled: true, builtin: true, charset: 'auto' },
  { id: 'fanqie', name: '番茄小说', homepage: 'https://fanqienovel.com/', searchUrl: 'https://fanqienovel.com/api/author/search/search_book/v1?filter=127%2C127%2C127%2C127&page_count=10&page_index={page0}&query_type=0&query_word={query}', browseUrl: 'https://fanqienovel.com/search/{query}', method: 'GET', description: '原创小说 · 支持官网书目与详情，接口异常时可打开站点', adapter: 'fanqie', enabled: true, builtin: true, charset: 'auto' },
  { id: 'ciweimao', name: '刺猬猫阅读', homepage: 'https://www.ciweimao.com/', searchUrl: 'https://www.ciweimao.com/get-search-book-list/0-0-0-0-0-0/%E5%85%A8%E9%83%A8/{query}/{page}', method: 'GET', description: '二次元原创小说 · 公开书名、作者搜索与分页', adapter: 'ciweimao', enabled: true, builtin: true, charset: 'auto' },
].map(source => ({ ...source, revision: 2, searchMode: source.id === 'novelia' ? 'browser' : 'auto' })) as BookSource[];

// Upgrade untouched built-in templates, including configurations saved by 1.1.0.
// User-edited endpoints/rules and disabled/deleted sources remain the user's choice.
export function migrateSources(sources: BookSource[] = defaultSources): BookSource[] {
  return sources.map(source => {
    const current = defaultSources.find(s => s.id === source.id);
    if (!current || !source.builtin || (source.revision || 0) >= 2) return source;
    const oldUrl = source.id === 'novelia' ? 'https://n.novelia.cc/novel?query={query}&page={page}' : current.searchUrl;
    if (source.searchUrl !== oldUrl || source.method !== current.method || source.body !== current.body || source.adapter !== current.adapter || source.homepage !== current.homepage || Object.values(source.selectors || {}).some(Boolean) || (source.browseUrl && source.browseUrl !== current.browseUrl)) return source;
    return { ...source, searchUrl: current.searchUrl, browseUrl: current.browseUrl, searchMode: source.searchMode || current.searchMode, revision: 2 };
  });
}

// The catalog marker only installs newly introduced sources once. It is saved
// with the library so removing a source remains effective after restart/restore.
export function migrateSourceState(state: LibraryState): LibraryState {
  const sources = migrateSources(state.sources);
  if (state.sources && (state.sourceCatalogVersion || 0) < 1) {
    for (const id of ['fanqie', 'ciweimao']) {
      if (sources.length < 50 && !sources.some(s => s.id === id)) sources.push(structuredClone(defaultSources.find(s => s.id === id)!));
    }
  }
  return { ...state, sources, sourceCatalogVersion: Math.max(1, state.sourceCatalogVersion || 0) };
}

export function publicIndexUrl(source: BookSource, query: string): string {
  const host = new URL(source.homepage).hostname.replace(/^www\./, '');
  return `https://www.bing.com/search?q=${encodeURIComponent(`site:${host}/book/ ${query.trim()}`)}`;
}

export function safeUrl(value: string | null | undefined, base?: string): string | undefined {
  if (!value?.trim() || value.length > 4096 || value.startsWith('#')) return;
  try { const u = new URL(value.trim(), base); if (['http:', 'https:'].includes(u.protocol) && !u.username && !u.password) return u.href; } catch { /* Invalid links are omitted. */ }
}
export const remoteKey = (book: Pick<RemoteBook, 'url'>) => { const u = new URL(book.url); u.hash = ''; return u.href.replace(/\/$/, ''); };
const clean = (text: string | null | undefined, max = 20000) => (text || '').replace(/\s+/g, ' ').trim().slice(0, max);
const docFor = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const plain = (value: unknown, max = 20000) => clean(docFor(typeof value === 'string' ? value : '').body.textContent, max);

export function validateSource(value: unknown): asserts value is BookSource {
  if (!value || typeof value !== 'object') throw new Error('站点配置格式不正确');
  const s = value as BookSource;
  if (typeof s.id !== 'string' || !/^[\w-]{1,80}$/.test(s.id) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) throw new Error('请填写站点名称（最多 60 字）');
  if (!safeUrl(s.homepage) || !safeUrl(s.searchUrl) || (s.browseUrl !== undefined && !safeUrl(s.browseUrl))) throw new Error('主页和搜索地址须是完整的 http / https 链接');
  if (!['GET', 'POST'].includes(s.method) || !['auto', 'utf-8', 'gb18030'].includes(s.charset) || typeof s.enabled !== 'boolean') throw new Error('请求方式或编码不正确');
  if (!['generic', 'youshu', 'qidian', 'zongheng', 'nlc', 'linovelib', 'novelia', 'fanqie', 'ciweimao'].includes(s.adapter)) throw new Error('不支持的解析方式');
  if ((s.description !== undefined && (typeof s.description !== 'string' || s.description.length > 500)) || (s.builtin !== undefined && typeof s.builtin !== 'boolean')) throw new Error('站点说明格式不正确');
  if (s.searchMode !== undefined && !['http','auto','browser'].includes(s.searchMode)) throw new Error('搜索加载方式不正确');
  if (s.revision !== undefined && (!Number.isSafeInteger(s.revision) || s.revision < 1)) throw new Error('站点配置版本不正确');
  if (s.body !== undefined && (typeof s.body !== 'string' || s.body.length > 8000)) throw new Error('POST 参数过长');
  if (!(s.searchUrl + (s.method === 'POST' ? s.body || '' : '')).includes('{query}')) throw new Error('搜索地址或 POST 参数中需要包含 {query}，代表搜索词');
  if (s.selectors !== undefined) {
    if (!s.selectors || typeof s.selectors !== 'object' || Array.isArray(s.selectors)) throw new Error('解析规则格式不正确');
    for (const [key, selector] of Object.entries(s.selectors)) {
      if (!['item','title','link','author','cover','description','next'].includes(key) || typeof selector !== 'string' || selector.length > 500) throw new Error('解析规则格式不正确');
      if (selector) { try { document.createDocumentFragment().querySelector(selector); } catch { throw new Error(`CSS 选择器无效：${selector}`); } }
    }
    if (s.selectors.item && (!s.selectors.title || !s.selectors.link)) throw new Error('指定结果条目后，也请填写书名与链接选择器');
  }
}

export function searchRequest(source: BookSource, query: string, page = 1, browsing = false): SourceRequest {
  const fill = (value: string) => value.replaceAll('{query}', encodeURIComponent(query.trim())).replaceAll('{page}', String(page)).replaceAll('{page0}', String(Math.max(0,page - 1)));
  const method = browsing && source.browseUrl ? 'GET' : source.method;
  return { url: fill(browsing && source.browseUrl ? source.browseUrl : source.searchUrl), method, body: method === 'POST' ? fill(source.body || '') : undefined, charset: source.charset, referrer: source.homepage, readySelector: resultSelector(source) };
}

function resultSelector(source: BookSource): string {
  if (source.selectors?.item) return source.selectors.item;
  return { youshu:'a[href*="/book/"]',qidian:'.book-img-text a[href*="/book/"],.book-mid-info a[href*="/info/"]',zongheng:'a[href*="/book/"],a[href*="/detail/"]',nlc:'.book_name a[istitle]',linovelib:'.bookbox a[href*="/novel/"],.book-ol a[href*="/novel/"],.search-result a[href*="/novel/"]',novelia:'a[href^="/novel/"][href*="/"],a[href^="/wenku/"]',fanqie:'.search-book-item',ciweimao:'li[data-book-id] .tit a',generic:'a[href*="/book/"],a[href*="/novel/"],a[href*="/detail/"]' }[source.adapter];
}

export async function searchSource(source: BookSource, query: string, page = 1, signal?: AbortSignal, previous?: SearchPage): Promise<SearchPage> {
  const browser = source.searchMode === 'browser' || previous?.rendered;
  const request = previous?.nextUrl ? { url:previous.nextUrl,charset:source.charset,referrer:source.homepage,readySelector:resultSelector(source) } : searchRequest(source,query,page,!!browser);
  const read = async (next: SourceRequest) => {
    const response = await fetchSource(next,signal);
    if (signal?.aborted) throw new DOMException('已取消','AbortError');
    const original = new URL(next.url), actual = new URL(response.url);
    if (original.pathname !== '/' && actual.pathname === '/' && !response.access) return { books:[],hasNext:false,needsBrowser:true,issue:'unavailable' as const,message:'站点将搜索跳转到了首页，请在站点窗口确认搜索是否可用' };
    const parsed = parseSearch(source,response);
    // Fanqie's web pagination lives in page state, not its URL. Do not load
    // page one repeatedly when a rendered page offers no navigable next link.
    if (source.adapter === 'fanqie' && response.rendered && parsed.hasNext) return { ...parsed, hasNext:false, rendered:true, message:'已读取官网当前页。更多结果可在站点窗口翻页后点击「读取搜索结果」' };
    return { ...parsed,rendered:response.rendered };
  };
  if (browser && window.desktop) return read({ ...request,render:true });
  let first: SearchPage;
  try { first = await read(request); } catch (error) {
    if (signal?.aborted || source.searchMode !== 'auto' || !window.desktop) throw error;
    first = { books:[],hasNext:false,needsBrowser:true,message:(error as Error).message };
  }
  if (!first.needsBrowser || source.searchMode !== 'auto' || !window.desktop || (first.issue === 'login' && !source.browseUrl)) return first;
  if (source.adapter === 'fanqie' && page > 1) return { ...first,message:'番茄下一页暂时无法自动读取，请在站点窗口翻页后点击「读取搜索结果」' };
  try { return await read({ ...(previous?.nextUrl ? request : searchRequest(source,query,page,true)),render:true }); }
  catch (error) { if (signal?.aborted) throw error; return { ...first,message:`${first.message || '站点暂时无法读取'}；网页加载未完成，可打开站点窗口重试` }; }
}

export async function fetchSource(request: SourceRequest, signal?: AbortSignal): Promise<SourceResponse> {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  if (window.desktop) return window.desktop.fetchSource(request);
  // The local Vite server offers the same bounded transport as the desktop app.
  const response = await fetch('/__qidu/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
  if (!response.ok) throw new Error('请使用桌面版或本地开发服务进行跨站搜索');
  const result = await response.json(); if (result.error) throw new Error(result.error); return result;
}

export async function openSource(source: BookSource, request: SourceRequest, mode: 'search' | 'detail') {
  if (window.desktop) return window.desktop.openSource(source, request, mode);
  if (request.method === 'POST') {
    const form = document.createElement('form'); form.method = 'POST'; form.action = request.url; form.target = '_blank';
    for (const [name, value] of new URLSearchParams(request.body)) { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input); }
    document.body.append(form); form.submit(); form.remove();
  } else window.open(request.url, '_blank', 'noopener,noreferrer');
}

export interface SearchPage { books: RemoteBook[]; hasNext: boolean; nextUrl?: string; message?: string; needsBrowser?: boolean; rendered?: boolean; issue?: 'login' | 'verification' | 'unavailable' | 'unrecognized' }
function pageProblem(response: SourceResponse, doc: Document): string | undefined {
  let statusText = doc.body.textContent || '';
  if (/^\s*\{/.test(response.text)) {
    try { const data=JSON.parse(response.text);statusText=[data.message,data.msg,data.error].filter(v=>typeof v==='string').join(' '); } catch { statusText=''; }
  }
  if (response.access === 'login' || response.status === 401 || /(?:^|\/)(?:login|signin)(?:\.|\/|\?|$)/i.test(new URL(response.url).pathname) || /^(?:用户)?(?:登录|登入)/.test(doc.title) || /游客没有权限|(?:请先|需要|必须)(?:登录|登入|登陆)(?:后|才能|方可)|not authenticated/i.test(statusText)) return '搜索需要登录，请打开站点窗口登录，再点击「登录完成，重试」';
  if (response.access === 'verification' || [202, 403, 429].includes(response.status) || /just a moment|验证中心|安全验证|人机验证/i.test(doc.title) || doc.querySelector('script[src*="/probe.js"], #cf-challenge-running, .g-recaptcha')) return '站点需要验证或暂时限制访问，请在站点窗口完成验证后重试';
  if (response.status >= 400 || /404 Not Found|系统运维中/.test(doc.title)) return `站点暂时无法访问（${response.status}），可稍后重试`;
  if (!response.text.trim()) return '站点没有返回可解析的内容，请在站点窗口搜索后读取';
}

const patterns: Record<BookSource['adapter'], RegExp> = {
  youshu: /\/book\/\d+\/?$/, qidian: /(?:\/book\/\d+\/?$|\/info\/\d+)/, zongheng: /(?:\/book\/\d+(?:\.html)?$|\/detail\/\d+)/,
  linovelib: /\/novel\/\d+\.html$/, novelia: /\/(?:novel\/[^/]+\/[^/]+|wenku\/[^/]+)\/?$/, nlc: /\/search\/showDocDetails/, generic: /\/(?:book|novel|info|detail|books)\//i,
  fanqie: /\/page\/\d+\/?$/, ciweimao: /\/book\/\d+\/?$/,
};

export function parseSearch(source: BookSource, response: SourceResponse): SearchPage {
  const doc = docFor(response.text); const problem = pageProblem(response, doc);
  if (problem) return { books: [], hasNext: false, message: problem, needsBrowser: true, issue: problem.includes('登录') ? 'login' : problem.includes('验证') ? 'verification' : 'unavailable' };
  if (source.adapter === 'fanqie' && /^\s*\{/.test(response.text)) {
    const data = JSON.parse(response.text); const list = data?.data?.search_book_data_list;
    if (data.code !== 0 || !Array.isArray(list)) return { books:[],hasNext:false,needsBrowser:true,issue:'unavailable',message:'番茄搜索暂未返回有效数据，可打开官网重试；这不代表没有相关书籍' };
    const seen = new Set<string>();
    const books: RemoteBook[] = list.slice(0,100).flatMap((b:Record<string,unknown>) => {
      const id = String(b?.book_id || '');
      if (!/^\d{1,30}$/.test(id) || (typeof b.book_id === 'number' && !Number.isSafeInteger(b.book_id)) || seen.has(id)) return [];
      const title = plain(b.book_name,1000); if (!title) return []; seen.add(id);
      const cover = typeof b.thumb_url === 'string' ? b.thumb_url : '';
      const coverUrl = safeUrl(cover,source.homepage) && /^(?:https?:)?\/\//.test(cover) ? safeUrl(cover,source.homepage) : /^[\w/-]+$/.test(cover) ? `https://p1-tt.byteimg.com/origin/${cover}` : undefined;
      return [{ sourceId:source.id,sourceName:source.name,url:new URL(`/page/${id}`,source.homepage).href,title,author:plain(b.author,1000) || '作者未提供',description:plain(b.book_abstract),coverUrl,tags:[b.creation_status === '1' || b.creation_status === 1 ? '已完结' : b.creation_status === '0' || b.creation_status === 0 ? '连载中' : '',...plain(b.category,800).split(/[,/]/)].filter(Boolean).slice(0,10) }];
    });
    const params = new URL(response.url).searchParams;
    const page = Number(params.get('page_index') || 0), size = Number(params.get('page_count') || 10);
    if (list.length && !books.length) return { books,hasNext:false,needsBrowser:true,issue:'unrecognized',message:'番茄返回的书目格式发生变化，请在站点窗口查看' };
    return { books,hasNext:books.length > 0 && (page + 1) * size < Number(data.data.total_count),message:books.length ? undefined : '没有找到相关书籍，可以换一个书名或作者' };
  }
  if (source.adapter === 'novelia' && /^\s*\{/.test(response.text)) {
    const data = JSON.parse(response.text);
    if (!Array.isArray(data.items)) return { books:[],hasNext:false,needsBrowser:true,issue:'unrecognized',message:'站点未返回有效的书目，请在站点窗口查看' };
    const books: RemoteBook[] = data.items.slice(0,100).filter((b:Record<string,unknown>) => typeof b.providerId === 'string' && typeof b.novelId === 'string').map((b:Record<string,unknown>) => ({ sourceId:source.id,sourceName:source.name,url:new URL(`/novel/${encodeURIComponent(String(b.providerId))}/${encodeURIComponent(String(b.novelId))}`,source.homepage).href,title:plain(b.titleZh || b.titleJp,1000),author:Array.isArray(b.authors) ? b.authors.map(a=>plain(typeof a === 'string' ? a : a.name,1000)).filter(Boolean).join('、') || '作者未提供' : '作者未提供',description:plain(b.introductionZh || b.introductionJp),tags:Array.isArray(b.keywords) ? b.keywords.slice(0,10).map(k=>plain(k,80)) : undefined })).filter((b:RemoteBook)=>b.title);
    const page = Number(new URL(response.url).searchParams.get('page') || 0);
    return { books,hasNext:page + 1 < Number(data.pageNumber),message:books.length ? undefined : '没有找到相关书籍，可以换一个书名或作者' };
  }
  if (source.adapter === 'zongheng' && /^\s*\{/.test(response.text)) {
    const data = JSON.parse(response.text); const page = data?.data?.datas;
    if (data.code !== 0 || !Array.isArray(page?.list)) return { books: [], hasNext: false, message: '站点未返回有效的书目，请在站点窗口查看', needsBrowser: true };
    const books: RemoteBook[] = page.list.slice(0,100).filter((b: { bookId?: unknown }) => /^\d+$/.test(String(b.bookId))).map((b: Record<string, unknown>) => ({
      sourceId: source.id, sourceName: source.name, url: `https://book.zongheng.com/book/${b.bookId}.html`, title: plain(b.name,1000), author: plain(b.authorName,1000) || '作者未提供', description: plain(b.description), coverUrl: safeUrl(b.coverUrl ? `https://static.zongheng.com/upload/${String(b.coverUrl).replace(/^\/+/, '')}` : ''), tags: [plain(b.catePName,80), b.serialStatus === 0 ? '连载中' : '已完结'].filter(Boolean),
    })).filter((b: RemoteBook) => b.title);
    return { books, hasNext: Number(page.pageNo) * Number(page.pageSize || 20) < Number(page.total) };
  }
  doc.querySelectorAll('script,style,nav,header,footer').forEach(e => e.remove());
  const books: RemoteBook[] = []; const seen = new Set<string>();
  const selectors = source.selectors;
  const push = (item: Element, link: Element | null, title?: string) => {
    if (!link) return;
    let url = safeUrl(link.getAttribute('href'), response.url);
    if (source.adapter === 'nlc') {
      const detail = link.getAttribute('onclick')?.match(/makeDetailUrl\(this,\s*'([^']+)',\s*'(-?\d+)',\s*'([\w-]+)',\s*'([^']*)'/);
      if (detail) { const u = new URL(detail[1], response.url); u.search = new URLSearchParams({ docId: detail[2], dataSource: detail[3], query: detail[4] }).toString(); url = u.href; }
    }
    if (!url) return;
    const name = clean(title || link.textContent || link.querySelector('img')?.getAttribute('alt'), 1000);
    if (!name || /^(?:开始阅读|立即阅读|免费试读|书籍详情|查看详情|点击阅读|全文|封面)$/.test(name)) return;
    if (seen.has(remoteKey({ url }))) return;
    seen.add(remoteKey({ url }));
    const pick = (selector: string | undefined) => selector === ':scope' ? item : selector ? item.querySelector(selector) : null;
    const authorNode = pick(selectors?.author || (source.adapter === 'ciweimao' ? '.cnt > p > a[href*="/reader/"]' : '.author a, .author, .bookinfo a, .book-author, .book-mid-info .name, [itemprop="author"]'));
    const authorText = clean(authorNode?.textContent, 1000).replace(/^(?:作者|著者)[：:\s]+/, '');
    const tooltip = docFor(link.getAttribute('rel') || '').body.textContent || '';
    const nlcAuthor = [...item.querySelectorAll('.book_type')].find(e => /著者：/.test(e.textContent || ''))?.querySelector('.book_val')?.textContent;
    const image = pick(selectors?.cover || 'img');
    const description = clean(pick(selectors?.description || '.intro, .info, .book-intro, .book-intro-wrap, .se-result-infos > p, .book-describe, .summary, .desc')?.textContent);
    books.push({ sourceId: source.id, sourceName: source.name, url, title: name, author: clean(nlcAuthor || authorText || tooltip.match(/作者[：:]\s*(.*?)(?:评分|$)/)?.[1],1000) || '作者未提供', description, coverUrl: safeUrl(image?.getAttribute('data-original') || image?.getAttribute('data-src') || image?.getAttribute('src'), response.url), tags: source.adapter === 'nlc' ? [...item.querySelectorAll('.book_type')].slice(0,4).map(e => clean(e.textContent,180)) : undefined });
  };
  if (selectors?.item) {
    for (const item of [...doc.querySelectorAll(selectors.item)].slice(0,100)) {
      const link = selectors.link === ':scope' ? item : item.querySelector(selectors.link || 'a[href]');
      push(item, link, clean((selectors.title === ':scope' ? item : item.querySelector(selectors.title || 'a'))?.textContent));
    }
  } else {
    const links = source.adapter === 'nlc' ? doc.querySelectorAll('.book_name a[istitle]') : source.adapter === 'ciweimao' ? doc.querySelectorAll('li[data-book-id] .tit a[href]') : source.adapter === 'fanqie' ? doc.querySelectorAll('.search-book-item a[href]') : doc.querySelectorAll('a[href]');
    // Prefer titled text links over cover links; cover-only anchors often lack metadata.
    for (const link of [...links].sort((a,b) => Number(!!clean(b.textContent)) - Number(!!clean(a.textContent)))) {
      const href = safeUrl(link.getAttribute('href'), response.url);
      if (source.adapter !== 'nlc' && (!href || !patterns[source.adapter].test(new URL(href).pathname))) continue;
      const item = link.closest('.search-result-list, .book-img-text li, .bookbox, .book-box, .book-ol li, .book-li, .book_right, .book-mid-info, .book-info, .index_tpic_info, .n-list-item, .novel-item, .novel-card, tr, article, li') || link.parentElement?.parentElement || link;
      push(item, link); if (books.length >= 100) break;
    }
  }
  const next = selectors?.next ? doc.querySelector(selectors.next) : [...doc.querySelectorAll('a,button,[role="button"],.n-pagination-item--next')].find(e => (e.matches('a[rel="next"],.n-pagination-item--next') || /^(?:下一页|下页|Next|Go to next page|›|»|>|>>)$/i.test(clean(e.textContent) || e.getAttribute('aria-label') || e.getAttribute('title') || '')) && !e.matches('.disabled,[aria-disabled="true"],:disabled') && !e.closest('.n-pagination-item--disabled'));
  let nextUrl = safeUrl(next?.getAttribute('href'), response.url);
  if (!nextUrl && next && source.adapter === 'novelia') { const u = new URL(response.url);u.searchParams.set('page',String(Number(u.searchParams.get('page') || 1) + 1));nextUrl=u.href; }
  const hasNext = !!nextUrl || (source.adapter === 'nlc' && books.length >= 10 && !!next);
  if (!books.length) {
    // The official Fanqie page also shows its empty UI when the API fails.
    // Only a valid JSON search response can establish a genuine empty result.
    if (source.adapter === 'fanqie') return { books,hasNext:false,needsBrowser:true,issue:'unavailable',message:'番茄搜索暂未返回有效数据，可打开官网重试；这不代表没有相关书籍' };
    const text = clean(doc.body.textContent);
    const empty = /没有(?:找到|搜索到|任何|相关|符合)|暂无(?:搜索|相关|数据)|未找到|空列表|0\s*(?:条|本|部|个)\s*(?:结果|相关)|no results/i.test(text);
    return { books, hasNext: false, message: empty ? '没有找到相关书籍，可以换一个书名或作者' : '当前页面尚未识别到书目。可打开站点窗口，完成搜索后读取当前页', needsBrowser: !empty,issue:empty ? undefined : 'unrecognized' };
  }
  return { books, hasNext, nextUrl };
}

export function parseDetail(source: BookSource, response: SourceResponse, existing?: RemoteBook): RemoteBook {
  const doc = docFor(response.text); const problem = pageProblem(response, doc); if (problem) throw new Error(problem);
  doc.querySelectorAll('script,style').forEach(e => e.remove());
  const meta = (keys: string[]) => keys.map(k => doc.querySelector(`meta[property="${k}"],meta[name="${k}"]`)?.getAttribute('content')).find(Boolean);
  if (source.adapter === 'fanqie' && doc.querySelector('.page-header h1')) {
    return { sourceId:source.id,sourceName:source.name,url:safeUrl(response.url)!,title:clean(doc.querySelector('.page-header h1')?.textContent,1000),author:clean(doc.querySelector('.author-name-text')?.textContent,1000) || existing?.author || '作者未提供',description:clean(doc.querySelector('.page-abstract-content')?.textContent || existing?.description),coverUrl:safeUrl(doc.querySelector('.page-header .book-cover-img')?.getAttribute('src') || existing?.coverUrl,response.url),tags:[...doc.querySelectorAll('.page-header .info-label > span')].slice(0,10).map(e=>clean(e.textContent,80)) };
  }
  const heading = doc.querySelector('.book-info h1, .book-information h1, .book-info h2, .book-name, h1, .book_name');
  const title = clean(meta(['og:novel:book_name','og:title']) || heading?.textContent || existing?.title,1000);
  if (!title) throw new Error('未识别到书名，请在站点窗口打开书籍详情页再读取');
  const author = clean(meta(['og:novel:author','author']) || doc.querySelector('.book-author a, .author a, .au-name, [itemprop="author"]')?.textContent || existing?.author,1000) || '作者未提供';
  return { sourceId: source.id, sourceName: source.name, url: safeUrl(response.url)!, title, author, description: clean(meta(['og:description','description']) || doc.querySelector('#bookintro, #intro, .book-intro, .book-dec, .book-intro-wrap, .book-intro-text, .intro')?.textContent || existing?.description), coverUrl: safeUrl(meta(['og:image']) || doc.querySelector('.book-img img, .book-cover img, .book-img-box img')?.getAttribute('src') || existing?.coverUrl, response.url), tags: existing?.tags };
}
