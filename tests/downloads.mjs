// Real Electron downloads against an isolated HTTP fixture. Only public catalog
// search responses are stubbed; transfer, session cookies, disk and import are real.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { makeFixtures } from './fixtures.mjs';

const output=path.resolve('test-results',`downloads-${Date.now()}`),profile=path.join(output,'profile');
await makeFixtures(path.join(output,'fixtures'));
const payloads=Object.fromEntries(await Promise.all(['txt','pdf','epub'].map(async ext=>[ext,await fs.readFile(path.join(output,'fixtures',`阅读测试.${ext}`))])));
const checks=[],errors=[],requests=[];const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
let application,page,slowAttempts=0;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push({path:url.pathname,cookie:req.headers.cookie,referrer:req.headers.referer});
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(url.pathname==='/book')res.end('<main><h1>站内下载测试书</h1><p>可在当前界面继续读取下载页。</p><a href="/download/gateway">下载文件页</a></main>');
  else if(url.pathname==='/download/gateway'){
    res.setHeader('Set-Cookie','download_fixture=allowed; HttpOnly; SameSite=Lax; Path=/');
    res.end('<main><h1>可选格式</h1><a href="/files/book.txt">站内测试.txt</a><a href="/files/book.epub">站内测试.epub</a><a href="/download/redirect">PDF 下载</a><a href="/files/fake.pdf">验证页.pdf</a><a href="/files/slow.txt">慢速测试.txt</a></main>');
  }else if(url.pathname==='/download/redirect'){res.writeHead(302,{Location:'/opaque'});res.end();}
  else if(url.pathname==='/opaque'){res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':payloads.pdf.length,'Content-Disposition':"attachment; filename*=UTF-8''%E7%AB%99%E5%86%85%E6%B5%8B%E8%AF%95.pdf"});res.end(payloads.pdf);}
  else if(url.pathname==='/files/fake.pdf')res.end('<title>用户登录</title><h1>请登录后下载</h1>');
  else if(url.pathname==='/files/slow.txt'){
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    if(++slowAttempts>1){res.end('第一章\n重新下载完成。');return;}
    res.write('第一章\n');const timer=setInterval(()=>res.write('这是正在传输的文本。\n'.repeat(50)),100);res.on('close',()=>clearInterval(timer));
  }else if(url.pathname.startsWith('/files/book.')){
    if(!req.headers.cookie?.includes('download_fixture=allowed')){res.writeHead(401);res.end('请登录');return;}
    const ext=url.pathname.split('.').pop(),data=payloads[ext];res.writeHead(200,{'Content-Type':ext==='epub'?'application/epub+zip':'text/plain; charset=utf-8','Content-Length':data.length});res.end(data);
  }else if(url.pathname==='/custom')res.end('<section class="entry"><b class="label">自定义站点的书</b><a class="entry-link" href="/book">详情</a><p class="synopsis">已读取自定义规则</p></section>');
  else {res.writeHead(404);res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const launch=()=>electron.launch({...(process.env.QIDU_PACKAGED_CHECK?{executablePath:path.resolve('release/win-unpacked/栖读.exe'),args:[]}:{args:['.','--disable-renderer-backgrounding','--disable-background-timer-throttling'],cwd:process.cwd()}),env:{...process.env,QIDU_TEST_HIDE:'1',QIDU_TEST_USER_DATA:profile,QIDU_DEV_URL:''},timeout:30000});
async function fixtureTransport(){
  await application.evaluate(({ipcMain,app,shell,dialog},base)=>{
    const {fetchDesktopSource}=process.mainModule.require(process.mainModule.require('node:path').join(app.getAppPath(),'electron/source-render.cjs'));
    globalThis.downloadFixture={opened:[],requests:[],pending:[],released:0,savePath:undefined};
    shell.openExternal=async url=>{globalThis.downloadFixture.opened.push(url);};
    dialog.showSaveDialog=async()=>({canceled:!globalThis.downloadFixture.savePath,filePath:globalThis.downloadFixture.savePath});
    ipcMain.removeHandler('sources:fetch');ipcMain.handle('sources:fetch',async(_event,request)=>{
      const state=globalThis.downloadFixture,url=new URL(request.url);state.requests.push(url.href);
      if(url.origin===base)return fetchDesktopSource(request);
      const result=(data,status=200)=>({text:typeof data==='string'?data:JSON.stringify(data),url:url.href,status,contentType:typeof data==='string'?'text/html':'application/json'});
      const esc=t=>t.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      if(url.hostname==='archive.org' && url.pathname==='/advancedsearch.php'){
        const title=(url.searchParams.get('q')||'').match(/^title:\("((?:\\.|[^"])*)"\)/)?.[1] || '瓦尔登湖';
        if(title.startsWith('慢请求')){await new Promise(resolve=>state.pending.push(resolve));state.released++;}
        if(title==='故障')return result('Access denied',403);if(title==='空')return result({response:{numFound:0,docs:[]}});
        const next=url.searchParams.get('page')==='2';
        return result({response:{numFound:next?3:12,docs:next?[{identifier:'book-1',title},{identifier:'book-3',title:title+' · 另一版'}]:[{identifier:'book-1',title,creator:'测试作者'},{identifier:'loan-2',title:title+' · 借阅版','access-restricted-item':true}]}});
      }
      if(url.hostname==='archive.org' && url.pathname.startsWith('/metadata/'))return result({metadata:{identifier:url.pathname.split('/').pop(),'access-restricted-item':url.pathname.endsWith('loan-2'),rights:'Public domain'},files:[{name:'测试.epub',size:'4096'},{name:'测试.pdf',size:'8192'},{name:'测试.txt',size:'2048'}]});
      if(url.hostname==='www.gutenberg.org')return result('<div>No records found.</div>');
      if(url.hostname==='www.bing.com'){
        const title=(url.searchParams.get('q')||'').split(' ')[0];return result(`<rss><channel><item><title>${esc(title)} · 下载版本</title><link>${base}/book</link><description>读取网页中的 EPUB、PDF、TXT 文件</description></item></channel></rss>`);
      }
      if(url.hostname==='www.baidu.com')return result('<title>百度安全验证</title>');
      return result('<p>No results found.</p>');
    });
  },base);
}
async function localEntry(){await page.getByLabel('瓦尔登湖 详情与管理',{exact:true}).click();await page.getByRole('button',{name:/^查找下载方案/}).click();}
async function search(title){await page.getByLabel('下载查找书名',{exact:true}).fill(title);await page.getByRole('button',{name:'重新查找',exact:true}).click();}
async function screenshot(name){await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());try{await page.screenshot({path:path.join(output,name),animations:'disabled',timeout:10000});}finally{await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());}}
const queueJob=name=>page.getByRole('article',{name:`下载任务 ${name}`,exact:true});
const waitCompleted=async name=>{await expect(queueJob(name)).toHaveAttribute('data-status','completed',{timeout:15000});};
try{
  application=await launch();page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await fixtureTransport();
  await expect(page.locator('.book-card')).toHaveCount(6);await localEntry();await expect(page.getByLabel('下载查找书名',{exact:true})).toHaveValue('瓦尔登湖');
  const archive=page.getByLabel('Internet Archive下载结果',{exact:true});
  await expect(archive.locator('.download-candidate')).toHaveCount(2);await expect(page.getByLabel('必应下载结果',{exact:true}).locator('.download-candidate')).toHaveCount(1);
  await expect(page.getByLabel('百度下载结果',{exact:true})).toContainText('登录或验证');await page.keyboard.press('Control+o');await expect(page.getByRole('dialog')).toHaveCount(1);
  check('catalog and search-engine results are aggregated inside a single focused dialog');
  await archive.getByRole('button',{name:'检查文件',exact:true}).first().click();await expect(archive.locator('.download-file')).toHaveCount(3);
  await page.getByRole('button',{name:'PDF',exact:true}).click();await expect(archive.locator('.download-file')).toHaveCount(1);await page.getByRole('button',{name:'全部格式',exact:true}).click();
  await archive.getByRole('button',{name:'检查文件',exact:true}).nth(1).click();await expect(archive.locator('.download-candidate').nth(1)).toContainText('访问限制');
  await archive.getByRole('button',{name:'加载更多结果',exact:true}).click();await expect(archive.locator('.download-candidate')).toHaveCount(3);await expect(archive.locator('.download-file')).toHaveCount(3);
  check('catalog format filtering, restricted records and pagination retain inspected files');
  await page.getByRole('button',{name:'必应',exact:true}).click();const engine=page.getByLabel('必应下载结果',{exact:true}),book=engine.locator('.download-candidate');
  await book.getByRole('button',{name:'解析下载',exact:true}).click();await expect(book).toContainText('站内下载测试书');await expect(book.locator('.download-file')).toHaveCount(5);
  await book.getByRole('button',{name:'下载 站内测试.pdf',exact:true}).click();await waitCompleted('站内测试.pdf');
  await book.getByRole('button',{name:'下载 站内测试.txt',exact:true}).click();await waitCompleted('站内测试.txt');
  await book.getByRole('button',{name:'下载 站内测试.epub',exact:true}).click();await waitCompleted('站内测试.epub');
  expect(requests.filter(r=>r.path.startsWith('/files/book.')).every(r=>r.cookie?.includes('download_fixture=allowed'))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.desktop.downloads.list().then(j=>j.filter(v=>v.status==='completed').length))).toBe(3);
  check('result pages and gateways resolve in app; extensionless PDF, TXT and EPUB transfer using the website session');
  await screenshot('download-finder.png');
  await expect.poll(()=>page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('qidu-library',1);r.onsuccess=()=>{const q=r.result.transaction('state').objectStore('state').get('library');q.onsuccess=()=>resolve(q.result.books.length);};}))).toBe(9);
  await queueJob('站内测试.txt').getByRole('button',{name:'加入书架',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已在书架中'})).toBeVisible();
  const exported=path.join(output,'saved-book.epub');await application.evaluate((_electron,value)=>{globalThis.downloadFixture.savePath=value;},exported);await queueJob('站内测试.epub').getByRole('button',{name:'另存文件',exact:true}).click();await expect.poll(async()=>fs.readFile(exported).then(v=>v.equals(payloads.epub)).catch(()=>false)).toBe(true);
  check('all three formats import into the library, duplicate imports are skipped, and Save As preserves the bytes');
  await book.getByRole('button',{name:'下载 验证页.pdf',exact:true}).click();await expect(queueJob('验证页.pdf')).toHaveAttribute('data-status','failed');await expect(queueJob('验证页.pdf')).toContainText('网页或验证');
  await book.getByRole('button',{name:'下载 慢速测试.txt',exact:true}).click();await expect(queueJob('慢速测试.txt').getByRole('progressbar')).toBeVisible();await queueJob('慢速测试.txt').getByRole('button',{name:'取消下载',exact:true}).click();await expect(queueJob('慢速测试.txt')).toHaveAttribute('data-status','cancelled');
  await queueJob('慢速测试.txt').getByRole('button',{name:'重新下载',exact:true}).click();await waitCompleted('慢速测试.txt');
  check('progress, cancellation and retry work; HTML verification pages fail without producing a book');
  await page.getByRole('button',{name:'全部来源',exact:true}).click();await search('慢请求旧');await expect.poll(()=>application.evaluate(()=>globalThis.downloadFixture.pending.length)).toBe(1);await search('新检索');await expect(archive.locator('.download-book-title').first()).toHaveText('新检索');await application.evaluate(()=>globalThis.downloadFixture.pending.shift()());await expect.poll(()=>application.evaluate(()=>globalThis.downloadFixture.released)).toBe(1);await expect(archive.locator('.download-book-title').first()).toHaveText('新检索');
  await search('慢请求停止');await expect.poll(()=>application.evaluate(()=>globalThis.downloadFixture.pending.length)).toBe(1);await page.getByRole('button',{name:'停止查找',exact:true}).click();await expect(archive).toContainText('已停止查找');await application.evaluate(()=>globalThis.downloadFixture.pending.shift()());await expect.poll(()=>application.evaluate(()=>globalThis.downloadFixture.released)).toBe(2);await expect(archive.locator('.download-candidate')).toHaveCount(0);
  await search('故障');await expect(archive).toContainText('限制访问');await search('空');await expect(archive).toContainText('没有匹配结果');
  check('stale and stopped searches cannot replace results; upstream errors differ from valid empty searches');
  await search('红楼梦');await page.getByRole('button',{name:'管理下载站点',exact:true}).click();await page.getByRole('button',{name:'添加下载站点',exact:true}).click();await page.getByLabel('下载站点名称',{exact:true}).fill('我的下载库');await page.getByLabel('下载站点搜索链接',{exact:true}).fill('javascript:alert("{query}")');await page.getByRole('button',{name:'保存下载站点',exact:true}).click();await expect(page.locator('.error-message')).toBeVisible();
  await page.getByLabel('下载站点搜索链接',{exact:true}).fill(base+'/custom?q={query}');await page.getByText('自定义结果解析规则',{exact:true}).click();await page.getByLabel('下载解析结果条目',{exact:true}).fill('.entry');await page.getByLabel('下载解析结果标题',{exact:true}).fill('.label');await page.getByLabel('下载解析结果链接',{exact:true}).fill('.entry-link');await page.getByLabel('下载解析结果简介',{exact:true}).fill('.synopsis');await page.getByRole('button',{name:'预览结果',exact:true}).click();await expect(page.locator('.download-parser-preview')).toContainText('自定义站点的书');await page.getByRole('button',{name:'保存下载站点',exact:true}).click();
  await page.getByLabel('编辑下载站 我的下载库',{exact:true}).click();await page.getByLabel('下载站点名称',{exact:true}).fill('我的电子书库');await page.getByRole('button',{name:'保存下载站点',exact:true}).click();await page.getByLabel('删除下载站 Google',{exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByLabel('删除下载站 Google',{exact:true})).toBeVisible();await page.getByLabel('删除下载站 Google',{exact:true}).click();await page.getByLabel('启用下载站 Project Gutenberg',{exact:true}).uncheck();await page.getByRole('button',{name:'返回下载结果',exact:true}).click();
  await page.getByRole('button',{name:'我的电子书库',exact:true}).click();await expect(page.getByLabel('我的电子书库下载结果',{exact:true})).toContainText('已读取自定义规则');
  check('custom sites support in-app previews, CSS selectors, editing, enable states and deletion undo');
  await page.getByText('读取指定页面或下载地址',{exact:true}).click();await page.getByLabel('下载页面地址',{exact:true}).fill(base+'/book');await page.getByRole('button',{name:'在此读取',exact:true}).click();await expect(page.getByLabel('指定页面下载结果',{exact:true})).toContainText('站内下载测试书');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(1000);expect(await page.evaluate(()=>{const modal=document.querySelector('.modal');return modal.scrollWidth<=modal.clientWidth+1 && modal.getBoundingClientRect().right<=innerWidth;})).toBe(true);await page.locator('.modal').evaluate(el=>el.scrollTop=0);await screenshot('download-compact.png');
  expect(await application.evaluate(()=>globalThis.downloadFixture.opened)).toEqual([]);await page.getByLabel('关闭弹窗',{exact:true}).click();await expect(page.getByRole('dialog',{name:'关于这本书',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.book-card')).toHaveCount(10);
  check('manual page reading and minimum-size layout work with zero external-browser handoffs');
  await page.getByLabel('阅读 EPUB 阅读测试',{exact:true}).click();await expect(page.locator('.epub-container iframe')).toHaveCount(1,{timeout:15000});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/^下载任务 \d+$/}).click();await expect(page.locator('.download-job')).toHaveCount(5);await queueJob('站内测试.txt').getByLabel('清理下载 站内测试.txt',{exact:true}).click();await expect(page.locator('.download-job')).toHaveCount(4);await page.getByLabel('关闭弹窗',{exact:true}).click();await expect(page.locator('.book-card')).toHaveCount(10);
  check('downloaded EPUB opens in the reader; clearing a download retains the work metadata');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('sources:snapshot',{sourceId:'ciweimao',mode:'search',status:200,contentType:'text/html',url:'https://www.ciweimao.com/get-search-book-list/0-0-0-0-0-0/全部/红楼梦/1',text:'<ul><li data-book-id="100"><div class="cnt"><p class="tit"><a href="/book/100">红楼梦</a></p><p>小说作者：<a href="/reader/2">曹雪芹</a></p><div class="desc">测试书目</div></div></li></ul>'}));
  await page.getByLabel('查找下载 红楼梦',{exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.getByLabel('下载查找书名',{exact:true})).toHaveValue('红楼梦');await page.getByText('读取指定页面或下载地址',{exact:true}).click();await expect(page.getByRole('button',{name:/^读取.*原页$/})).toBeVisible();await page.getByLabel('关闭弹窗',{exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.discovery-title').click();await page.getByRole('button',{name:/^查找下载方案/}).click();await expect(page.getByRole('dialog')).toHaveCount(1);await page.getByLabel('关闭弹窗',{exact:true}).click();await expect(page.getByRole('dialog',{name:'从书海带回的故事',exact:true})).toBeVisible();await page.getByLabel('关闭弹窗',{exact:true}).click();
  check('found-book cards and online details open the same in-app finder with original-page access');
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('button',{name:'夜间',exact:true}).click();await page.getByRole('button',{name:/^我的书架/}).click();await localEntry();await page.locator('.modal').evaluate(el=>el.scrollTop=0);await screenshot('download-dark.png');
  await application.close();application=await launch();page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await fixtureTransport();await expect(page.locator('.book-card')).toHaveCount(10);await page.getByRole('button',{name:/^下载任务 \d+$/}).click();await expect(page.locator('.download-job')).toHaveCount(4);await expect(queueJob('站内测试.epub')).toHaveAttribute('data-status','completed');await queueJob('站内测试.epub').getByRole('button',{name:'加入书架',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已在书架中'})).toBeVisible();await page.getByLabel('关闭弹窗',{exact:true}).click();await localEntry();await page.getByRole('button',{name:'管理下载站点',exact:true}).click();await expect(page.getByLabel('删除下载站 Google',{exact:true})).toHaveCount(0);await expect(page.getByLabel('启用下载站 Project Gutenberg',{exact:true})).not.toBeChecked();await page.getByLabel('编辑下载站 我的电子书库',{exact:true}).click();await page.getByText('自定义结果解析规则',{exact:true}).click();await expect(page.getByLabel('下载解析结果条目',{exact:true})).toHaveValue('.entry');
  check('download records, imported books and custom parsing settings survive a restart');
  expect(errors).toEqual([]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,packaged:!!process.env.QIDU_PACKAGED_CHECK,checks,errors},null,2));console.log(`Evidence: ${output}`);
}finally{await application?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
