import { describe, expect, it, vi } from 'vitest';
import { defaultSources, migrateSources, migrateSourceState, parseSearch, parseDetail, publicIndexUrl, safeUrl, searchRequest, searchSource, validateSource } from '../src/lib/sources';
import { sameReadingLocation } from '../src/lib/bookmarks';
import { validateState } from '../src/lib/backup';
import { initialState } from '../src/lib/samples';
import type { BookSource, SourceResponse } from '../src/types';

const source = (id: string) => structuredClone(defaultSources.find(s => s.id === id)!);
const response = (text: string, url = 'https://books.example/search', status = 200): SourceResponse => ({ text, url, status, contentType: 'text/html' });
describe('book search adapters', () => {
  it('accepts all built-in templates, encoding query and page exactly once', () => {
    for (const s of defaultSources) validateSource(s);
    const request = searchRequest(source('youshu'),'书 & A+B',2);
    expect(new URLSearchParams(request.body).get('searchkey')).toBe('书 & A+B');
    expect(new URL(searchRequest(source('zongheng'),'剑',2).url).searchParams.get('pageNo')).toBe('2');
    const api = new URL(searchRequest(source('novelia'),'魔女 & +',1).url);
    expect(api.pathname).toBe('/api/novel');expect(api.searchParams.get('page')).toBe('0');expect(api.searchParams.get('query')).toBe('魔女 & +');
    expect(new URL(searchRequest(source('novelia'),'魔女',2,true).url).searchParams.get('page')).toBe('2');
    const post={...source('youshu'),browseUrl:'https://books.example/search?q={query}'};
    expect(searchRequest(post,'书',1,true)).toMatchObject({method:'GET',body:undefined});
  });
  it('upgrades old built-ins without restoring deleted sources or overriding customization',()=>{
    const legacy={...source('novelia'),revision:undefined,searchMode:undefined,browseUrl:undefined,searchUrl:'https://n.novelia.cc/novel?query={query}&page={page}',enabled:false,name:'我的 Novelia'};
    expect(migrateSources([legacy])).toEqual([{...legacy,revision:2,searchMode:'browser',searchUrl:source('novelia').searchUrl,browseUrl:source('novelia').browseUrl}]);
    const custom={...legacy,searchUrl:'https://custom.example/?q={query}'};
    expect(migrateSources([custom])).toEqual([custom]);expect(migrateSources([])).toEqual([]);
    expect(migrateSources(migrateSources([legacy]))).toEqual(migrateSources([legacy]));
  });
  it('parses Novelia API results with zero-based pagination and plain titles',()=>{
    const data={pageNumber:2,items:[{providerId:'syosetu',novelId:'n123',titleZh:'魔女<b>之旅</b>',titleJp:'original',authors:[{name:'作者甲'}],introductionZh:'<p>简介</p>'}]};
    const first=parseSearch(source('novelia'),response(JSON.stringify(data),'https://n.novelia.cc/api/novel?page=0'));
    expect(first.books[0]).toMatchObject({title:'魔女之旅',author:'作者甲',description:'简介',url:'https://n.novelia.cc/novel/syosetu/n123'});expect(first.hasNext).toBe(true);
    expect(parseSearch(source('novelia'),response(JSON.stringify(data),'https://n.novelia.cc/api/novel?page=1')).hasNext).toBe(false);
    expect(parseSearch(source('novelia'),response('{"message":"游客没有权限执行此操作"}','https://n.novelia.cc/api/novel',401))).toMatchObject({issue:'login',needsBrowser:true,books:[]});
  });
  it('adds the new catalog entries once and preserves deletions, disabled sources and custom settings',()=>{
    const old={...structuredClone(initialState),sources:[{...source('qidian'),enabled:false,searchUrl:'https://custom.example/?q={query}'}]};
    const migrated=migrateSourceState(old);
    expect(migrated.sources?.map(s=>s.id)).toEqual(['qidian','fanqie','ciweimao']);
    expect(migrated.sources?.[0]).toEqual(old.sources[0]);expect(old.sources).toHaveLength(1);
    const deleted={...migrated,sources:migrated.sources?.filter(s=>s.id!=='fanqie')};
    expect(migrateSourceState(deleted)).toEqual(deleted);validateState(deleted);
    expect(migrateSourceState({...old,sources:[]}).sources?.map(s=>s.id)).toEqual(['fanqie','ciweimao']);
    expect(migrateSourceState(structuredClone(initialState)).sources).toHaveLength(8);
    const full={...old,sources:Array.from({length:50},(_,i)=>({...source('qidian'),id:`custom-${i}`,builtin:false}))};
    expect(migrateSourceState(full).sources).toHaveLength(50);
    expect(()=>validateState({...old,sourceCatalogVersion:-1})).toThrow();
  });
  it('builds Fanqie and Ciweimao requests without double-encoding path queries',()=>{
    const query='魔女 / A+B &';
    const api=new URL(searchRequest(source('fanqie'),query,2).url);
    expect(api.searchParams.get('query_word')).toBe(query);expect(api.searchParams.get('page_index')).toBe('1');
    expect(decodeURIComponent(new URL(searchRequest(source('fanqie'),query,1,true).url).pathname)).toBe('/search/'+query);
    const cat=new URL(searchRequest(source('ciweimao'),query,2).url);
    expect(decodeURIComponent(cat.pathname.split('/')[4])).toBe(query);expect(cat.pathname.endsWith('/2')).toBe(true);
  });
  it('reads Fanqie public API books, large string IDs and pagination without including unsafe metadata',()=>{
    const book={book_id:'7069948840148732967',book_name:'<b>魔女</b>之旅',author:'作者甲',book_abstract:'<p>故事简介</p>',thumb_url:'novel-static/cover',category:'奇幻,冒险',creation_status:'1'};
    const data={code:0,data:{total_count:11,search_book_data_list:[book,book,{...book,book_id:7069948840148732967},{...book,book_id:'2',thumb_url:'javascript:alert(1)'}]}};
    const parsed=parseSearch(source('fanqie'),response(JSON.stringify(data),searchRequest(source('fanqie'),'魔女').url));
    expect(parsed.books).toHaveLength(2);expect(parsed.books[0]).toMatchObject({title:'魔女之旅',author:'作者甲',description:'故事简介',url:'https://fanqienovel.com/page/7069948840148732967',coverUrl:'https://p1-tt.byteimg.com/origin/novel-static/cover',tags:['已完结','奇幻','冒险']});
    expect(parsed.books[1].coverUrl).toBeUndefined();expect(parsed.hasNext).toBe(true);
    expect(parseSearch(source('fanqie'),response(JSON.stringify(data),searchRequest(source('fanqie'),'魔女',2).url)).hasNext).toBe(false);
  });
  it('does not turn Fanqie network failures or its fallback empty UI into a successful empty search',()=>{
    const s=source('fanqie');
    for(const text of ['',JSON.stringify({code:-100}),'<div class="muye-search-empty">没有搜索到相关结果</div>']) expect(parseSearch(s,response(text))).toMatchObject({books:[],hasNext:false,needsBrowser:true});
    expect(parseSearch(s,response('{"code":0,"data":{"total_count":0,"search_book_data_list":[]}}'))).toMatchObject({books:[],hasNext:false,message:'没有找到相关书籍，可以换一个书名或作者'});
  });
  it('does not interpret login phrases inside a novel synopsis as an API login error',()=>{
    const data={code:0,data:{total_count:1,search_book_data_list:[{book_id:'123',book_name:'虚拟世界',author:'作者',book_abstract:'游戏提示：请先登录后进入世界。'}]}};
    expect(parseSearch(source('fanqie'),response(JSON.stringify(data))).books).toHaveLength(1);
    expect(parseSearch(source('fanqie'),response('{"code":-1,"message":"请先登录后搜索"}'))).toMatchObject({issue:'login',needsBrowser:true});
  });
  it('does not replace a failed Fanqie second page with the web first page',async()=>{
    const previous=window.desktop;
    const fetch=vi.fn(async()=>response('{"code":-100}',searchRequest(source('fanqie'),'魔女',2).url));
    window.desktop={fetchSource:fetch} as unknown as Window['desktop'];
    try {
      expect(await searchSource(source('fanqie'),'魔女',2)).toMatchObject({books:[],hasNext:false,needsBrowser:true,message:'番茄下一页暂时无法自动读取，请在站点窗口翻页后点击「读取搜索结果」'});
      expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0]).toHaveLength(1);
    } finally {window.desktop=previous;}
  });
  it('reads Ciweimao result cards and rel=next while excluding sidebar recommendations',()=>{
    const html='<header>用户登录<input type="password"></header><aside><a href="/book/99">推荐书</a></aside><ul><li data-book-id="100"><a class="cover" href="/book/100"><img src="/cover.jpg"></a><div class="cnt"><p class="tit"><a href="/book/100">魔女日记</a></p><p>小说作者：<a href="/reader/2">作者乙</a></p><div class="desc">简介</div></div><a href="/book/100">点击阅读</a></li></ul><a rel="next" href="/get-search-book-list/0-0-0-0-0-0/全部/魔女/2">&gt;&gt;</a>';
    const parsed=parseSearch(source('ciweimao'),response(html,searchRequest(source('ciweimao'),'魔女').url));
    expect(parsed.books).toHaveLength(1);expect(parsed.books[0]).toMatchObject({title:'魔女日记',author:'作者乙',description:'简介',coverUrl:'https://www.ciweimao.com/cover.jpg'});expect(parsed.hasNext).toBe(true);expect(parsed.nextUrl).toContain('/2');
    expect(parseSearch(source('ciweimao'),response(html.replace('rel="next"','rel="next" class="disabled"'))).hasNext).toBe(false);
  });
  it('reads Fanqie full detail text instead of its shortened SEO description',()=>{
    const html='<meta name="description" content="网站宣传和简介摘要"><div class="page-header"><h1>远行</h1><span class="author-name-text">作者丙</span><img class="book-cover-img" src="//img.example/cover.jpg"><div class="info-label"><span>已完结</span><span>奇幻</span></div></div><div class="page-abstract-content"><p>完整故事简介</p></div>';
    expect(parseDetail(source('fanqie'),response(html,'https://fanqienovel.com/page/123'))).toMatchObject({title:'远行',author:'作者丙',description:'完整故事简介',coverUrl:'https://img.example/cover.jpg',tags:['已完结','奇幻']});
  });
  it('offers a clearly separate public index query for Youshu',()=>{
    const url=new URL(publicIndexUrl(source('youshu'),'诡秘 & +'));
    expect(url.origin).toBe('https://www.bing.com');expect(url.searchParams.get('q')).toBe('site:youshu.me/book/ 诡秘 & +');
  });
  it('reads SPA pagination buttons without treating a disabled next button as a link',()=>{
    const html='<article><a href="/novel/syosetu/n123">魔女</a></article>';
    const first=parseSearch(source('novelia'),response(html+'<button aria-label="下一页"><svg/></button>','https://n.novelia.cc/novel?query=魔女&page=1'));
    expect(new URL(first.nextUrl!).searchParams.get('page')).toBe('2');
    expect(parseSearch(source('novelia'),response(html+'<button disabled aria-label="下一页"/>')).hasNext).toBe(false);
  });
  it('does not mistake the header login form for a protected search page',()=>{
    const html='<header><form>用户登录<input type="password"/></form></header><article><a href="/book/123">秋日</a></article>';
    expect(parseSearch(source('youshu'),response(html)).books).toHaveLength(1);
    expect(parseSearch(source('youshu'),{...response('<p>请先登录后搜索</p>'),rendered:true,access:'login'})).toMatchObject({issue:'login',books:[]});
  });
  it('parses the public Zongheng JSON schema, strips markup and builds covers', () => {
    const result = parseSearch(source('zongheng'), response(JSON.stringify({ code:0,data:{datas:{pageNo:1,pageSize:20,total:21,list:[{bookId:123,name:'秋<font color="red">剑</font>',authorName:'作者甲',description:'<b>一段简介</b>',coverUrl:'/cover/xx.jpg',serialStatus:0,catePName:'仙侠'}]}}})));
    expect(result.books[0]).toMatchObject({ title:'秋剑',author:'作者甲',url:'https://book.zongheng.com/book/123.html',coverUrl:'https://static.zongheng.com/upload/cover/xx.jpg' });
    expect(result.hasNext).toBe(true);
  });
  it('parses NLC catalog links without executing the page onclick code', () => {
    const result = parseSearch(source('nlc'),response(`<div class="book_right"><div class="book_name"><a istitle="true" href="javascript:void(0)" onclick="makeDetailUrl(this, '/search/showDocDetails?', '-123', 'ucs01', '秋');">秋日书简</a></div><div class="book_type">著者：<span class="book_val">作者乙</span></div></div>`,'http://find.nlc.cn/search/doSearch?query=秋'));
    expect(result.books).toHaveLength(1);expect(result.books[0].author).toBe('作者乙');
    expect(new URL(result.books[0].url).searchParams.get('docId')).toBe('-123');
  });
  it.each([
    ['youshu','/book/123'], ['qidian','/book/123/'],['zongheng','/book/123.html'],['linovelib','/novel/123.html'],['novelia','/novel/syosetu/n123'],
  ])('reads %s book links from a rendered result page', (adapter, url) => {
    const parsed = parseSearch(source(adapter),response(`<article><a href="${url}"><img alt="一段故事" src="/cover.jpg"></a><h3><a href="${url}">一段故事</a></h3><div class="author">作者：作者丙</div><p class="intro">简介</p><a href="javascript:alert(1)">坏链接</a></article>`));
    expect(parsed.books).toHaveLength(1);expect(parsed.books[0]).toMatchObject({title:'一段故事',author:'作者丙',description:'简介',coverUrl:'https://books.example/cover.jpg'});
  });
  it('supports custom selectors, relative URLs and pagination', () => {
    const s:BookSource={...source('youshu'),adapter:'generic',selectors:{item:'.result',title:'h3',link:'h3 a',author:'.by',description:'.summary',cover:'img',next:'.next'}};
    const parsed=parseSearch(s,response('<div class="result"><h3><a href="/work/42">窗前</a></h3><span class="by">作者丁</span><p class="summary">一篇故事</p><img data-src="//images.example/42.png"></div><a class="next" href="?page=2">下一页</a>'));
    expect(parsed.books[0]).toMatchObject({title:'窗前',author:'作者丁',url:'https://books.example/work/42',coverUrl:'https://images.example/42.png'});expect(parsed.nextUrl).toBe('https://books.example/search?page=2');
  });
  it('distinguishes login, challenges, empty results and JavaScript-only pages', () => {
    expect(parseSearch(source('qidian'),response('<script src="/xx/probe.js"></script>','https://qidian.com',202)).needsBrowser).toBe(true);
    expect(parseSearch(source('youshu'),response('<title>用户登录</title>','https://www.youshu.me/login.php')).message).toContain('登录');
    expect(parseSearch(source('novelia'),response('<div id="app"></div><noscript>启用JavaScript</noscript>')).needsBrowser).toBe(true);
    expect(parseSearch(source('linovelib'),response('<p>没有找到相关书籍</p>')).needsBrowser).toBe(false);
  });
  it('rejects executable URLs and invalid source selectors', () => {
    for(const url of ['javascript:alert(1)','file:///C:/secret','https://user:password@books.example/']) expect(safeUrl(url)).toBeUndefined();
    expect(()=>validateSource({...source('youshu'),searchUrl:'https://a.example/',body:''})).toThrow('query');
    expect(()=>validateSource({...source('youshu'),selectors:{item:'['}})).toThrow('选择器');
  });
  it('reads detail metadata as plain text and rejects untrusted image protocols', () => {
    const detail=parseDetail(source('linovelib'),response('<meta property="og:title" content="秋日"><meta property="og:novel:author" content="作者戊"><meta property="og:description" content="故事简介"><meta property="og:image" content="javascript:alert(1)">','https://www.linovelib.com/novel/123.html'));
    expect(detail).toMatchObject({title:'秋日',author:'作者戊',description:'故事简介',coverUrl:undefined});
  });
  it('keeps older backups valid and validates new online books and sources', () => {
    const old=structuredClone(initialState);validateState(old);
    old.sources=structuredClone(defaultSources);old.books[0].favorite=false;old.searchHistory=['秋日'];validateState(old);
    old.books[0].online={title:'秋日',author:'作者',description:'',sourceId:'test',sourceName:'测试',url:'file:///C:/book'};expect(()=>validateState(old)).toThrow();
  });
});
describe('bookmark positions',()=>{
  it('recognizes small scroll restoration rounding without matching another chapter or PDF page',()=>{
    expect(sameReadingLocation('text:2:0.5000','text:2:0.5007')).toBe(true);
    expect(sameReadingLocation('text:1:0.5','text:2:0.5')).toBe(false);
    expect(sameReadingLocation('pdf:1','pdf:2')).toBe(false);
    expect(sameReadingLocation('','')).toBe(false);
  });
});
