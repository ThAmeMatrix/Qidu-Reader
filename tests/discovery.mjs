import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';

const root = process.cwd(); const output = path.join(root,'test-results',`discovery-${Date.now()}`);
await fs.mkdir(output,{recursive:true}); const profile=path.join(output,'profile');
const checks=[];const errors=[];let application,page;
const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
const esc=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const card=(id,title)=>`<article class="result"><h3><a href="/book/${id}">${esc(title)}</a></h3><span class="by author">林间</span><p class="intro">一段关于慢慢阅读的原创测试简介。</p></article>`;
let slowStartedResolve, slowDoneResolve;
const slowStarted=new Promise(r=>slowStartedResolve=r),slowDone=new Promise(r=>slowDoneResolve=r);
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','text/html; charset=utf-8');
  if(url.pathname==='/search'){
    const q=url.searchParams.get('q')||'秋';const p=Number(url.searchParams.get('page')||1);
    if(q==='旧'){slowStartedResolve();await new Promise(r=>setTimeout(r,1100));}
    res.end(`<html><head><title>测试书库</title></head><body>${p===1?card(1,q+'日书简')+card(2,q+'天的窗'):card(3,q+'夜散步')}${p===1?`<a class="next" href="/search?q=${encodeURIComponent(q)}&page=2">下一页</a>`:''}<script>window.searchInjected=true</script></body></html>`);
    if(q==='旧')slowDoneResolve();
  }else if(url.pathname==='/dynamic')res.end(`<html><head><title>动态书库</title></head><body><div id="results"></div><script>setTimeout(()=>document.getElementById('results').innerHTML=${JSON.stringify(card(9,'动态书目'))},200)</script></body></html>`);
  else if(url.pathname.startsWith('/book/'))res.end('<html><head><meta property="og:title" content="秋日书简"><meta property="og:novel:author" content="林间"><meta property="og:description" content="更新后的书籍简介，来自详情页。"></head><body><h1>秋日书简</h1></body></html>');
  else res.end('<h1>测试书库</h1>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const launch=()=>electron.launch({...(process.env.QIDU_PACKAGED_CHECK?{executablePath:path.join(root,'release/win-unpacked/栖读.exe'),args:[]}:{args:['.','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows'],cwd:root}),env:{...process.env,QIDU_DEV_URL:'',QIDU_TEST_HIDE:'1',QIDU_TEST_USER_DATA:profile},timeout:30000});
const manager=()=>page.getByRole('button',{name:/管理搜索站点/}).click();
async function addSource(name,endpoint,custom=true){
  await page.getByRole('button',{name:'添加搜索网站',exact:true}).click();
  await page.getByLabel('站点名称',{exact:true}).fill(name);await page.getByLabel('网站主页',{exact:true}).fill(base);
  await page.getByLabel('搜索地址',{exact:true}).fill(`${base}${endpoint}`);
  if(custom){await page.getByText('高级解析规则',{exact:true}).click();for(const [label,value]of [['结果条目','.result'],['书名','h3'],['详情链接','h3 a'],['作者','.by'],['简介','.intro'],['下一页链接','.next']])await page.getByLabel(label,{exact:true}).fill(value);}
  await page.getByRole('button',{name:'保存站点',exact:true}).click();
}
try{
  application=await launch();page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('.book-card')).toHaveCount(6);
  await page.getByLabel('收藏 瓦尔登湖',{exact:true}).click();await page.getByRole('tab',{name:/我的收藏/}).click();await expect(page.locator('.book-card')).toHaveCount(1);
  await page.getByLabel('取消收藏 瓦尔登湖',{exact:true}).click();await expect(page.locator('.book-card')).toHaveCount(0);await page.getByRole('tab',{name:/全部书籍/}).click();
  check('shelf favorite toggles off and immediately leaves favorites filter');
  await page.getByRole('button',{name:'阅读 瓦尔登湖',exact:true}).click();await expect(page.locator('.reading-article')).toBeVisible();
  await page.getByLabel('添加书签（Ctrl D）').click();await page.getByLabel('取消书签（Ctrl D）').click();await expect(page.getByLabel('添加书签（Ctrl D）')).toBeVisible();
  await page.keyboard.press('Control+d');await expect(page.getByLabel('取消书签（Ctrl D）')).toBeVisible();await page.keyboard.press('Control+d');await expect(page.getByLabel('添加书签（Ctrl D）')).toBeVisible();
  await page.getByLabel('添加书签（Ctrl D）').click();await page.getByLabel('本书摘录与书签').click();await page.locator('.remove-reader-note').click();await expect(page.locator('.reader-note-item')).toHaveCount(0);
  await page.getByRole('button',{name:'返回书架',exact:true}).click();check('bookmark click, Ctrl+D and sidebar removal all toggle correctly');
  await page.getByRole('button',{name:'发现好书',exact:true}).click();await expect(page.locator('.source-directory>.add-source-card')).toBeVisible();
  await manager();for(const name of ['优书网','起点中文网','纵横中文网','国家图书馆','哔哩轻小说','Novelia','番茄小说','刺猬猫阅读'])await page.getByLabel(`启用 ${name}`,{exact:true}).uncheck();
  await addSource('测试书库','/search?q={query}&page={page}');await page.getByLabel('编辑 测试书库',{exact:true}).click();await page.getByRole('button',{name:'测试解析',exact:true}).click();await expect(page.locator('.source-test-result')).toContainText('成功识别 2 本');await page.getByRole('button',{name:'保存站点',exact:true}).click();await page.getByLabel('关闭弹窗',{exact:true}).click();
  await page.getByLabel('在线搜索书名或作者').fill('秋');await page.getByRole('button',{name:'搜索书籍',exact:true}).click();await expect(page.locator('.discovery-card')).toHaveCount(2);
  expect(await page.evaluate(()=>window.searchInjected)).toBeUndefined();await page.getByRole('button',{name:/加载更多/}).click();await expect(page.locator('.discovery-card')).toHaveCount(3);check('custom CSS source, parser preview, safe search and pagination');
  await page.getByLabel('收藏 秋日书简',{exact:true}).click();await expect(page.getByLabel('取消收藏 秋日书简',{exact:true})).toBeVisible();await page.getByLabel('取消收藏 秋日书简',{exact:true}).click();await expect(page.getByLabel('收藏 秋日书简',{exact:true})).toBeVisible();await page.getByLabel('收藏 秋日书简',{exact:true}).click();
  await page.getByLabel('查看 秋日书简',{exact:true}).click();await page.getByRole('button',{name:'更新书籍资料',exact:true}).click();await expect(page.locator('.online-description')).toContainText('更新后的书籍简介');await page.getByLabel('关闭弹窗',{exact:true}).click();check('online favorites toggle and details refresh from the source');
  await page.getByRole('button',{name:/^我的书架/}).click();await expect(page.locator('.book-card')).toHaveCount(7);await page.getByRole('button',{name:'阅读 秋日书简',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('在线书目');await page.getByLabel('关闭弹窗',{exact:true}).click();await page.getByRole('button',{name:'发现好书',exact:true}).click();await expect(page.locator('.discovery-card')).toHaveCount(3);check('online books open details, and search survives navigation');
  await page.getByLabel('在线搜索书名或作者').fill('旧');await page.getByRole('button',{name:'搜索书籍',exact:true}).click();await slowStarted;await page.getByLabel('在线搜索书名或作者').fill('新');await page.getByRole('button',{name:'搜索书籍',exact:true}).click();await expect(page.locator('.discovery-title').first()).toContainText('新日');await slowDone;await expect(page.locator('.discovery-title').first()).toContainText('新日');check('late responses cannot overwrite a newer search');
  await manager();await page.getByLabel('启用 测试书库',{exact:true}).uncheck();await addSource('动态站点','/dynamic?q={query}',false);await page.getByLabel('关闭弹窗',{exact:true}).click();
  await page.getByLabel('在线搜索书名或作者').fill('动态');await page.getByRole('button',{name:'搜索书籍',exact:true}).click();await expect(page.locator('.source-message')).toContainText('尚未识别到书目');await page.getByRole('button',{name:'打开站点',exact:true}).click();
  const toolbar=await expect.poll(async()=> (await application.windows()).some(p=>p.url().includes('source-window.html'))).toBe(true).then(async()=> (await application.windows()).find(p=>p.url().includes('source-window.html')));
  await expect.poll(()=>application.evaluate(async({webContents})=>{const remote=webContents.getAllWebContents().find(w=>w.getURL().includes('/dynamic?'));return remote?remote.executeJavaScript('document.body.innerText'):'';})).toContain('动态书目');
  expect(await application.evaluate(async({webContents})=>{const remote=webContents.getAllWebContents().find(w=>w.getURL().includes('/dynamic?'));return remote.executeJavaScript('[typeof window.require,typeof window.desktop,typeof window.sourceWindow]');})).toEqual(['undefined','undefined','undefined']);
  await toolbar.getByRole('button',{name:'读取搜索结果',exact:true}).click();await expect(page.locator('.discovery-title')).toHaveText('动态书目');check('sandboxed site window renders JavaScript and returns parsed books to the app');
  if(process.env.QIDU_PACKAGED_CHECK)await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await page.screenshot({path:path.join(output,'discovery.png'),animations:'disabled'});
  if(process.env.QIDU_PACKAGED_CHECK)await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  await application.close();application=await launch();page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('.book-card')).toHaveCount(7);await page.getByRole('tab',{name:/我的收藏/}).click();await expect(page.locator('.book-card')).toHaveCount(1);await expect(page.locator('.book-card')).toContainText('秋日书简');await page.getByRole('button',{name:'摘录与书签'}).click();await expect(page.locator('.note-card')).toHaveCount(0);await page.getByRole('button',{name:'发现好书',exact:true}).click();await manager();await expect(page.getByLabel('启用 动态站点',{exact:true})).toBeChecked();await expect(page.getByLabel('启用 测试书库',{exact:true})).not.toBeChecked();await page.getByLabel('删除站点 动态站点',{exact:true}).click();await expect(page.getByLabel('启用 动态站点',{exact:true})).toHaveCount(0);check('restart persists favorite removal, online books, source settings and source deletion');
  expect(errors).toEqual([]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors},null,2));console.log(`Evidence: ${output}`);
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}finally{await application?.close();server.close();}
