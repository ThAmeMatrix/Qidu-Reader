const { net } = require('electron');

// net.fetch cannot expose manual redirect responses in this Electron release.
// Adapt net.request so sources.cjs can validate each hop and keep its size limits.
function sessionFetch(isolated, url, options) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: options.method, headers: options.headers, session: isolated, credentials: 'include', redirect: 'manual' });
    const abort = () => { request.abort();reject(new DOMException('已取消', 'AbortError')); };
    if (options.signal?.aborted) { abort();return; }
    options.signal?.addEventListener('abort',abort,{once:true});
    request.on('close', () => options.signal?.removeEventListener('abort',abort));
    request.on('error',reject);
    const headersFor = values => {
      const headers = new Headers();
      for (const [key,value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) headers.append(key,item);
      return headers;
    };
    request.on('redirect', (status,_method,location,values) => {
      const headers = headersFor(values);headers.set('location',location);
      resolve(new Response(null,{status,headers}));
      request.abort(); // The bounded caller validates and requests the next URL.
    });
    request.on('response', response => {
      let ended = false;
      const stream = new ReadableStream({
        start(controller) {
          response.pause();
          response.on('data',chunk => { if (!ended) { controller.enqueue(chunk);if(controller.desiredSize<=0)response.pause(); } });
          response.on('end',() => { if (!ended) { ended=true;controller.close(); } });
          const fail = error => { if (!ended) { ended=true;controller.error(error); } };
          response.on('error',fail);response.on('aborted',()=>fail(new DOMException('已取消','AbortError')));
        },
        pull() { if(!ended)response.resume(); },
        cancel() { ended=true;request.abort(); },
      });
      resolve(new Response([204,205,304].includes(response.statusCode) ? null : stream,{status:response.statusCode,headers:headersFor(response.headers)}));
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}
module.exports = { sessionFetch };
