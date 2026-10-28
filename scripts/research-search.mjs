// A single public search with a fresh profile. No request headers, bodies or pages are recorded.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
const app=await electron.launch({args:['.','--disable-renderer-backgrounding','--disable-background-timer-throttling'],env:{...process.env,QIDU_TEST_HIDE:'1',QIDU_TEST_USER_DATA:path.resolve('test-results',`public-search-${Date.now()}`),QIDU_DEV_URL:''},timeout:30000});
try {
  const page=await app.firstWindow();
  console.log(await page.evaluate(async()=>{
    const response=await window.desktop.fetchSource({url:'https://www.linovelib.com/S6/',referrer:'https://www.linovelib.com/',method:'POST',body:'searchkey='+encodeURIComponent('魔女'),render:true,readySelector:'.bookbox a[href*="/novel/"],.book-ol a[href*="/novel/"]'});
    const doc=new DOMParser().parseFromString(response.text,'text/html');
    return {url:response.url,status:response.status,title:doc.title,access:response.access || null,isHomepage:new URL(response.url).pathname==='/',bookLinks:doc.querySelectorAll('a[href*="/novel/"]').length};
  }));
}finally{await app.close();}
