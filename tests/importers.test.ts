import { describe, expect, it } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import JSZip from 'jszip';
import { articleFromHtml, decodeText, importFile, sanitizeHtml, textChapters } from '../src/lib/importers';

const file = (data: BlobPart[], name: string) => new NodeFile(data as ConstructorParameters<typeof NodeFile>[0], name) as unknown as File;

describe('text importing', () => {
  it('recognizes prefixed, spaced, full-width and numbered chapter headings',()=>{const chapters=textChapters('正文 第一章 初见\n开篇正文。\n第 ２ 章 重逢\n第二章正文。\n番外 尾声\n结束。','小说');expect(chapters.map(c=>c.title)).toEqual(['第一章 初见','第 ２ 章 重逢','番外 尾声']);expect(textChapters('001 出发\n旅途。\n002 归来\n回家。','小说')).toHaveLength(2);});
  it('splits HTML headings into navigable chapters without dropping introduction or text',()=>{const result=articleFromHtml('<p>开头介绍，不应丢失。</p><h2>第一章 起点</h2><p>第一章的完整内容。</p><h2>第二章 归来</h2><p>第二章的完整内容。</p>','小说');expect(result.chapters.map(c=>c.title)).toContain('第二章 归来');expect(result.chapters.map(c=>c.html).join('')).toContain('开头介绍');});

  it('decodes UTF-8, UTF-16 and legacy GBK Chinese text', () => {
    expect(decodeText(new TextEncoder().encode('春天的书页').buffer)).toBe('春天的书页');
    expect(decodeText(Uint8Array.from([0xff,0xfe,0x60,0x4f,0x7d,0x59]).buffer)).toBe('你好');
    expect(decodeText(Uint8Array.from([0xc4,0xe3,0xba,0xc3]).buffer)).toBe('你好');
  });
  it('detects Chinese and English chapters and safely escapes text', () => {
    const chapters = textChapters('序章\r\n初见\r\n第一章 风起\r\n<script>alert(1)</script>\r\nChapter 2 A new day\r\nA story.', '书');
    expect(chapters.map(c => c.title)).toEqual(['序章','第一章 风起','Chapter 2 A new day']);
    expect(chapters[1].html).toContain('&lt;script&gt;');
  });
  it('chunks large files without losing their text', () => {
    const chapters = textChapters('山'.repeat(36000), '山');
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters.map(c => c.html.match(/<p>(.*?)<\/p>/g)?.join('')).join('').match(/山/g)?.length).toBe(36000);
  });
  it('rejects empty and unsupported files', async () => {
    await expect(importFile(file([], '空白.txt'))).rejects.toThrow('文件为空');
    await expect(importFile(file(['test'], 'test.exe'))).rejects.toThrow('不支持');
    await expect(importFile(file(['hello'], 'fake.pdf'))).rejects.toThrow('有效的 PDF');
  });
  it('hashes identical text files the same even with different filenames', async () => {
    const a = await importFile(file(['第一章\n你好世界。'], 'a.txt'));
    const b = await importFile(file(['第一章\n你好世界。'], 'b.txt'));
    expect(a.book.fingerprint).toBe(b.book.fingerprint);
    expect(a.payload.chapters?.[0].title).toBe('第一章');
  });
});

describe('untrusted documents', () => {
  it('strips active HTML, remote images, styles and unsafe URLs', () => {
    const clean = sanitizeHtml('<p onclick="alert(1)" style="position:fixed">正文</p><script>alert(1)</script><iframe src="https://example.com"></iframe><img src="https://example.com/tracker"><a href="javascript:alert(1)">click</a><form><input></form>');
    expect(clean).toContain('<p>正文</p>');
    expect(clean).not.toMatch(/onclick|style=|<script|<iframe|<img|javascript:|<form|<input/);
  });
  it('extracts an article and its title from HTML', () => {
    const article = articleFromHtml(`<html><head><title>安静的阅读</title></head><body><nav>导航</nav><article><h1>安静的阅读</h1><p>${'书页之间有新的世界。'.repeat(50)}</p></article><script>window.pwned = true</script></body></html>`, 'fallback');
    expect(article.title).toBe('安静的阅读');
    expect(article.chapters[0].html).toContain('书页之间');
    expect(article.chapters[0].html).not.toContain('window.pwned');
  });
  it('rejects webpages with no readable content', () => expect(() => articleFromHtml('<html><body></body></html>', 'empty')).toThrow('未找到'));
  it('uses a Markdown-style first heading when document metadata is absent', () => {
    expect(articleFromHtml('<h1>Markdown 书页</h1><p>一个本地文档，留下自己的阅读记录。</p>', 'filename').title).toBe('Markdown 书页');
  });
});

describe('EPUB importing', () => {
  it('reads EPUB metadata and stores the original container', async () => {
    const zip = new JSZip(); zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
    zip.file('OEBPS/content.opf', '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试 EPUB</dc:title><dc:creator>栖读</dc:creator></metadata><manifest/><spine/></package>');
    const bytes = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await importFile(file([bytes], 'book.epub'));
    expect(result.book.title).toBe('测试 EPUB'); expect(result.book.author).toBe('栖读'); expect(result.payload.blob?.size).toBeGreaterThan(0);
  });
  it('rejects a ZIP file disguised as an EPUB', async () => {
    const zip = new JSZip(); zip.file('random.txt', 'hello');
    await expect(importFile(file([await zip.generateAsync({ type: 'arraybuffer' })], 'fake.epub'))).rejects.toThrow('缺少书籍目录');
  });
});
