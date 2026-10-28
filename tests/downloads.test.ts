import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadProvider, SourceResponse } from '../src/types';
import { defaultDownloadProviders, downloadSearchUrl, downloadTarget, migrateDownloadState, parseDownloadFiles, parseDownloadSearch, resolveDownloadFiles, searchDownloadCatalog, validateDownloadProvider, type DownloadCandidate, type DownloadQuery } from '../src/lib/downloads';
import { initialState } from '../src/lib/samples';
import { validateState } from '../src/lib/backup';

const archive = defaultDownloadProviders[0], gutenberg = defaultDownloadProviders[1];
const query:DownloadQuery = {title:'红楼梦 & "书" +',author:'曹雪芹',includeAuthor:true,format:'EPUB'};
const candidate:DownloadCandidate = {id:'novel_123',providerId:archive.id,title:'红楼梦',author:'曹雪芹',summary:'',url:'https://archive.org/details/novel_123'};
const response = (data:unknown, url='https://archive.org/advancedsearch.php?q=red&page=1'):SourceResponse => ({url,text:typeof data==='string'?data:JSON.stringify(data),status:200,contentType:'application/json'});
const list = (docs:unknown[]=[],numFound=docs.length) => ({response:{numFound,docs}});
const originalDesktop = window.desktop;
afterEach(()=>{window.desktop=originalDesktop;vi.restoreAllMocks();});
function desktop(fetchSource = vi.fn()) {window.desktop={fetchSource,openExternal:vi.fn().mockResolvedValue(undefined)} as unknown as NonNullable<Window['desktop']>;return fetchSource;}

