// Opt-in public-network check. Downloads one public-domain Gutenberg EPUB into
// an isolated test profile, imports it, and records each provider's actual state.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('test-results',`downloads-live-${Date.now()}`);await fs.mkdir(output,{recursive:true});
const application=await electron.launch({...(process.env.QIDU_PACKAGED_CHECK?{executablePath:path.resolve('release/win-unpacked/栖读.exe'),args:[]}:{args:['.','--disable-renderer-backgrounding','--disable-background-timer-throttling'],cwd:process.cwd()}),env:{...process.env,QIDU_TEST_HIDE:'1',QIDU_TEST_USER_DATA:path.join(output,'profile'),QIDU_DEV_URL:''},timeout:30000});
const report={checkedAt:new Date().toISOString(),packaged:!!process.env.QIDU_PACKAGED_CHECK,passed:false,providers:[],download:null,errors:[],externalCalls:[]};
const selectedProviders=process.env.QIDU_CHECK_PROVIDERS?.split(',');
try{
  const page=await application.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
  await application.evaluate(({shell})=>{globalThis.liveExternal=[];shell.openExternal=async url=>{globalThis.liveExternal.push(url);};});
  await page.getByLabel('瓦尔登湖 详情与管理',{exact:true}).click();await page.getByRole('button',{name:/^查找下载方案/}).click();await page.getByRole('button',{name:'管理下载站点',exact:true}).click();
  const selected=page.locator('.download-provider-row input:checked');while(await selected.count())await selected.first().uncheck();await page.getByRole('button',{name:'返回下载结果',exact:true}).click();
  for(const [name,title] of [['Project Gutenberg','紅樓夢'],['Internet Archive','红楼梦'],['Standard Ebooks','Alice'],['书格','红楼梦'],['必应','红楼梦'],['百度','红楼梦'],['Google','红楼梦'],['中文维基文库','红楼梦']]){
    if(selectedProviders && !selectedProviders.includes(name))continue;
    await page.getByLabel('下载查找书名',{exact:true}).fill(title);await page.getByRole('button',{name:'重新查找',exact:true}).click();
    await page.getByRole('button',{name:'管理下载站点',exact:true}).click();await page.getByLabel(`启用下载站 ${name}`,{exact:true}).check();await page.getByRole('button',{name:'返回下载结果',exact:true}).click();
    const region=page.getByLabel(`${name}下载结果`,{exact:true});await expect(region).toBeVisible();await expect.poll(()=>region.locator('.download-candidate,.download-empty,.download-file-message.is-error').count(),{timeout:55000}).toBeGreaterThan(0);await expect(region.locator('.download-loading')).toHaveCount(0,{timeout:55000});
    const entry={name,query:title,count:await region.locator('.download-candidate').count(),titles:await region.locator('.download-book-title').allTextContents(),files:[],pages:[],message:await region.locator('.download-file-message,.download-empty').allTextContents()};report.providers.push(entry);
    if(entry.count){
      const candidates=region.locator('.download-candidate'),match=candidates.filter({hasText:name==='Internet Archive'?'曹雪芹':'Alice’s Adventures'}),book=await match.count()?match.first():candidates.first();
      await book.locator('.download-candidate-top > button').click();await expect.poll(()=>book.locator('.download-file,.download-file-message,.download-page-summary').count(),{timeout:45000}).toBeGreaterThan(0);await expect(book.getByRole('button',{name:'正在读取',exact:true})).toHaveCount(0,{timeout:45000});entry.files=await book.locator('.download-file').allTextContents();entry.pages=await book.locator('.download-page-links button').allTextContents();entry.message.push(...await book.locator('.download-file-message').allTextContents());
      if(name==='Project Gutenberg' && entry.files.length){
        await book.locator('.download-file').filter({hasText:'EPUB'}).first().click();await expect(page.locator('.download-job[data-status="completed"]')).toHaveCount(1,{timeout:60000});
        const jobs=await page.evaluate(()=>window.desktop.downloads.list());report.download={format:jobs[0].format,name:jobs[0].name,bytes:jobs[0].received,status:jobs[0].status,url:jobs[0].url,imported:false};
        await page.locator('.download-job').getByRole('button',{name:'加入书架',exact:true}).click();await expect(page.locator('.toast')).toContainText('已加入书架',{timeout:30000});report.download.imported=true;
        await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());try{await page.screenshot({path:path.join(output,'gutenberg-download.png'),animations:'disabled',timeout:10000});}finally{await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());}
      }
      if(name==='书格' && entry.pages.length){
        await book.locator('.download-page-links button').first().click();await expect.poll(()=>book.locator('.download-file,.download-file-message,.download-page-summary').count(),{timeout:45000}).toBeGreaterThan(0);await expect(book.getByRole('button',{name:'正在读取',exact:true})).toHaveCount(0,{timeout:45000});
        entry.gateway={files:await book.locator('.download-file').allTextContents(),pages:await book.locator('.download-page-links button').allTextContents(),message:await book.locator('.download-file-message').allTextContents()};
      }
    }
    console.log(JSON.stringify(entry));
    await page.getByRole('button',{name:'管理下载站点',exact:true}).click();await page.getByLabel(`启用下载站 ${name}`,{exact:true}).uncheck();await page.getByRole('button',{name:'返回下载结果',exact:true}).click();
  }
  report.externalCalls=await application.evaluate(()=>globalThis.liveExternal);report.passed=report.errors.length===0 && report.externalCalls.length===0 && (selectedProviders && !selectedProviders.includes('Project Gutenberg')?report.providers.length>0 && report.providers.every(p=>p.count>0):report.download?.imported===true);
}catch(e){report.errors.push(e.message);}finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(`Evidence: ${output}`);await application.close();}
if(!report.passed)process.exitCode=1;
