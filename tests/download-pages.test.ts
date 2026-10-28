import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadProvider, SourceResponse } from '../src/types';
import { defaultDownloadProviders, downloadSearchUrl, matchesDownloadFormat, fileFromUrl, parseDownloadPage, parseWebsiteDownloadSearch, readDownloadPage, searchDownloadCatalog, validateDownloadProvider } from '../src/lib/downloads';

const provider:DownloadProvider={id:'custom',name:'下载库',homepage:'https://books.example/',searchUrl:'https://books.example/find?q={query}',kind:'site',adapter:'link',enabled:true};
const response=(text:string,url='https://books.example/find?q=Alice'):SourceResponse=>({text,url,status:200,contentType:'text/html'});
const query={title:'Alice',author:'',includeAuthor:false,format:'EPUB' as const};
const original=window.desktop;
afterEach(()=>{window.desktop=original;vi.restoreAllMocks();});
function transport(fn=vi.fn()){window.desktop={fetchSource:fn} as unknown as NonNullable<Window['desktop']>;return fn;}

describe('in-app download pages',()=>{
  it('reads RSS and actual Standard Ebooks, Shuge and Wikisource result structures',()=>{
    const rss='<rss><channel><item><title>Alice EPUB</title><link>https://books.example/alice.epub</link><description>A classic</description></item></channel></rss>';
    expect(parseWebsiteDownloadSearch(provider,response(rss)).books[0]).toMatchObject({title:'Alice EPUB',directFile:{format:'EPUB'}});
    const standard=defaultDownloadProviders.find(p=>p.id==='download-standard') || defaultDownloadProviders.find(p=>p.homepage.includes('standardebooks'))!;
    const markup='<li typeof="schema:Book"><a property="schema:url" href="/ebooks/alice"><img src="cover.jpg"></a><p><a property="schema:url" href="/ebooks/alice"><span property="schema:name">Alice</span></a></p><p class="author"><span property="schema:name">Lewis Carroll</span></p></li>';
    expect(parseWebsiteDownloadSearch(standard,response(markup,'https://standardebooks.org/ebooks?query=alice')).books[0]).toMatchObject({title:'Alice',author:'Lewis Carroll',url:'https://standardebooks.org/ebooks/alice'});
    const shuge=defaultDownloadProviders.find(p=>p.homepage.includes('shuge.org'))!;
    const shugeResult=parseWebsiteDownloadSearch(shuge,response('<article><header><h2 class="portfolio-grid-title entry-title"><a href="/view/hlm/">红楼梦图咏</a></h2></header></article><h2 class="entry-title"><a href="/2026/annual/">年度总结</a></h2><div class="pagination"><a href="/page/2/?s=红楼梦">›</a></div>',shuge.homepage));
    expect(shugeResult.books.map(b=>b.title)).toEqual(['红楼梦图咏']);expect(shugeResult.nextUrl).toContain('/page/2/');
    const wiki=defaultDownloadProviders.find(p=>p.homepage.includes('wikisource.org'))!;
    expect(parseWebsiteDownloadSearch(wiki,response('<li class="mw-search-result"><div class="mw-search-result-heading"><a href="/wiki/紅樓夢">紅樓夢</a></div><div class="searchresult">章回小说</div></li><a class="mw-nextlink" href="/w/index.php?offset=20">Next</a>',wiki.homepage)).books[0].summary).toBe('章回小说');
  });
  it('accepts an exact-title Wikisource redirect and keeps export gateways distinct from file description pages',()=>{
    const wiki=defaultDownloadProviders.find(p=>p.homepage.includes('wikisource.org'))!;
    const markup='<h1 id="firstHeading">红楼梦</h1><aside><li id="wikisource-download-epub"><a href="https://ws-export.wmcloud.org/?format=epub&amp;lang=zh&amp;page=紅樓夢">下载为EPUB</a></li></aside><main><div id="mw-content-text"><div class="mw-parser-output"><p>曹雪芹的章回小说。</p><a href="/wiki/File:原本.pdf">扫描版</a></div></div></main>';
    const page=response(markup,'https://zh.wikisource.org/wiki/红楼梦');
    expect(parseWebsiteDownloadSearch(wiki,page).books[0]).toMatchObject({title:'红楼梦'});
    const parsed=parseDownloadPage(page);expect(parsed.files).toEqual([]);expect(parsed.pages).toHaveLength(2);expect(parsed.pages?.[0].title).toBe('下载为EPUB');expect(parsed.description).toContain('曹雪芹');
  });
  it('unwraps search-engine redirects, deduplicates fragments and omits navigation or ads',()=>{
    const destination='https://books.example/alice',encoded='a1'+btoa(destination).replace(/=/g,'');
    const markup=`<nav><h3><a href="/nav">Navigation</a></h3></nav><div data-tuiguang="1"><h3><a href="/ad">Ad</a></h3></div><div class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=${encoded}">Alice</a></h2><div class="b_caption">Download a classic</div></div><h3><a href="${destination}#details">Duplicate</a></h3>`;
    const parsed=parseWebsiteDownloadSearch(provider,response(markup));expect(parsed.books).toHaveLength(1);expect(parsed.books[0]).toMatchObject({url:destination,summary:'Download a classic'});
    const google='<div><a href="/url?q=https%3A%2F%2Fbooks.example%2Fbook.pdf&amp;sa=U"><h3>Alice PDF</h3></a></div>';
    expect(parseWebsiteDownloadSearch(provider,response(google,'https://www.google.com/search?q=Alice')).books[0].directFile?.format).toBe('PDF');
    expect(parseWebsiteDownloadSearch(provider,response('<div class="result" mu="https://books.example/real"><h3><a href="https://www.baidu.com/link?url=opaque">Alice</a></h3></div>')).books[0].url).toBe('https://books.example/real');
  });
  it('supports custom selectors and same-origin pagination with backup validation',()=>{
    const custom={...provider,selectors:{item:'.entry',title:'.label',link:'a.file',description:'.synopsis',next:'.forward'}};
    expect(()=>validateDownloadProvider(custom)).not.toThrow();
    const markup='<section class="entry"><strong class="label">Alice</strong><a class="file" href="/book/1">Read</a><p class="synopsis">A story</p></section>';
    const result=parseWebsiteDownloadSearch(custom,response(markup+'<a class="forward" href="?page=2">More</a>'));
    expect(result.books[0]).toMatchObject({title:'Alice',summary:'A story',url:'https://books.example/book/1'});expect(result.nextUrl).toBe('https://books.example/find?page=2');
    expect(parseWebsiteDownloadSearch(custom,response(markup+'<a class="forward" href="https://other.example/next">More</a>')).nextUrl).toBeUndefined();
    expect(()=>validateDownloadProvider({...custom,selectors:{item:'['}})).toThrow('CSS');
  });
  it('extracts relative files and download gateways without treating executable links as books',()=>{
    const parsed=parseDownloadPage(response('<script>bad()</script><nav><a href="/nav.pdf">Nav PDF</a></nav><main><h1>Alice editions</h1><p>A readable description</p><a href="../files/alice.epub">EPUB</a><a href="/get?filename=alice.pdf">PDF</a><a href="/api/1" download="alice.txt">下载文本</a><a href="/file/2" type="application/pdf">PDF file</a><a href="/malware.exe" download="alice.epub">下载</a><a href="/download/next">下载页面</a><a href="javascript:alert(1)">PDF</a><a href="/login">登录下载</a><a href="../files/alice.epub">Duplicate</a></main>','https://books.example/book/1'));
    expect(parsed.files.map(f=>f.format)).toEqual(['EPUB','PDF','TXT','PDF']);expect(parsed.files[0].url).toBe('https://books.example/files/alice.epub');expect(parsed.files[0].referrer).toBe('https://books.example/book/1');
    expect(parsed.title).toBe('Alice editions');expect(parsed.description).not.toContain('bad()');
    expect(parsed.pages?.some(p=>p.url.endsWith('/download/next'))).toBe(true);
    // An executable must not be offered as a file, even when its download attribute lies.
    expect(parsed.files.some(f=>f.url.includes('.exe'))).toBe(false);
    expect(fileFromUrl('file:///C:/private.txt')).toBeUndefined();expect(fileFromUrl('https://books.example/file.zip','Book.epub')?.format).toBe('ZIP');
  });
  it('distinguishes a valid empty result from broken markup and login or verification gates',()=>{
    expect(parseWebsiteDownloadSearch(provider,response('<p>No results found.</p>')).books).toEqual([]);
    for(const body of ['<h1>Unrecognized layout</h1>','<title>Just a moment</title>','<title>用户登录</title>','<div class="g-recaptcha"></div>'])expect(()=>parseWebsiteDownloadSearch(provider,response(body))).toThrow();
    expect(()=>parseDownloadPage({...response('<main>Forbidden</main>'),status:403})).toThrow('限制访问');
    expect(parseDownloadPage(response('<main><h1>Alice</h1><p>Read online only</p></main>')).message).toContain('没有可直接下载');
  });
  it('falls back to rendered search results, filters irrelevant engine results and preserves cancellation',async()=>{
    const fetch=transport(vi.fn().mockResolvedValueOnce(response('<rss><channel><item><title>Unrelated</title><link>https://books.example/other</link></item></channel></rss>')).mockResolvedValueOnce(response('<div class="b_algo"><h2><a href="https://books.example/alice">Alice EPUB</a></h2></div>')));
    const bing=defaultDownloadProviders.find(p=>p.id==='download-bing')!;
    expect((await searchDownloadCatalog(bing,query)).books).toHaveLength(1);expect(new URL(fetch.mock.calls[0][0].url).searchParams.get('format')).toBe('rss');expect(fetch.mock.calls[1][0].render).toBe(true);
    fetch.mockReset().mockResolvedValue({...response('Forbidden'),status:403});await expect(searchDownloadCatalog(bing,query)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
    const controller=new AbortController();fetch.mockReset().mockImplementation(async()=>{controller.abort();return response('<h3><a href="/alice">Alice</a></h3>');});
    await expect(searchDownloadCatalog(provider,query,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reads a chosen gateway in app and avoids fetching a known binary through the HTML transport',async()=>{
    const fetch=transport(vi.fn().mockResolvedValue(response('<main><h1>Alice</h1><a href="/files/alice.epub">Download</a></main>','https://books.example/gateway')));
    expect((await readDownloadPage('https://books.example/gateway')).files[0].format).toBe('EPUB');
    expect((await readDownloadPage('https://books.example/alice.pdf')).files[0].format).toBe('PDF');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('finds a download block outside the first article on a page-builder book detail',()=>{
    const markup='<div id="main"><article class="article-icon-entry"><h3>刊印信息</h3><p>原版藏本</p></article><div class="entry-content-wrapper"><a href="https://s.shuge.org/hlmty">下载链接</a></div><div id="footer"><a href="/download/unrelated">其他下载</a></div></div>';
    const parsed=parseDownloadPage(response(markup,'https://www.shuge.org/view/hong_lou_meng_tu_yong/'));
    expect(parsed.pages).toEqual([{url:'https://s.shuge.org/hlmty',title:'下载链接'}]);
  });
  it('finds archives in links, file query parameters, download names and MIME-only endpoints',()=>{
    const parsed=parseDownloadPage(response('<main><a href="/book.zip">ZIP</a><a href="/get?filename=book.rar">RAR</a><a href="/api" download="book.7z">7Z</a><a href="/opaque" type="application/zip">下载压缩包</a><a href="/setup.exe" download="book.zip">安装程序</a></main>'));
    expect(parsed.files.map(f=>f.format)).toEqual(['ZIP','RAR','7Z','ZIP']);
    expect(fileFromUrl('https://books.example/archive','', 'application/vnd.rar')?.format).toBe('RAR');expect(fileFromUrl('https://books.example/archive','', 'application/x-7z-compressed')?.format).toBe('7Z');
    expect(parsed.files.filter(f=>matchesDownloadFormat(f.format,'archive'))).toHaveLength(4);expect(parsed.files.filter(f=>matchesDownloadFormat(f.format,'ZIP'))).toHaveLength(2);expect(matchesDownloadFormat('EPUB','archive')).toBe(false);
    const bing=defaultDownloadProviders.find(p=>p.id==='download-bing')!;expect(new URL(downloadSearchUrl(bing,{...query,format:'archive'})).searchParams.get('q')).toContain('压缩包');
    expect(parseDownloadPage({...response(''),download:{name:'book.7z',format:'7Z'}}).files[0].format).toBe('7Z');
  });

});
