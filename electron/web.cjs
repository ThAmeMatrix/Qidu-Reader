function validateUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('请输入有效的网页链接');
  let url;
  try { url = new URL(value); } catch { throw new Error('链接格式不正确，请包含 https://'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持 http / https 网页链接');
  return url;
}

async function fetchArticle(value) {
  let url = validateUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetch(url, {
        signal: controller.signal, redirect: 'manual',
        headers: { 'User-Agent': 'QiduReader/1.0 (Personal reading)', Accept: 'text/html,application/xhtml+xml,text/plain' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 5) throw new Error('网页重定向次数过多');
        url = validateUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`网页返回 ${response.status}，请检查链接是否可以公开访问`); }
      const type = response.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)) {
        await response.body?.cancel(); throw new Error('该链接不是文本网页，请下载文件后通过「导入书籍」打开');
      }
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('网页内容超过 8 MB，建议保存为 HTML 后导入'); }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const charset = type.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] || 'utf-8';
      let html;
      try { html = new TextDecoder(charset).decode(bytes); } catch { html = bytes.toString('utf-8'); }
      if (type.includes('text/plain')) html = `<html><body><article><pre>${html.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre></article></body></html>`;
      return { html, url: url.href };
    }
    throw new Error('无法获取网页');
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('网页加载超时，请稍后重试');
    throw error;
  } finally { clearTimeout(timer); }
}
module.exports = { fetchArticle, validateUrl };
