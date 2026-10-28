import { _electron as electron, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('test-results',`search-session-${Date.now()}`),profile=path.join(output,'profile');
await fs.mkdir(output,{recursive:true});
const checks=[],errors=[];let application,page,toolbar;
const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
const card=(id,title)=>`<article class="result"><h3><a href="/book/${id}">${title}</a></h3><p class="author">测试作者</p></article>`;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),signedIn=(req.headers.cookie || '').includes('fixture_session=allowed');
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(url.pathname==='/login')res.end('<title>用户登录</title><h1>测试登录</h1><form action="/session" method="post"><button>完成测试登录</button></form>');
  else if(url.pathname==='/session'){res.writeHead(303,{'Set-Cookie':'fixture_session=allowed; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600',Location:'/welcome'});res.end();}
  else if(url.pathname==='/welcome')res.end('<h1>测试登录成功</h1>');
  else if(url.pathname==='/private-search'){
    if(!signedIn){res.writeHead(302,{Location:'/login'});res.end();return;}
    const p=Number(url.searchParams.get('page') || 1);
    res.end(`<title>测试书库</title><header><form>用户登录<input type="password"/></form></header>${card(p,`登录后的书目${p}`)}${p===1?'<a href="/private-search?q=test&page=2">下一页</a>':''}`);
  }else if(url.pathname==='/spa')res.end(`<title>动态搜索</title><img src="/slow-image"><main id="results">正在加载</main><script>setTimeout(async()=>{const r=await fetch('/api/books',{headers:{Authorization:'Bearer local-fixture-only'}});document.getElementById('results').innerHTML=await r.text()},250)</script>`);
  else if(url.pathname==='/slow-image')return; // An unrelated image must not hold up search results.
  else if(url.pathname==='/cookie-hop'){res.writeHead(302,{'Set-Cookie':'redirect_fixture=allowed; Path=/',Location:'/cookie-result'});res.end();}
  else if(url.pathname==='/cookie-result')res.end((req.headers.cookie || '').includes('redirect_fixture=allowed')?'redirect session kept':'redirect session missing');
  else if(url.pathname==='/api/books'){
    if(!signedIn || req.headers.authorization!=='Bearer local-fixture-only'){res.writeHead(401);res.end('游客没有权限执行此操作');return;}
    res.end(card(9,'网页自动加载的书目'));
  }else if(url.pathname==='/challenge')res.end('<title>安全验证</title><p>请完成验证</p>');
  else if(url.pathname==='/form-page')res.end('<title>表单书库</title><form action="/form-search" method="post"><input type="hidden" name="form_stamp" value="fixture-only"><input name="searchkey"><button>搜索</button></form>');
  else if(url.pathname==='/form-search'){
    let body='';for await(const chunk of req)body+=chunk;
    const fields=new URLSearchParams(body);
    if(fields.get('form_stamp')!=='fixture-only' || fields.get('searchkey')!=='秋日' || !req.headers.origin){res.writeHead(403);res.end('表单未正确提交');return;}
    res.end(card(12,'表单查询的书目'));
  }
  else if(url.pathname==='/to-home'){res.writeHead(302,{Location:'/'});res.end();}
  else if(url.pathname==='/unsafe'){res.writeHead(302,{Location:'file:///C:/secret'});res.end();}
  else res.end(`<title>测试首页</title>${card(99,'首页推荐不应当作搜索结果')}`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const launch=()=>electron.launch({...(process.env.QIDU_PACKAGED_CHECK?{executablePath:path.resolve('release/win-unpacked/栖读.exe'),args:[]}:{args:['.','--disable-renderer-backgrounding','--disable-background-timer-throttling'],cwd:process.cwd()}),env:{...process.env,QIDU_TEST_HIDE:'1',QIDU_TEST_USER_DATA:profile,QIDU_DEV_URL:''},timeout:30000});
async function addSource(name,endpoint,mode='http',browse){
  await page.getByRole('button',{name:/管理搜索站点/}).click();
  await page.getByRole('button',{name:'添加搜索网站',exact:true}).click();
  await page.getByLabel('站点名称',{exact:true}).fill(name);await page.getByLabel('网站主页',{exact:true}).fill(base+'/');
  await page.getByLabel('搜索地址',{exact:true}).fill(base+endpoint);await page.getByLabel('搜索加载方式',{exact:true}).selectOption(mode);
  if(browse)await page.getByLabel('站点窗口搜索地址（可选）',{exact:true}).fill(base+browse);
  await page.getByText('高级解析规则',{exact:true}).click();await page.getByLabel('结果条目',{exact:true}).fill('.result');await page.getByLabel('书名',{exact:true}).fill('h3');await page.getByLabel('详情链接',{exact:true}).fill('h3 a');
  await page.getByRole('button',{name:'保存站点',exact:true}).click();await page.getByLabel('关闭弹窗',{exact:true}).click();
  await page.getByRole('button',{name:name,exact:true}).click();
}
async function search(){await page.getByLabel('在线搜索书名或作者').fill('测试');await page.getByRole('button',{name:'搜索书籍',exact:true}).click();}
try{
  application=await launch();page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('.book-card')).toHaveCount(6);await page.getByRole('button',{name:'发现好书',exact:true}).click();
  await addSource('登录书库','/private-search?q={query}&page={page}');await search();
  await expect(page.locator('.source-message')).toContainText('搜索需要登录');await expect(page.locator('.discovery-card')).toHaveCount(0);check('protected search is identified as login, not empty results');
  await page.getByRole('button',{name:'登录站点',exact:true}).click();
  await expect.poll(async()=> (await application.windows()).some(p=>p.url().includes('source-window.html'))).toBe(true);
  toolbar=(await application.windows()).find(p=>p.url().includes('source-window.html'));
  await expect.poll(()=>application.evaluate(async({webContents})=>{const remote=webContents.getAllWebContents().find(w=>/\/login$/.test(w.getURL()));return remote?remote.executeJavaScript('document.body.innerText'):'';})).toContain('完成测试登录');
  await application.evaluate(async({webContents})=>{const remote=webContents.getAllWebContents().find(w=>/\/login$/.test(w.getURL()));await remote.executeJavaScript('document.querySelector("button").click()');});
  await expect.poll(()=>application.evaluate(({webContents})=>webContents.getAllWebContents().some(w=>/\/welcome$/.test(w.getURL())))).toBe(true);
  await toolbar.getByRole('button',{name:'登录完成，重试',exact:true}).click();
  await expect(page.locator('.discovery-title')).toHaveText('登录后的书目1');
  await page.getByRole('button',{name:/加载更多/}).click();await expect(page.locator('.discovery-card')).toHaveCount(2);check('site-window HttpOnly login is reused by search and pagination through Chromium');
  const denied=await page.evaluate(url=>window.desktop.fetchSource({url}),base+'/api/books');expect(denied.status).toBe(401);
  await addSource('动态登录书库','/api/books?q={query}','auto','/spa?q={query}');await search();
  await expect(page.locator('.discovery-title')).toHaveText('网页自动加载的书目',{timeout:30000});check('automatic rendering lets the website authenticate its own API and returns the loaded results');
  expect(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(2);check('temporary rendering windows are cleaned up after search');
  await addSource('跳回首页书库','/to-home?q={query}');await search();await expect(page.locator('.source-message')).toContainText('跳转到了首页');await expect(page.locator('.discovery-card')).toHaveCount(0);check('homepage recommendations are not mislabeled as search results');
  const challenge=await page.evaluate(url=>window.desktop.fetchSource({url,render:true,readySelector:'.result'}),base+'/challenge');expect(challenge.access).toBe('verification');check('browser rendering reports challenges without claiming search success');
  const form=await page.evaluate(base=>window.desktop.fetchSource({url:base+'/form-search',referrer:base+'/form-page',method:'POST',body:'searchkey='+encodeURIComponent('秋日'),render:true,readySelector:'.result'}),base);expect(form.text).toContain('表单查询的书目');expect(form.text).not.toContain('fixture-only');check('POST searches use the original form context and keep hidden fields out of snapshots');
  await expect(page.evaluate(url=>window.desktop.fetchSource({url}),base+'/unsafe')).rejects.toThrow('http');check('session transport still rejects unsafe redirects');
  const redirect=await page.evaluate(url=>window.desktop.fetchSource({url}),base+'/cookie-hop');expect(redirect.text).toBe('redirect session kept');check('session cookies set on redirect responses are retained');
  // Screenshots are covered by packaged.mjs; keep this network/session suite
  // independent of the Windows compositor when its test window is hidden.
  if(process.env.QIDU_SEARCH_SCREENSHOT==='1')await page.screenshot({path:path.join(output,'search.png'),animations:'disabled',timeout:5000});
  await application.close();application=await launch();page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'发现好书',exact:true}).click();await page.getByRole('button',{name:'登录书库',exact:true}).click();await search();await expect(page.locator('.discovery-title')).toHaveText('登录后的书目1');
  await page.getByRole('button',{name:'动态登录书库',exact:true}).click();await search();await expect(page.locator('.discovery-title')).toHaveText('网页自动加载的书目',{timeout:30000});check('login survives app restart for direct and dynamic searches');
  expect(errors).toEqual([]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors},null,2));console.log(`Evidence: ${output}`);
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png'),timeout:5000}).catch(()=>{});throw error;}finally{await application?.close();server.close();}
