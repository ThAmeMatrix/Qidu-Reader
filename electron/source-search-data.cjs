// Fanqie's result cards have click handlers instead of book links. Read only the
// public book-search response already requested by its own page. Do not collect
// request headers, cookies, login responses, or other network response bodies.
const states = new WeakMap();
const MAX_BYTES = 8 * 1024 * 1024;
const endpoint = url => url.protocol === 'https:' && url.hostname === 'fanqienovel.com' && /^\/api\/author\/search\/search_book\/v1\/?$/.test(url.pathname);
const searchPage = value => { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'fanqienovel.com' && url.pathname.startsWith('/search/'); } catch { return false; } };

function watchSourceSearch(web) {
  const state = { response:undefined, requests:new Map(), sequence:0, generation:0, attached:false };
  states.set(web,state);
  const clear = () => { state.response=undefined;state.requests.clear();state.generation++; };
  web.on('did-start-navigation', (_event,url,_inPlace,main) => {
    if (!main) return;
    // A new query, including a SPA route change, invalidates the previous list.
    clear();
    if (searchPage(url) && !state.attached) {
      try { web.debugger.attach('1.3');state.attached=true;void web.debugger.sendCommand('Network.enable',{maxResourceBufferSize:MAX_BYTES,maxTotalBufferSize:MAX_BYTES}).catch(()=>{}); } catch { /* DOM fallback remains available. */ }
    } else if (!searchPage(url) && state.attached) {
      try { web.debugger.detach(); } catch { /* The target may already be closed. */ }
      state.attached=false;
    }
  });
  web.debugger.on('message', async (_event,method,params) => {
    if (!searchPage(web.getURL())) return;
    if (method === 'Network.requestWillBeSent') {
      let url;try { url=new URL(params.request.url); } catch { return; }
      if (!endpoint(url)) return;
      state.response=undefined;state.sequence++;
      state.requests.clear();
      state.requests.set(params.requestId,{sequence:state.sequence,generation:state.generation});
      return;
    }
    if (method === 'Network.responseReceived') {
      let url;try { url=new URL(params.response.url); } catch { return; }
      if (!endpoint(url) || !['XHR','Fetch'].includes(params.type)) return;
      const publicUrl=new URL(url.origin+url.pathname);
      for (const key of ['filter','page_count','page_index','query_type','query_word']) if (url.searchParams.has(key)) publicUrl.searchParams.set(key,url.searchParams.get(key));
      const sequence=state.requests.get(params.requestId)?.sequence;
      if (!sequence) return;
      state.response=undefined;
      state.requests.set(params.requestId,{url:publicUrl.href,status:params.response.status,sequence,generation:state.generation});
      return;
    }
    if (!['Network.loadingFinished','Network.loadingFailed'].includes(method)) return;
    const request=state.requests.get(params.requestId);if (!request?.url) return;
    state.requests.delete(params.requestId);
    let payload={code:-100};
    try {
      if (method === 'Network.loadingFinished' && params.encodedDataLength <= MAX_BYTES) {
        const body=await web.debugger.sendCommand('Network.getResponseBody',{requestId:params.requestId});
        const text=body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body;
        if (Buffer.byteLength(text)>MAX_BYTES) throw new Error('Search response too large');
        const data=JSON.parse(text);
        if (data.code===0 && Array.isArray(data.data?.search_book_data_list)) {
          const fields=['book_id','book_name','author','book_abstract','thumb_url','category','creation_status'];
          payload={code:0,data:{total_count:data.data.total_count,search_book_data_list:data.data.search_book_data_list.slice(0,100).filter(b=>b && typeof b==='object').map(b=>Object.fromEntries(fields.filter(k=>typeof b[k]==='string' || typeof b[k]==='number').map(k=>[k,b[k]])))}};
        }
      }
    } catch { /* An empty/failed response must not be reported as zero results. */ }
    if (request.generation===state.generation && request.sequence===state.sequence && searchPage(web.getURL())) state.response={text:JSON.stringify(payload),url:request.url,status:request.status,contentType:'application/json',ready:true};
  });
  web.debugger.on('detach',()=>{state.attached=false;clear();});
  web.once('destroyed',()=>{clear();states.delete(web);});
}

function sourceSearchResponse(web) { return searchPage(web.getURL()) ? states.get(web)?.response : undefined; }
module.exports={watchSourceSearch,sourceSearchResponse};