describe('download discovery',()=>{
  it('initializes old libraries once while keeping removed and custom sites on restore',()=>{
    const migrated=migrateDownloadState(structuredClone(initialState));
    expect(migrated.downloadProviders).toHaveLength(8);
    for(const provider of migrated.downloadProviders!) expect(()=>validateDownloadProvider(provider)).not.toThrow();
    const empty={...migrated,downloadProviders:[]};expect(migrateDownloadState(empty)).toBe(empty);
    const custom={...migrated,downloadProviders:[{...defaultDownloadProviders[2],enabled:false}]};expect(migrateDownloadState(custom)).toBe(custom);
    expect(()=>validateState(custom)).not.toThrow();
    expect(()=>validateState({...custom,downloadProviders:[...custom.downloadProviders,...custom.downloadProviders]})).toThrow();
  });
  it('encodes title, author and format without turning keywords into URL parameters',()=>{
    const bing=new URL(downloadSearchUrl(defaultDownloadProviders[2],query));
    expect(bing.searchParams.get('q')).toBe('红楼梦 & "书" + 曹雪芹 EPUB 下载');expect([...bing.searchParams]).toHaveLength(1);
    const custom:DownloadProvider={...defaultDownloadProviders[5],searchUrl:'https://example.org/find/{title}?author={author}&format={format}&q={query}'};
    const url=new URL(downloadSearchUrl(custom,query));expect(decodeURIComponent(url.pathname)).toBe('/find/红楼梦 & "书" +');expect(url.searchParams.get('q')).toBe('红楼梦 & "书" + 曹雪芹');expect(url.searchParams.get('format')).toBe('EPUB');
    expect(new URL(downloadSearchUrl(custom,{...query,includeAuthor:false,format:'all'})).searchParams.get('author')).toBe('');
    expect(new URL(downloadSearchUrl(gutenberg,query)).searchParams.get('query')).not.toContain('EPUB');
  });
  it('rejects unsafe, ambiguous, and non-official automatic catalog configurations',()=>{
    for(const searchUrl of ['javascript:alert("{query}")','https://user:pass@example.org/?q={query}','https://example.org/search','https://example.org/?q={unknown}','https://{query}.example.org/']) expect(()=>validateDownloadProvider({...defaultDownloadProviders[2],searchUrl})).toThrow();
    expect(()=>validateDownloadProvider({...archive,homepage:'https://example.org/'})).toThrow();
    expect(()=>validateDownloadProvider({...archive,searchUrl:'https://evil.org/?q={query}'})).toThrow();
    expect(()=>validateState({...initialState,downloadProviders:[{...archive,enabled:'yes'}]})).toThrow();
  });
  it('binds downloaded replacements to real local works',()=>{const book={...initialState.books[0],sample:false};expect(downloadTarget(book).bookId).toBe(book.id);});
  it('normalizes unknown authors and preserves original book links',()=>{
    const book={...initialState.books[0],author:'作者未提供',sourceUrl:'https://example.org/book'};
    expect(downloadTarget(book)).toEqual({title:book.title,author:'',url:book.sourceUrl,sourceName:undefined});
  });
  it('parses Archive metadata arrays, sanitizes descriptions, deduplicates and paginates',()=>{
    const parsed=parseDownloadSearch(archive,response(list([{identifier:'book-1',title:'<b>红楼梦</b>',creator:['曹雪芹','高鹗'],description:'<img src=x>简介'},{identifier:'book-1',title:'重复'},{identifier:'../escape',title:'无效'},{identifier:'book-2',title:'借阅本','access-restricted-item':'true'}],22)));
    expect(parsed.books).toHaveLength(2);expect(parsed.books[0]).toMatchObject({title:'红楼梦',author:'曹雪芹 · 高鹗',summary:'简介'});expect(parsed.books[1].restricted).toBe(true);
    expect(new URL(parsed.nextUrl!).searchParams.get('page')).toBe('2');
  });
  it('distinguishes an empty catalog from login, rate limiting, redirects, malformed and empty bodies',()=>{
    expect(parseDownloadSearch(archive,response(list())).books).toEqual([]);
    for(const bad of [response(''),response('<h1>service unavailable</h1>'),response({error:'failed'}),response({response:{docs:[]}}),{...response(list()),status:403},{...response(list()),status:401},response(list(),'https://other.org/')]) expect(()=>parseDownloadSearch(archive,bad)).toThrow();
  });
  it('reads actual Gutenberg search markup and accepts only forward pagination on the same query',()=>{
    const url='https://www.gutenberg.org/ebooks/search/?query=紅樓夢';
    const markup='<li class="booklink"><a class="link" href="/ebooks/24264"><span class="title">紅樓夢 (Chinese)</span><span class="subtitle">Xueqin Cao</span><span class="extra">100 downloads</span></a></li>';
    const parsed=parseDownloadSearch(gutenberg,response('<title>Books: Sign In - Project Gutenberg</title>'+markup+'<a accesskey="+" href="/ebooks/search/?query=紅樓夢&amp;start_index=26">Next</a>',url));
    expect(parsed.books[0]).toMatchObject({id:'24264',author:'Xueqin Cao',title:'紅樓夢 (Chinese)'});expect(parsed.nextUrl).toContain('start_index=26');
    for(const next of ['https://evil.org/ebooks/search/?query=紅樓夢&start_index=26','/ebooks/search/?query=other&start_index=26','/ebooks/search/?query=紅樓夢&start_index=1']) expect(parseDownloadSearch(gutenberg,response(markup+`<a accesskey="+" href="${next}">Next</a>`,url)).nextUrl).toBeUndefined();
    expect(parseDownloadSearch(gutenberg,response('<div class="results">No records found.</div>',url)).books).toEqual([]);
    expect(()=>parseDownloadSearch(gutenberg,response('<h1>new page layout</h1>',url))).toThrow();
  });
  it('exposes only actual public ebook files from Archive and encodes path segments',()=>{
    const parsed=parseDownloadFiles(archive,candidate,response({metadata:{identifier:candidate.id,rights:'Public domain'},files:[
      {name:'中文/红楼梦 & 第一册.epub',format:'EPUB',size:'1048576'},
      {name:'novel_djvu.txt',format:'DjVuTXT',size:'2048'},
      {name:'private.pdf',private:'true'}, {name:'locked.pdf',format:'Encrypted Adobe PDF'},
      {name:'../escape.txt'},{name:'nested/../escape.pdf'},{name:'C:\\test.pdf'},
      {name:'not-a-book.xml',format:'Metadata'},{name:'scan_jp2.zip'},{name:'novel_djvu.txt'},
    ]},'https://archive.org/metadata/novel_123'));
    expect(parsed.files).toHaveLength(3);expect(parsed.files.map(f=>f.format)).toEqual(['EPUB','TXT','ZIP']);expect(parsed.files[0].size).toBe('1.0 MB');expect(parsed.files[0].url).toBe('https://archive.org/download/novel_123/%E4%B8%AD%E6%96%87/%E7%BA%A2%E6%A5%BC%E6%A2%A6%20%26%20%E7%AC%AC%E4%B8%80%E5%86%8C.epub');expect(parsed.rights).toBe('Public domain');
  });
  it('does not promote private, restricted or unavailable items to downloads',()=>{
    for(const data of [{is_dark:true},{metadata:{'access-restricted-item':'true'}},{item_access:{is_restricted:true}}]){const parsed=parseDownloadFiles(archive,candidate,response({...data,files:[{name:'novel.pdf'}]}));expect(parsed.files).toEqual([]);expect(parsed.message).toContain('限制');}
    expect(parseDownloadFiles(archive,{...candidate,restricted:true},response({files:[{name:'novel.pdf'}]})).files).toEqual([]);
    expect(()=>parseDownloadFiles(archive,candidate,response({files:[{name:'novel.pdf'}],metadata:{identifier:'another-book'}}))).toThrow();
    expect(()=>parseDownloadFiles(archive,candidate,response({}))).toThrow();
    expect(parseDownloadFiles(archive,candidate,response({files:[]})).message).toContain('未提供');
  });
  it('reads modern and legacy Gutenberg formats without cloud-send, foreign or unrelated links',()=>{
    const book={...candidate,id:'24264',providerId:gutenberg.id,url:'https://www.gutenberg.org/ebooks/24264'};
    const markup='<h1>紅樓夢</h1><div class="featured-format-row"><a href="/ebooks/24264.epub3.images">EPUB3</a><span class="featured-format-size">1.2 MB</span><a href="/ebooks/send/gdrive/24264.epub3.images">Send</a></div><div class="other-format-row"><a href="/ebooks/24264.txt.utf-8">Plain Text</a><span class="other-format-size">2 MB</span></div><table><tr><td><a href="/files/24264/book.pdf">PDF</a></td><td>5 MB</td></tr></table><a href="/ebooks/100.epub.images">Other book</a><a href="https://evil.org/ebooks/24264.txt.utf-8">Outside</a><a href="javascript:alert(1)">Unsafe</a><a href="/ebooks/24264.epub3.images">Repeated</a>';
    const parsed=parseDownloadFiles(gutenberg,book,response(markup,book.url));
    expect(parsed.files.map(f=>f.format)).toEqual(['EPUB','TXT','PDF']);expect(parsed.files[0].size).toBe('1.2 MB');
    expect(()=>parseDownloadFiles(gutenberg,book,response(markup,'https://www.gutenberg.org/'))).toThrow();
    expect(()=>parseDownloadFiles(gutenberg,book,response('<title>Just a moment</title><h1>Please wait</h1>',book.url))).toThrow();
  });
  it('escapes quoted catalog searches and excludes download words or format from catalog queries',async()=>{
    const fetch=desktop(vi.fn().mockImplementation(request=>Promise.resolve(response(list(),request.url))));
    await searchDownloadCatalog(archive,query);
    const url=new URL(fetch.mock.calls[0][0].url);expect(url.searchParams.get('q')).toBe('title:("红楼梦 & \\"书\\" +") AND mediatype:texts AND creator:("曹雪芹")');expect(url.searchParams.get('q')).not.toContain('EPUB');
    await expect(searchDownloadCatalog(archive,query,undefined,'https://evil.org/advancedsearch.php')).rejects.toThrow('翻页');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('ignores transport results after cancellation, including file checks',async()=>{
    const pending:((value:SourceResponse)=>void)[]=[];
    desktop(vi.fn().mockImplementation(()=>new Promise(resolve=>pending.push(resolve))));
    const controller=new AbortController(),search=searchDownloadCatalog(archive,query,controller.signal),files=resolveDownloadFiles(archive,candidate,controller.signal);
    controller.abort();pending[0](response(list()));pending[1](response({files:[]}));
    await expect(search).rejects.toMatchObject({name:'AbortError'});await expect(files).rejects.toMatchObject({name:'AbortError'});
  });

});
