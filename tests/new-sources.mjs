// Offline desktop integration: published Fanqie response shape and linkless
// cards, manual pagination, unavailable-vs-empty, index entry, saved deletion.
import { _electron as electron, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('test-results',`new-sources-${Date.now()}`),profile=path.join(output,'profile');
await fs.mkdir(output,{recursive:true});
const checks=[],errors=[];const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"code":-100}');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
let application,page;
const launch=()=>electron.launch({...(process.env.QIDU_PACKAGED_CHECK?{executablePath:path.resolve('release/win-unpacked/栖读.exe'),args:[]}:{args:['.'],cwd:process.cwd()}),env:{...process.env,QIDU_TEST_HIDE:'1',QIDU_TEST_USER_DATA:profile,QIDU_DEV_URL:''},timeout:30000});
async function search(query){await page.getByLabel('在线搜索书名或作者').fill(query);await page.getByRole('button',{name:'搜索书籍',exact:true}).click();}
try {
  application=await launch();page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  // All HTTPS pages and site APIs in this suite are deterministic fixtures.
  await application.evaluate(async({session})=>{
    await session.fromPartition('persist:qidu-websites').protocol.handle('https',request=>{
      const url=new URL(request.url);
      if(url.hostname==='www.bing.com')return new Response('<h1>公开索引测试页</h1>');
      if(url.hostname==='fanqienovel.com' && url.pathname.startsWith('/api/author/search/search_book/v1')){
        const query=url.searchParams.get('query_word'),next=url.searchParams.get('page_index')==='1';
        if(query==='故障')return new Response('',{headers:{'Content-Type':'application/json'}});
        const books=query==='空'?[]:[{book_id:next?'7069948840148732969':'7069948840148732967',book_name:next?'下一页的故事':'魔女的旅程',author:'林间',book_abstract:'一段测试简介',thumb_url:'novel-static/fixture',category:'奇幻',creation_status:'1',private_field:'must-not-leave-site'},{book_id:'7069948840148732968',book_name:'远方来信',author:'山岚',book_abstract:'另一段简介'}];
        return new Response(JSON.stringify({code:0,data:{total_count:books.length?11:0,search_book_data_list:books},unrelated:'must-not-leave-site'}),{headers:{'Content-Type':'application/json'}});
      }
      if(url.hostname==='fanqienovel.com' && url.pathname.startsWith('/search/')){
        return new Response(`<html><title>番茄搜索测试页</title><main id="results">正在搜索</main><script>
          const query=decodeURIComponent(location.pathname.slice('/search/'.length));
          async function load(page=0){const r=await fetch('/api/author/search/search_book/v1?query_word='+encodeURIComponent(query)+'&page_index='+page+'&page_count=10&a_bogus=fixture');let books=[];try{books=(await r.json()).data.search_book_data_list}catch{}
            document.querySelector('#results').innerHTML=books.length?books.map(b=>'<div class="search-book-item"><div class="title">'+b.book_name+'</div></div>').join('')+'<button id="next">下一页</button>':'<div class="muye-search-empty">没有搜索到相关结果</div>';
            document.querySelector('#next')?.addEventListener('click',()=>load(1));}
          load();</script></html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
      return new Response('fixture unavailable',{status:404});
    });
  });
  await page.getByRole('button',{name:'发现好书',exact:true}).click();
  await expect(page.locator('.source-directory > button:not(.add-source-card)')).toHaveCount(8);
  await page.getByRole('button',{name:/管理搜索站点/}).click();
  await page.getByLabel('编辑 番茄小说',{exact:true}).click();
  await page.getByLabel('搜索地址',{exact:true}).fill(base+'/failed?q={query}');
  await page.getByRole('button',{name:'保存站点',exact:true}).click();await page.getByLabel('关闭弹窗',{exact:true}).click();
  await page.getByRole('button',{name:'番茄小说',exact:true}).click();await search('魔女');
  await expect(page.locator('.discovery-title')).toHaveText(['魔女的旅程','远方来信'],{timeout:30000});
  await expect(page.locator('.remote-author')).toHaveText(['林间','山岚']);
  await expect(page.locator('.source-message')).toContainText('更多结果可在站点窗口翻页');
  await expect(page.getByRole('button',{name:/加载更多/})).toHaveCount(0);
  check('new built-ins are visible and Fanqie reads linkless web results after direct API failure');
  await page.getByRole('button',{name:/站点窗口/}).click();
  await expect.poll(()=>application.windows().some(w=>w.url().includes('source-window.html'))).toBe(true);
  const toolbar=application.windows().find(w=>w.url().includes('source-window.html'));
  await expect.poll(()=>application.windows().some(w=>w.url().startsWith('https://fanqienovel.com/search/'))).toBe(true);
  const remote=application.windows().find(w=>w.url().startsWith('https://fanqienovel.com/search/'));
  await remote.getByRole('button',{name:'下一页',exact:true}).click();await expect(remote.locator('.title').first()).toHaveText('下一页的故事');
  await page.evaluate(()=>window.desktop.onSourceSnapshot(value=>{window.__newSourceSnapshot=value;}));
  await toolbar.getByRole('button',{name:'读取搜索结果',exact:true}).click();
  await expect(page.locator('.discovery-title').first()).toHaveText('下一页的故事');
  const snapshot=await page.evaluate(()=>window.__newSourceSnapshot);
  expect(snapshot.text).not.toContain('must-not-leave-site');expect(snapshot.url).not.toContain('a_bogus');
  check('manual website pagination returns the current page book IDs and metadata');
  await search('故障');await expect(page.locator('.source-message')).toContainText('暂未返回有效数据',{timeout:30000});await expect(page.locator('.discovery-card')).toHaveCount(0);
  check('an HTTP 200 empty response is reported as unavailable instead of no matches');
  await search('空');await expect(page.locator('.source-message')).toContainText('没有找到相关书籍',{timeout:30000});await expect(page.locator('.source-message.attention')).toHaveCount(0);
  check('a valid empty JSON response is reported as no matches');
  await page.getByRole('button',{name:/管理搜索站点/}).click();
  await page.getByLabel('删除站点 番茄小说',{exact:true}).click();
  await page.getByLabel('启用 刺猬猫阅读',{exact:true}).uncheck();
  await page.getByLabel('关闭弹窗',{exact:true}).click();
  await page.getByRole('button',{name:/管理搜索站点/}).click();
  await page.getByLabel('编辑 优书网',{exact:true}).click();
  await page.getByLabel('搜索地址',{exact:true}).fill(base+'/unavailable?q={query}');
  await page.getByLabel('搜索加载方式',{exact:true}).selectOption('http');
  await page.getByRole('button',{name:'保存站点',exact:true}).click();await page.getByLabel('关闭弹窗',{exact:true}).click();
  await page.getByRole('button',{name:'优书网',exact:true}).click();await search('诡秘 & +');
  await page.getByRole('button',{name:'搜索公开网页',exact:true}).click();
  await expect.poll(()=>application.windows().some(w=>w.url().startsWith('https://www.bing.com/search?'))).toBe(true);
  const index=application.windows().find(w=>w.url().startsWith('https://www.bing.com/search?'));
  expect(new URL(index.url()).searchParams.get('q')).toBe('site:youshu.me/book/ 诡秘 & +');
  check('Youshu public-index action opens the exact submitted query without changing its source');
  await application.close();application=await launch();page=await application.firstWindow();
  await page.getByRole('button',{name:'发现好书',exact:true}).click();await page.getByRole('button',{name:/管理搜索站点/}).click();
  await expect(page.getByLabel('删除站点 番茄小说',{exact:true})).toHaveCount(0);await expect(page.getByLabel('启用 刺猬猫阅读',{exact:true})).not.toBeChecked();
  check('deleted new sources and disabled states survive app restart');
  expect(errors).toEqual([]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors},null,2));console.log(`Evidence: ${output}`);
} finally {await application?.close();server.close();}
