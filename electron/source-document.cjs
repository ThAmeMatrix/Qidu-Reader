// This isolated preload exposes no API to the website. Only the owning main
// process can ask for a document snapshot or submit an explicitly supplied search.
const { ipcRenderer } = require('electron');
const downloadState={clicked:new WeakSet(),codeSubmitted:false,selected:undefined};

ipcRenderer.on('source-document:request', (_event, { id, action, selector, request, code }) => {
  try {
    if(action==='download-auto'){
      const visible=el=>!!el&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0&&!el.disabled;
      const text=el=>(el.innerText||el.textContent||'').trim();
      const reply=value=>ipcRenderer.send('source-document:response',{id,value});
      if(/安全验证|验证中心|人机验证|just a moment/i.test(document.title)||document.querySelector('#cf-challenge-running,.g-recaptcha')){reply({state:'verification',message:'请在网盘窗口完成验证，完成后会继续解析'});return;}
      if(/^(?:用户)?(?:登录|登入)|^sign in/i.test(document.title)||[...document.querySelectorAll('h1,h2,h3')].some(el=>visible(el)&&/^(?:用户)?(?:登录|登入)$/.test(text(el)))&&document.querySelector('input[type="password"]')){reply({state:'login',message:'请在网盘窗口登录，登录后会继续解析'});return;}
      const buttons=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"]')].filter(visible);
      const sharePage=/提取[码碼]|访问[码碼]|分享密[码碼]|access.?code|share.?password/i.test(document.body.innerText);
      const field=[...document.querySelectorAll('input')].find(el=>{const label=[el.placeholder,el.name,el.id,el.getAttribute('aria-label')].join(' ');return visible(el)&&!['hidden','file'].includes(el.type)&&(/提取[码碼]|访问[码碼]|分享密[码碼]|access.?code|share.?password/i.test(label)||sharePage&&/(?:^|\s)pwd(?:$|\s)/i.test(label));});
      if(field){
        if(!code||downloadState.codeSubmitted){reply({state:'code',message:downloadState.codeSubmitted?'已提交提取码，等待网盘响应；若提示错误可手动修正':'此分享需要提取码，请在网盘窗口填写'});return;}
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,code);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
        const button=buttons.find(el=>/^(提取文件|提取|访问文件|查看文件|进入分享|确认|确定|提取码验证)$/.test(text(el)||el.value));
        if(button){button.click();downloadState.codeSubmitted=true;}else if(field.form&&/提取[码碼]|访问[码碼]|分享密[码碼]|access.?code/i.test(text(field.form))&&![...field.form.querySelectorAll('input')].some(el=>el!==field&&visible(el)&&!['hidden','submit','button','checkbox'].includes(el.type))){field.form.requestSubmit();downloadState.codeSubmitted=true;}
        reply({state:'progress',message:'正在提交提取码并查找文件'});return;
      }
      const candidates=[];const names=new Set();
      for(const el of [...document.querySelectorAll('[data-filename],[data-name],[title],a,td,.file-name,.filename,[class*="file-name"]')].filter(visible).slice(0,3000)){
        const value=el.getAttribute('data-filename')||el.getAttribute('data-name')||el.getAttribute('title')||text(el);
        if(value.length>400)continue;const name=value.match(/^([^\n]{1,200}\.(?:txt|epub|pdf|zip|rar|7z))(?=$|\s)/i)?.[1];
        if(name&&!names.has(name)){names.add(name);candidates.push({name,el});}
      }
      candidates.sort((a,b)=>{const rank=name=>/\.txt$/i.test(name)?0:/\.epub$/i.test(name)?1:/\.pdf$/i.test(name)?2:3;return rank(a.name)-rank(b.name);});
      const chosen=candidates[0];
      if(chosen&&!downloadState.selected){
        downloadState.selected=chosen.name;
        const row=chosen.el.closest('[role="row"],tr,li,[data-fsid],[data-id],.wp-s-agile-table__row,.list-view-item,.file-item')||chosen.el.parentElement;
        const box=row?.querySelector('input[type="checkbox"],[role="checkbox"],.wp-s-agile-table__checkbox,.checkbox');
        const anchor=chosen.el.closest('a[href]');
        if(anchor&&/^(https?:|\/)/i.test(anchor.getAttribute('href'))&&!/javascript:/i.test(anchor.href)){anchor.click();reply({state:'progress',message:'正在取得 '+chosen.name+' 的下载地址'});return;}
        if(box&&visible(box)){if(!box.checked&&box.getAttribute('aria-checked')!=='true')box.click();}else chosen.el.click();
      }
      const download=buttons.find(el=>!downloadState.clicked.has(el)&&/^(下载|下载文件|普通下载|直接下载|浏览器下载|立即下载|下载\s*(TXT|EPUB|PDF|ZIP|RAR|7Z)|download(?: file)?)$/i.test(text(el)||el.value));
      if(download){downloadState.clicked.add(download);download.click();reply({state:'progress',message:'正在继续到文件下载步骤'});return;}
      const folder=document.querySelector('[data-isdir="1"],[data-isdir="true"],[data-type="folder"],.fileicon-dir');
      if(!chosen&&folder&&visible(folder)&&!downloadState.clicked.has(folder)){downloadState.clicked.add(folder);const node=folder.closest('tr,li,[role="row"],.list-view-item,.wp-s-agile-table__row')||folder;node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));reply({state:'progress',message:'正在打开分享文件夹'});return;}
      reply({state:'waiting',message:chosen?'已找到 '+chosen.name+'，正在等待下载入口':'正在查找 TXT、EPUB、PDF 等文件'});return;
    }
    if(action==='share-code'){
      if(typeof code!=='string'||!/^[a-zA-Z0-9]{1,16}$/.test(code))throw new Error('提取码无效');
      const sharePage=/提取[码碼]|访问[码碼]|分享密[码碼]|access.?code|share.?password/i.test(document.body?.innerText||'');
      const fields=[...document.querySelectorAll('input')].filter(el=>{const label=[el.placeholder,el.name,el.id,el.getAttribute('aria-label')].join(' ');return !el.disabled && !['hidden','file'].includes(el.type) && el.getBoundingClientRect().width>0 && (/提取[码碼]|访问[码碼]|分享密[码碼]|access.?code|share.?password/i.test(label) || sharePage && /(?:^|\s)pwd(?:$|\s)/i.test(label));});
      if(fields.length!==1){ipcRenderer.send('source-document:response',{id,value:false});return;}
      const field=fields[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,code);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));field.focus();ipcRenderer.send('source-document:response',{id,value:true});return;
    }
    if (action === 'submit') {
      const url = new URL(request.url);
      if (url.origin !== location.origin || !['http:','https:'].includes(url.protocol)) throw new Error('搜索表单来源不一致');
      const values = new URLSearchParams(request.body || '');
      let form = [...document.forms].find(f => f.method.toLowerCase() === 'post' && f.action === url.href && !f.querySelector('input[type="password"],input[type="file"]'));
      if (!form) { form = document.createElement('form');form.method = 'post';form.action = url.href;document.body.append(form); }
      for (const [name,value] of values) {
        let field = form.elements.namedItem(name);
        if (!field) { field = document.createElement('input');field.type = 'hidden';field.name = name;form.append(field); }
        field.value = value;
      }
      form.requestSubmit();
      ipcRenderer.send('source-document:response',{id,value:true});
      return;
    }
    if (action !== 'snapshot' || !document.body) throw new Error('网页尚未加载');
    let hasResults = false;
    try { hasResults = !!selector && !!document.querySelector(selector); } catch { throw new Error('结果选择器无效'); }
    const text = document.body.innerText || '';
    const login = /(?:^|\/)(?:login|signin)(?:[.\/?]|$)/i.test(location.pathname) || /^(?:用户)?(?:登录|登入)/.test(document.title) || (!hasResults && (/游客没有权限|(?:请先|需要|必须)(?:登录|登入|登陆)|(?:登录|登入|登陆)后(?:才能|可|再)|not authenticated|sign in to/i.test(text) || (!!document.querySelector('input[type="password"]') && [...document.querySelectorAll('h1,h2,h3')].some(el=>/登录|登入/.test(el.textContent)))));
    const verification = /just a moment|验证中心|安全验证|人机验证/i.test(document.title) || !!document.querySelector('script[src*="/probe.js"],#cf-challenge-running,.g-recaptcha');
    const empty = /没有(?:找到|搜索到|任何|相关|符合)|暂无(?:搜索|相关|数据)|未找到|空列表|no results/i.test(text);
    const page = document.documentElement.cloneNode(true);
    page.querySelectorAll('script,style,noscript,iframe,input,textarea,select,[contenteditable],meta[name*="csrf"],meta[name*="token"]').forEach(el=>el.remove());
    const html = page.outerHTML;
    if (new TextEncoder().encode(html).byteLength > 8*1024*1024) throw new Error('页面超过 8 MB');
    ipcRenderer.send('source-document:response',{id,value:{text:html,url:location.href,ready:hasResults || login || verification || empty,access:login?'login':verification?'verification':undefined}});
  } catch(error) { ipcRenderer.send('source-document:response',{id,error:error.message}); }
});
