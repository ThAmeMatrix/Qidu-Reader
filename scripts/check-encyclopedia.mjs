import {_electron as electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('test-results',`encyclopedia-live-${Date.now()}`);await fs.mkdir(output,{recursive:true});
const application=await electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,QIDU_TEST_HIDE:'1',QIDU_TEST_USER_DATA:path.join(output,'profile'),QIDU_DEV_URL:''}});
try{
 const page=await application.firstWindow();await page.waitForFunction(()=>!!window.desktop);
 const requests=[{url:'https://baike.baidu.com/item/'+encodeURIComponent('红楼梦')},{url:'https://zh.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent('紅樓夢')},{url:'https://www.bing.com/search?format=rss&q='+encodeURIComponent('site:baike.baidu.com/item/ 红楼梦 曹雪芹')}];
 const results=await Promise.all(requests.map(async request=>{try{return await page.evaluate(async request=>{const result=await window.desktop.fetchSource(request);const doc=new DOMParser().parseFromString(result.text,'text/html');return {request,...result,text:undefined,bytes:result.text.length,title:doc.title,preview:doc.body.textContent?.trim().slice(0,600)};},request);}catch(e){return {request,error:e.message};}}));
 await page.getByLabel('瓦尔登湖 详情与管理',{exact:true}).click();await page.getByRole('button',{name:/百科概述/}).click();await page.getByLabel('百科查询关键词',{exact:true}).fill('红楼梦');await page.getByRole('button',{name:'更新概述',exact:true}).click();await page.locator('.encyclopedia-summary').waitFor({state:'visible',timeout:60000});const overview=await page.locator('.encyclopedia-content').innerText();results.push({inAppOverview:overview.slice(0,1200)});
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));console.log(JSON.stringify({output,results},null,2));
}finally{await application.close();}
