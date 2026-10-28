const {BrowserWindow,WebContentsView,ipcMain,clipboard}=require('electron');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {validateUrl}=require('./web.cjs');
const {getSourceSession,registerDownloadCapture}=require('./source-session.cjs');
const {captureSource,documentRequest}=require('./source-render.cjs');
let current;const contexts=new Set();
function registerDownloadWindow(getMain,getDownloads){
  ipcMain.handle('download-window:action',async(event,action)=>{
    const state=current;if(!state||event.sender!==state.window.webContents||event.senderFrame!==event.sender.mainFrame)throw new Error('不允许的网盘窗口调用');
    const web=state.view.webContents;
    if(action==='back'&&web.navigationHistory.canGoBack())web.navigationHistory.goBack();
    else if(action==='reload')web.reload();
    else if(action==='copy-code'){clipboard.writeText(state.context.password||'');return '提取码已复制';}
    else if(action==='fill-code'){if(!state.context.password)return '此分享未提供提取码';const filled=await documentRequest(web,'share-code',{code:state.context.password});return filled?'已填入提取码，请在网盘页面确认':'未找到提取码输入框，可复制后粘贴';}
    else if(action==='capture'){
      if(!contexts.has(state.context.id))throw new Error('原资源卡片已关闭，请使用网页下载按钮，或在下载方案中重新打开分享');
      const response=await captureSource(web);const main=getMain();if(!main||main.isDestroyed()||main.webContents.isDestroyed())throw new Error('主窗口已关闭');
      main.webContents.send('downloads:page',{...response,status:response.status||200,contentType:response.contentType||'text/html',contextId:state.context.id});
      return '文件链接已读回下载结果；网页下载按钮也可以直接使用';
    }else if(action==='return'){
      const main=getMain();if(main&&!main.isDestroyed()&&process.env.QIDU_TEST_HIDE!=='1'){main.show();main.focus();}state.window.hide();
    }
    return '';
  });
  const open=async context=>{
    const url=validateUrl(context?.url).href;
    if(typeof context.id!=='string'||context.id.length>100||typeof context.bookTitle!=='string'||context.bookTitle.length>1000||typeof context.bookAuthor!=='string'||context.bookAuthor.length>1000||context.password!==undefined&&!/^[a-zA-Z0-9]{1,16}$/.test(context.password))throw new Error('网盘资料无效');
    await getDownloads().ready;
    if(current&&!current.window.isDestroyed()&&current.context.id===context.id&&!context.restart){if(process.env.QIDU_TEST_HIDE!=='1')current.window.show();return;}
    if(current&&!current.window.isDestroyed()){if(!current.prepared&&current.context.id!==context.id)current.sendStatus?.('已暂停此分享的解析，可点击重新解析文件继续。',true);current.stopped=true;current.window.close();}
    const win=new BrowserWindow({parent:getMain(),show:!context.resolve&&process.env.QIDU_TEST_HIDE!=='1',width:1120,height:840,minWidth:800,minHeight:600,title:'网盘下载 · 栖读',autoHideMenuBar:true,backgroundColor:'#f8f7f3',webPreferences:{preload:path.join(__dirname,'download-window-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    const view=new WebContentsView({webPreferences:{session:getSourceSession(),preload:path.join(__dirname,'source-document.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});win.contentView.addChildView(view);
    const state={window:win,view,context:{...context,url},stopped:false,prepared:false};current=state;
    const resize=()=>{const [width,height]=win.getContentSize();view.setBounds({x:0,y:104,width,height:Math.max(0,height-104)});};resize();win.on('resize',resize);
    const publish=(message='')=>{if(!win.isDestroyed()&&!win.webContents.isDestroyed()&&!view.webContents.isDestroyed())win.webContents.send('download-window:state',{url:view.webContents.getURL(),loading:view.webContents.isLoading(),canCapture:contexts.has(context.id),password:context.password||'',message});};
    state.publish=publish;
    const sendStatus=(message,done=false)=>{publish(message);const main=getMain();if(main&&!main.isDestroyed()&&!main.webContents.isDestroyed())main.webContents.send('downloads:resolve-status',{contextId:context.id,message,done});};
    state.sendStatus=sendStatus;
    const release=registerDownloadCapture(view.webContents,item=>{
      if(context.resolve){void getDownloads().prepareBrowser(item,state.context).then(file=>{state.prepared=true;const main=getMain();if(main&&!main.isDestroyed()&&!main.webContents.isDestroyed())main.webContents.send('downloads:prepared',{contextId:context.id,file});sendStatus('文件已就绪。返回资源卡片选择「加载到本地」后下载。',true);}).catch(e=>{try{item.cancel();}catch{}sendStatus(e.message,true);});}
      else void getDownloads().captureBrowser(item,state.context).then(()=>publish('已加入栖读下载任务；书籍可入架，压缩包可另存')).catch(e=>{try{item.cancel();}catch{}publish(e.message);});
    });
    const allowed=value=>{try{validateUrl(value);return true;}catch{return false;}};
    view.webContents.setWindowOpenHandler(({url})=>{if(allowed(url))void view.webContents.loadURL(url).catch(e=>publish(e.message));return {action:'deny'};});
    for(const name of ['will-navigate','will-redirect','will-frame-navigate'])view.webContents.on(name,(event,value)=>{const target=typeof value==='string'?value:event.url;if(name==='will-frame-navigate'&&!event.isMainFrame&&target==='about:blank')return;if(!allowed(target)){event.preventDefault();publish('该按钮要求外部客户端。可在此选择网盘提供的网页下载方式。');}});
    view.webContents.on('did-start-loading',()=>publish());view.webContents.on('did-stop-loading',()=>publish());view.webContents.on('did-fail-load',(_e,code,description,_url,main)=>{if(main&&code!==-3)publish('加载失败：'+description);});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{if(!state.prepared&&!state.stopped)sendStatus('网盘窗口已关闭，可重新解析文件。',true);state.stopped=true;release();if(!view.webContents.isDestroyed())view.webContents.close();if(current===state)current=undefined;});
    await win.loadFile(path.join(__dirname,'download-window.html'));publish();void view.webContents.loadURL(url).catch(e=>publish(e.message));
    if(context.resolve)void (async()=>{
      let steps=0,shown=false;const started=Date.now();
      while(!state.stopped&&!state.prepared&&!win.isDestroyed()&&Date.now()-started<180000){
        await delay(900);if(state.stopped||state.prepared||view.webContents.isDestroyed())break;
        if(view.webContents.isLoading())continue;
        try{const result=await documentRequest(view.webContents,'download-auto',{code:context.password});steps++;if(!state.prepared&&!state.stopped)sendStatus(result.message);
          if(['login','verification'].includes(result.state)||result.state==='code'&&steps>4||steps>25){if(!shown&&process.env.QIDU_TEST_HIDE!=='1'){win.show();shown=true;}}
        }catch(e){if(steps>10)sendStatus(e.message);}
      }
      if(!state.prepared&&!state.stopped){sendStatus('自动解析尚未取得文件。可在网盘窗口完成提取或选择文件，下载入口会继续读回此处。',true);if(process.env.QIDU_TEST_HIDE!=='1')win.show();}
    })();

  };
  open.stop=id=>{if(current?.context.id===id)current.stopped=true;};
  open.setContext=(id,active)=>{if(typeof id!=='string'||id.length>100||typeof active!=='boolean')throw new Error('资源卡片资料无效');if(active)contexts.add(id);else {contexts.delete(id);if(current?.context.id===id)current.stopped=true;}if(current?.context.id===id)current.publish();};
  return open;
}
module.exports={registerDownloadWindow};
