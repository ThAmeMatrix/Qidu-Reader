import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function makeFixtures(directory) {
  await fs.mkdir(directory, { recursive: true });
  const paragraph = '清晨，书页像一扇窗，打开以后便能看见不同的风景。安静地读一段文字，给今天留一点属于自己的时间。';
  await fs.writeFile(path.join(directory, '阅读测试.txt'), `第一章 晨光\n${(paragraph + '\n\n').repeat(22)}第二章 远方\n${(paragraph + '远方的风。\n\n').repeat(22)}第三章 归来\n${(paragraph + '我们回来了。\n\n').repeat(22)}`);
  await fs.writeFile(path.join(directory, '阅读测试.md'), '# Markdown 书页\n\n这是一个可以离线阅读的 Markdown 文档。\n\n## 阅读清单\n\n- 找一本好书\n- 留一点时间\n\n> 在日常中看见微光。\n');
  await fs.writeFile(path.join(directory, '阅读测试.html'), `<html><head><title>网页阅读测试</title></head><body><nav>导航</nav><article><h1>网页阅读测试</h1>${`<p>${paragraph}</p>`.repeat(12)}</article><script>window.untrustedScriptRan = true</script></body></html>`);
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.TimesRoman);
  for (let i = 1; i <= 3; i++) {
    const page = pdf.addPage([595,842]); page.drawRectangle({ x:0,y:0,width:595,height:842,color:rgb(.98,.97,.94) });
    page.drawText('QIDU READER', { x:60,y:760,size:13,font,color:rgb(.55,.45,.32) }); page.drawText(`A quiet page - ${i}`, { x:60,y:690,size:27,font,color:rgb(.25,.3,.24) });
    for (let line = 0; line < 16; line++) page.drawText(`Reading is a quiet journey. Page ${i}, line ${line + 1}.`, { x:60,y:630 - line * 25,size:14,font,color:rgb(.3,.32,.27) });
  }
  await fs.writeFile(path.join(directory, '阅读测试.pdf'), await pdf.save());
  const zip = new JSZip(); zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">qidu-test</dc:identifier><dc:title>EPUB 阅读测试</dc:title><dc:creator>栖读测试</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-23T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
  zip.file('OEBPS/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">第一章 窗边</a></li><li><a href="chapter2.xhtml">第二章 远山</a></li></ol></nav></body></html>');
  for (let i = 1; i <= 2; i++) zip.file(`OEBPS/chapter${i}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${i}章</title></head><body><h1>${i === 1 ? '第一章 窗边' : '第二章 远山'}</h1>${`<p>${paragraph}</p>`.repeat(24)}<script>window.parent.untrustedScriptRan = true</script></body></html>`);
  await fs.writeFile(path.join(directory, '阅读测试.epub'), await zip.generateAsync({ type: 'nodebuffer' }));
  return { directory, paragraph };
}
