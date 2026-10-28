import DOMPurify from 'dompurify';
import { Readability } from '@mozilla/readability';
import { marked } from 'marked';
import JSZip from 'jszip';
import type { Book, BookFormat, BookPayload, Chapter } from '../types';

export const allowedExtensions = ['txt', 'epub', 'pdf', 'html', 'htm', 'md', 'markdown'];
export const fileAccept = allowedExtensions.map(e => `.${e}`).join(',');
export const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'div', 'span', 'figure', 'figcaption', 'a'],
    ALLOWED_ATTR: ['id', 'href', 'title', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
  });
}

export function chapterTitle(value:string):string|undefined {
  const title=value.trim().replace(/^#{1,6}\s*/, '').replace(/^(?:正文|作品正文)\s*/, '').replace(/^[【\[](.+)[】\]]$/, '$1');
  if(!title||title.length>65||/[。！？!?；;]$/.test(title))return;
  const normalized=title.normalize('NFKC').replace(/([第零〇一二三四五六七八九十百千万兩两壹贰叁肆伍陆柒捌玖拾佰仟\d])\s+(?=[零〇一二三四五六七八九十百千万兩两壹贰叁肆伍陆柒捌玖拾佰仟\d章节卷回部篇])/g,'$1');
  if(/^(?:第[零〇一二三四五六七八九十百千万兩两壹贰叁肆伍陆柒捌玖拾佰仟\d]+[章节卷回部篇]|(?:chapter|book|part)\s+(?:[\divxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b|序章|楔子|序言|前言|后记|後記|尾声|尾聲|终章|終章|番外|prologue\b|epilogue\b)/i.test(normalized))return title;
}
const numberedHeading=(line:string)=>/^\s*(?:\d{1,5}|[一二三四五六七八九十百]+)[、.．:：)）\s]\s*[^。！？!?]{1,35}\s*$/.test(line);

export function textChapters(text: string, title: string): Chapter[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
  const numbered=lines.filter(numberedHeading).length>=2;
  const heading=(line:string)=>chapterTitle(line)||(numbered&&numberedHeading(line)?line.trim():undefined);
  const chapters: Chapter[] = [];
  let name = title; let paragraphs: string[] = []; let length = 0;
  const flush = () => {
    if (!paragraphs.length) return;
    chapters.push({ id: `chapter-${chapters.length}`, title: name, html: `<h2>${escapeHtml(name)}</h2>${paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}` });
    paragraphs = []; length = 0;
  };
  const hasHeadings = lines.some(line => heading(line));
  for (const line of lines) {
    if (heading(line)) { flush(); name = heading(line)!; }
    else if (line.trim()) {
      // Split very long unbroken files so the reader remains responsive.
      const pieces = !hasHeadings && line.length > 10000 ? line.match(/[\s\S]{1,6000}/g)! : [line];
      for (const piece of pieces) {
        if (!hasHeadings && length > 6000) { flush(); name = `${title} · ${chapters.length + 1}`; }
        paragraphs.push(piece.trim()); length += piece.length;
      }
    }
  }
  flush();
  if (!chapters.length) throw new Error('文件中没有可阅读的文字');
  return chapters;
}

export function articleFromHtml(html: string, fallbackTitle: string): { title: string; author: string; chapters: Chapter[] } {
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,style,iframe,form,nav,footer,noscript').forEach(node => node.remove());
  const parsed = new Readability(document.cloneNode(true) as Document, { charThreshold: 80 }).parse();
  const title = parsed?.title || document.title || document.querySelector('h1')?.textContent || fallbackTitle;
  const content = sanitizeHtml(parsed?.content || document.body.innerHTML);
  const check = new DOMParser().parseFromString(content, 'text/html');
  if ((check.body.textContent || '').trim().length < 10) throw new Error('未找到可阅读的正文；该网页可能需要登录或动态加载。可在浏览器中另存为 HTML 后导入。');
  const headings=[...check.body.querySelectorAll('h1,h2,h3')].slice(0,2000);
  const chapters:Chapter[]=[];
  if(headings.length>1){
    for(let i=-1;i<headings.length;i++){
      const range=check.createRange();if(i<0)range.setStart(check.body,0);else range.setStartBefore(headings[i]);
      if(i+1<headings.length)range.setEndBefore(headings[i+1]);else range.setEnd(check.body,check.body.childNodes.length);
      const holder=check.createElement('div');holder.append(range.cloneContents());
      if(holder.textContent?.trim())chapters.push({id:`chapter-${chapters.length}`,title:i<0?title.trim():headings[i].textContent?.trim()||title.trim(),html:holder.innerHTML});
    }
  }
  return { title: title.trim(), author: parsed?.byline || '网页文章', chapters:chapters.length?chapters:[{id:'chapter-0',title:title.trim(),html:content}] };
}

export async function fingerprint(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function importFile(file: File): Promise<{ book: Book; payload: BookPayload }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!allowedExtensions.includes(ext)) throw new Error(`不支持 .${ext} 格式`);
  if (file.size > 100 * 1024 * 1024) throw new Error('单个文件不能超过 100 MB');
  if (!file.size) throw new Error('文件为空');
  const buffer = await file.arrayBuffer();
  const format = ({ htm: 'HTML', markdown: 'MD' }[ext] || ext.toUpperCase()) as BookFormat;
  const book: Book = {
    id: crypto.randomUUID(), title: file.name.replace(/\.[^.]+$/, ''), author: '未知作者', format,
    status: 'want', progress: 0, cover: Math.floor(Math.random() * 6), collectionIds: [],
    addedAt: Date.now(), size: file.size, fingerprint: await fingerprint(buffer),
  };
  const payload: BookPayload = { id: book.id };
  if (format === 'EPUB') {
    const zip = await JSZip.loadAsync(buffer);
    const parser = new DOMParser();
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('不是有效的 EPUB 文件：缺少书籍目录');
    const container = parser.parseFromString(await containerFile.async('string'), 'application/xml');
    const rootPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
    const rootFile = rootPath && zip.file(rootPath);
    if (!rootFile) throw new Error('EPUB 书籍结构不完整');
    const metadata = parser.parseFromString(await rootFile.async('string'), 'application/xml');
    const metadataText = (tag: string) => metadata.getElementsByTagNameNS('*', tag)[0]?.textContent;
    book.title = metadataText('title') || book.title;
    book.author = metadataText('creator') || '未知作者';
    book.description = (metadataText('description') || '').replace(/<[^>]*>/g, '').slice(0, 800);
    const items = [...metadata.getElementsByTagNameNS('*', 'item')];
    const coverId = [...metadata.getElementsByTagNameNS('*', 'meta')].find(n => n.getAttribute('name') === 'cover')?.getAttribute('content');
    const cover = items.find(n => n.getAttribute('properties')?.split(' ').includes('cover-image') || (coverId && n.getAttribute('id') === coverId));
    if (cover && /^image\/(png|jpeg|webp|gif)$/.test(cover.getAttribute('media-type') || '')) {
      const prefix = rootPath!.slice(0, rootPath!.lastIndexOf('/') + 1);
      const resolved = new URL(cover.getAttribute('href') || '', `https://epub.invalid/${prefix}`).pathname.slice(1);
      const coverFile = zip.file(decodeURIComponent(resolved));
      if (coverFile) {
        const bytes = await coverFile.async('uint8array');
        if (bytes.length < 2 * 1024 * 1024) book.coverImage = `data:${cover.getAttribute('media-type')};base64,${await coverFile.async('base64')}`;
      }
    }
    payload.blob = new Blob([buffer], { type: 'application/epub+zip' });
  } else if (format === 'PDF') {
    if (!new TextDecoder().decode(buffer.slice(0, 1024)).includes('%PDF-')) throw new Error('不是有效的 PDF 文件');
    payload.blob = new Blob([buffer], { type: 'application/pdf' });
  } else {
    const text = decodeText(buffer);
    if (format === 'HTML' || format === 'MD') {
      const html = format === 'MD' ? await marked.parse(text) : text;
      const article = articleFromHtml(html, book.title);
      book.title = article.title;
      book.author = format === 'MD' ? '本地文档' : article.author;
      payload.chapters = article.chapters;
    } else payload.chapters = textChapters(text, book.title);
  }
  return { book, payload };
}

export async function importUrl(value: string): Promise<{ book: Book; payload: BookPayload }> {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入 http / https 网页链接');
  let html: string; let finalUrl: string = url.href;
  if (window.desktop) ({ html, url: finalUrl } = await window.desktop.fetchArticle(url.href));
  else {
    try {
      const response = await fetch(url.href, { signal: AbortSignal.timeout(20000), credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
    } catch { throw new Error('此网页不允许浏览器跨域读取。请使用桌面版导入链接，或将网页另存为 HTML 后导入。'); }
  }
  const article = articleFromHtml(html, url.hostname);
  const book: Book = {
    id: crypto.randomUUID(), title: article.title, author: article.author, format: 'WEB',
    status: 'want', progress: 0, cover: 1, collectionIds: [], addedAt: Date.now(), size: new Blob([html]).size,
    sourceUrl: finalUrl, fingerprint: `url:${url.href}`,
  };
  return { book, payload: { id: book.id, chapters: article.chapters } };
}
