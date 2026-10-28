const {formatFromName,formatFromMime}=require('./download-formats.cjs');
const { validateUrl } = require('./web.cjs');

function validateRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('搜索请求无效');
  const url = validateUrl(request.url);
  if (request.method && !['GET', 'POST'].includes(request.method)) throw new Error('只支持 GET / POST 搜索');
  if (request.body !== undefined && (typeof request.body !== 'string' || request.body.length > 8000)) throw new Error('搜索参数过长');
  if (request.charset && !['auto', 'utf-8', 'gb18030'].includes(request.charset)) throw new Error('不支持的网页编码');
  if (request.render !== undefined && typeof request.render !== 'boolean') throw new Error('网页加载方式无效');
  if (request.downloadPage !== undefined && typeof request.downloadPage !== 'boolean') throw new Error('下载页面参数无效');
  if (request.readySelector !== undefined && (typeof request.readySelector !== 'string' || request.readySelector.length > 1000)) throw new Error('结果选择器无效');
  if (request.referrer !== undefined) validateUrl(request.referrer);
  return url;
}

async function fetchSource(request, transport = {}) {
  let url = validateRequest(request); let method = request.method || 'GET'; let body = method === 'POST' ? request.body || '' : undefined;
  const requestFetch = transport.fetch || fetch;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 18000);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const referrer = request.referrer && new URL(request.referrer).origin === url.origin ? new URL(request.referrer).href : url.origin + '/';
      const response = await requestFetch(url.href, { method, body, signal: controller.signal, redirect: 'manual', credentials: 'include', headers: {
        'User-Agent': transport.userAgent || 'QiduReader/1.1 (Personal reading)', Accept: 'text/html,application/xhtml+xml,application/json,text/plain',
        Referer: referrer, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(referrer).origin } : {}),
      } });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirects === 5) throw new Error('站点重定向次数过多');
        url = validateUrl(new URL(location, url).href);
        if ([301,302,303].includes(response.status)) { method = 'GET'; body = undefined; }
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      if (request.downloadPage && response.status===200 && !/html|json|javascript/i.test(contentType)) {
        const disposition=response.headers.get('content-disposition') || '';
        let suggested;try{suggested=decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || '');}catch{}
        suggested=suggested || disposition.match(/filename="([^"]+)"|filename=([^;\s]+)/i)?.slice(1).find(Boolean);
        let name;try{name=suggested || decodeURIComponent(url.pathname.split('/').pop());}catch{name=suggested || url.pathname.split('/').pop();}
        const mimeFormat=formatFromMime(contentType),format=formatFromName(name) || (mimeFormat!=='TXT'?mimeFormat:undefined);
        if (format) { await response.body?.cancel(); return {text:'',url:url.href,status:response.status,contentType,download:{name:String(name||'电子书').slice(0,200),format}}; }
      }
      if (contentType && !/text\/|json|xhtml/i.test(contentType)) { await response.body?.cancel(); throw new Error('站点返回了非文本内容'); }
      if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) { await response.body?.cancel(); throw new Error('页面超过 8 MB，无法读取'); }
      const chunks = []; let length = 0;
      if (response.body) for await (const chunk of response.body) {
        length += chunk.length; if (length > 8 * 1024 * 1024) { controller.abort(); throw new Error('页面超过 8 MB，无法读取'); } chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks); const prefix = bytes.toString('ascii',0,2048);
      const charset = request.charset && request.charset !== 'auto' ? request.charset : contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || prefix.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
      let text; try { text = new TextDecoder(charset).decode(bytes); } catch { text = bytes.toString('utf8'); }
      return { text, url: url.href, status: response.status, contentType };
    }
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new Error('站点响应超时，请稍后重试或打开站点窗口');
    if (error.message === 'fetch failed') throw new Error('连接站点失败，请检查网络或在站点窗口打开');
    throw error;
  } finally { clearTimeout(timer); }
}
module.exports = { fetchSource, validateRequest };
