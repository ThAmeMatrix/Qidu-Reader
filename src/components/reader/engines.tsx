import {chapterTitle} from '../../lib/importers';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ePub, { type Book as EpubBook, type Rendition, type Contents, type NavItem, type Location } from 'epubjs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { Chapter, ReaderSettings } from '../../types';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
export interface TocEntry { label: string; location: string; depth?: number }
export interface ReadingLocation { location: string; progress: number; label: string; index: number; total: number }
export interface SearchResult { label: string; excerpt: string; location: string }
export interface ReaderHandle { next: () => void; prev: () => void; goTo: (location: string) => void; seek: (progress: number) => void; search: (query: string) => Promise<SearchResult[]> }
// epub.js exposes these members at runtime but its bundled declarations omit them.
const spineLength = (book: EpubBook) => (book.spine as typeof book.spine & { length: number }).length;
interface CommonProps {
  initialLocation?: string; settings: ReaderSettings;
  onReady: (toc: TocEntry[]) => void; onLocation: (location: ReadingLocation) => void;
  onError: (message: string) => void; onSelection: (text: string, location?: string) => void;
  onKey: (event: KeyboardEvent) => void; onActivity: () => void;
}
export const readerPalette = {
  paper: { background: '#f5f0e6', color: '#423d35' },
  light: { background: '#ffffff', color: '#333b3a' },
  dark: { background: '#242826', color: '#c8c9bd' },
  green: { background: '#e5eddf', color: '#384739' },
};

export const TextReader = forwardRef<ReaderHandle, CommonProps & { chapters: Chapter[]; searchQuery: string }>(function TextReader(props, ref) {
  const { chapters, settings, initialLocation, searchQuery } = props;
  const callbacks = useRef(props); callbacks.current = props;
  const [chapter, setChapter] = useState(() => Math.min(chapters.length - 1, Math.max(0, Number(initialLocation?.split(':')[1]) || 0)));
  const scroller = useRef<HTMLDivElement>(null); const article = useRef<HTMLElement>(null);
  const pendingRatio = useRef(Number(initialLocation?.split(':')[2]) || 0);
  const location = useRef(initialLocation || 'text:0:0');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function report() {
    const el = scroller.current; if (!el) return;
    const range = el.scrollHeight - el.clientHeight;
    const ratio = range > 5 ? Math.min(1, el.scrollTop / range) : 1;
    location.current = `text:${chapter}:${ratio.toFixed(5)}`;
    callbacks.current.onLocation({ location: location.current, progress: (chapter + ratio) / chapters.length * 100, label: chapters[chapter].title, index: chapter + 1, total: chapters.length });
  }
  const goTo = (target: string) => {
    const [, index, ratio] = target.split(':');
    const next = Math.min(chapters.length - 1, Math.max(0, Number(index) || 0));
    pendingRatio.current = Math.min(1, Math.max(0, Number(ratio) || 0));
    if (next === chapter) {
      const el = scroller.current!; el.scrollTop = (el.scrollHeight - el.clientHeight) * pendingRatio.current;
      pendingRatio.current = -1; report();
    } else setChapter(next);
  };
  useImperativeHandle(ref, () => ({
    next: () => {
      const el = scroller.current!;
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 12) el.scrollBy({ top: el.clientHeight * .85, behavior: 'smooth' });
      else if (chapter < chapters.length - 1) goTo(`text:${chapter + 1}:0`);
    },
    prev: () => {
      const el = scroller.current!;
      if (el.scrollTop > 12) el.scrollBy({ top: -el.clientHeight * .85, behavior: 'smooth' });
      else if (chapter > 0) goTo(`text:${chapter - 1}:1`);
    },
    goTo,
    seek: progress => { const position = Math.min(chapters.length - .00001, progress / 100 * chapters.length); goTo(`text:${Math.floor(position)}:${position % 1}`); },
    search: async query => {
      const results: SearchResult[] = [];
      for (let i = 0; i < chapters.length; i++) {
        const text = new DOMParser().parseFromString(chapters[i].html, 'text/html').body.textContent || '';
        let from = 0; const lower = text.toLocaleLowerCase();
        while (results.length < 100) {
          const index = lower.indexOf(query.toLocaleLowerCase(), from); if (index < 0) break;
          results.push({ label: chapters[i].title, excerpt: `${index > 25 ? '…' : ''}${text.slice(Math.max(0, index - 25), index + query.length + 65)}…`, location: `text:${i}:${Math.min(.99, index / Math.max(1, text.length))}` });
          from = index + query.length;
        }
      }
      return results;
    },
  }));
  useEffect(() => { callbacks.current.onReady(chapters.map((c,i) => ({ label: c.title, location: `text:${i}:0` }))); }, [chapters]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = scroller.current!;
      if (pendingRatio.current >= 0) { el.scrollTop = (el.scrollHeight - el.clientHeight) * pendingRatio.current; pendingRatio.current = -1; }
      report();
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer.current); };
  }, [chapter, chapters]);
  useEffect(() => {
    if (!article.current) return;
    article.current.querySelectorAll('mark').forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent || '')));
    article.current.normalize();
    if (!searchQuery.trim()) return;
    const walker = document.createTreeWalker(article.current, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = []; let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    for (const textNode of nodes) {
      const value = textNode.textContent || ''; const lower = value.toLocaleLowerCase(); const query = searchQuery.toLocaleLowerCase();
      let last = 0, index = lower.indexOf(query); if (index < 0) continue;
      const fragment = document.createDocumentFragment();
      while (index >= 0) { fragment.append(value.slice(last, index)); const mark = document.createElement('mark'); mark.textContent = value.slice(index, index + query.length); fragment.append(mark); last = index + query.length; index = lower.indexOf(query, last); }
      fragment.append(value.slice(last)); textNode.replaceWith(fragment);
    }
  }, [searchQuery, chapter]);
  return <div className="text-reader-scroll" ref={scroller} onScroll={() => { clearTimeout(timer.current); timer.current = setTimeout(report, 140); }} onMouseUp={() => { const text = window.getSelection()?.toString().trim(); if (text) callbacks.current.onSelection(text, location.current); }} onClick={e => { if ((e.target as HTMLElement).closest('a')) e.preventDefault(); }}>
    <article ref={article} className={`reading-article ${settings.font}`} style={{ maxWidth: settings.width, fontSize: settings.fontSize, lineHeight: settings.lineHeight }} dangerouslySetInnerHTML={{ __html: chapters[chapter].html }} />
    <div className="chapter-navigation"><button disabled={chapter === 0} onClick={() => goTo(`text:${chapter - 1}:0`)}>上一章</button><span>{chapter + 1} / {chapters.length}</span><button disabled={chapter === chapters.length - 1} onClick={() => goTo(`text:${chapter + 1}:0`)}>下一章 →</button></div>
  </div>;
});

export const EpubReader = forwardRef<ReaderHandle, CommonProps & { blob: Blob }>(function EpubReader(props, ref) {
  const container = useRef<HTMLDivElement>(null); const epub = useRef<EpubBook | undefined>(undefined); const rendition = useRef<Rendition | undefined>(undefined);
  const callbacks = useRef(props); callbacks.current = props;
  const run = (action: () => Promise<unknown> | undefined) => { void action()?.catch(e => callbacks.current.onError(`EPUB 无法打开这个位置：${(e as Error).message}`)); };
  const applyTheme = () => {
    const r = rendition.current; if (!r) return;
    const settings = callbacks.current.settings; const palette = readerPalette[settings.theme];
    r.themes.default({
      body: { color: `${palette.color} !important`, background: `${palette.background} !important`, 'font-family': settings.font === 'serif' ? '"SimSun", "Noto Serif SC", serif !important' : '"Microsoft YaHei", sans-serif !important', 'line-height': `${settings.lineHeight} !important`, padding: '0 5% !important' },
      p: { 'line-height': `${settings.lineHeight} !important` },
      '::selection': { background: '#d9bd82' },
      img: { 'max-width': '100% !important', 'max-height': '80vh !important' },
    });
    r.themes.fontSize(`${settings.fontSize}px`);
  };
  useEffect(() => {
    let alive = true; let resize: ResizeObserver | undefined; let book: EpubBook | undefined;
    void (async () => {
      book = ePub(); epub.current = book;
      await book.open(await props.blob.arrayBuffer(), 'binary'); await book.ready;
      if (!alive) return;
      const nav = await book.loaded.navigation;
      const flatten = (items: NavItem[], depth = 0): TocEntry[] => items.flatMap(item => [{ label: item.label.trim(), location: item.href, depth }, ...flatten(item.subitems || [], depth + 1)]);
      const toc=flatten(nav?.toc||[]);
      if(!toc.length){
        for(let i=0;i<spineLength(book);i++){const section=book.spine.get(i);toc.push({label:`第 ${i+1} 节`,location:section.href});}
        const activeBook=book;
        void (async()=>{for(let i=0;i<toc.length&&alive;i++){
          try{const section=activeBook.spine.get(i),doc=await activeBook.load(section.url) as Document;
            toc[i].label=(doc.querySelector('h1,h2,h3')||doc.querySelector('title'))?.textContent?.trim().slice(0,120)||toc[i].label;
          }catch{}
          if(alive&&(i%20===0||i===toc.length-1))callbacks.current.onReady([...toc]);
        }})();
      }
      if(!alive)return;callbacks.current.onReady(toc);
      const r = book.renderTo(container.current!, { width: '100%', height: '100%', spread: 'none', flow: 'paginated', allowScriptedContent: false }); rendition.current = r;
      applyTheme();
      r.hooks.content.register((contents: Contents) => {
        contents.document.addEventListener('keydown', event => callbacks.current.onKey(event));
        contents.document.addEventListener('pointerdown', () => callbacks.current.onActivity());
        contents.document.addEventListener('click', event => { const link = (event.target as HTMLElement).closest('a'); if (link && /^(https?:|javascript:)/i.test(link.getAttribute('href') || '')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
      });
      r.on('selected', (cfi: string, contents: Contents) => { const text = contents.window.getSelection()?.toString().trim(); if (text) callbacks.current.onSelection(text, cfi); });
      r.on('relocated', (loc: Location) => {
        if (!alive) return;
        const total = Math.max(1, spineLength(book!));
        const progress = loc.atEnd ? 100 : book!.locations.length() ? book!.locations.percentageFromCfi(loc.start.cfi) * 100 : (loc.start.index + (loc.start.displayed.page - 1) / Math.max(1, loc.start.displayed.total)) / total * 100;
        callbacks.current.onLocation({ location: loc.start.cfi, progress: Math.min(100, Math.max(0, progress)), label: nav.get(loc.start.href)?.label?.trim() || `第 ${loc.start.index + 1} 章`, index: loc.start.index + 1, total });
      });
      await r.display(props.initialLocation || undefined);
      resize = new ResizeObserver(() => { const el = container.current; if (alive && el) r.resize(el.clientWidth, el.clientHeight); }); resize.observe(container.current!);
      void book.locations.generate(1200).then(() => { if (alive) return r.reportLocation(); }).catch(() => { /* Spine pagination remains available. */ });
    })().catch(e => { if (alive) callbacks.current.onError(`EPUB 打开失败：${(e as Error).message}。请确认文件未加密且格式完整。`); });
    return () => { alive = false; resize?.disconnect(); rendition.current = undefined; epub.current = undefined; try { book?.destroy(); } catch { /* Initialization may have been interrupted. */ } };
  }, [props.blob]);
  useEffect(applyTheme, [props.settings]);
  useImperativeHandle(ref, () => ({
    next: () => run(() => rendition.current?.next()), prev: () => run(() => rendition.current?.prev()),
    goTo: location => run(() => rendition.current?.display(location)),
    seek: progress => { const book = epub.current; if (!book) return; const cfi = book.locations.length() ? book.locations.cfiFromPercentage(Math.min(.99999, progress / 100)) : undefined; const section = book.spine.get(Math.min(spineLength(book) - 1, Math.floor(spineLength(book) * progress / 100))); run(() => rendition.current?.display(cfi || section.href)); },
    search: async query => {
      const book = epub.current; if (!book) return [];
      const results: SearchResult[] = [];
      for (let i = 0; i < spineLength(book) && results.length < 100; i++) {
        const section = book.spine.get(i);
        await section.load(book.load.bind(book));
        for (const match of section.find(query) as unknown as { excerpt: string; cfi: string }[]) results.push({ label: book.navigation.get(section.href)?.label || `第 ${i + 1} 章`, excerpt: match.excerpt, location: match.cfi });
        if (epub.current !== book) break;
      }
      return results.slice(0, 100);
    },
  }));
  return <div className="epub-outer"><div className="epub-container" ref={container} style={{ maxWidth: props.settings.width + 120 }} /></div>;
});

export const PdfReader = forwardRef<ReaderHandle, CommonProps & { blob: Blob; zoom: number }>(function PdfReader(props, ref) {
  const callbacks = useRef(props); callbacks.current = props;
  const [document, setDocument] = useState<PDFDocumentProxy>(); const [page, setPage] = useState(Number(props.initialLocation?.split(':')[1]) || 1);
  const canvas = useRef<HTMLCanvasElement>(null); const textContainer = useRef<HTMLDivElement>(null); const pageContainer = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null); const [availableWidth, setAvailableWidth] = useState(900);
  useEffect(() => {
    let alive = true; let task: ReturnType<typeof pdfjs.getDocument> | undefined;
    void props.blob.arrayBuffer().then(data => {
      if (!alive) return;
      const base = new URL('./pdf-assets/', window.location.href).href;
      task = pdfjs.getDocument({ data: new Uint8Array(data), cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/` });
      return task.promise.then(async doc => {
        if (!alive) return;
        setDocument(doc); setPage(p => Math.min(doc.numPages, Math.max(1, p)));
        const pages=Array.from({length:doc.numPages},(_,i)=>({label:`第 ${i+1} 页`,location:`pdf:${i+1}`}));callbacks.current.onReady(pages);
        try{
          const outline=await doc.getOutline(),toc:TocEntry[]=[];
          type Outline=NonNullable<typeof outline>;
          const walk=async(items:Outline,depth=0):Promise<void>=>{for(const item of items){if(!alive||toc.length>=2000||depth>8)return;try{const dest=typeof item.dest==='string'?await doc.getDestination(item.dest):item.dest;if(dest){const index=typeof dest[0]==='number'?dest[0]:await doc.getPageIndex(dest[0]);toc.push({label:item.title,location:`pdf:${index+1}`,depth});}}catch{}if(item.items?.length)await walk(item.items,depth+1);}};
          if(outline?.length)await walk(outline);
          if(!alive)return;if(toc.length){callbacks.current.onReady(toc);return;}
          for(let i=0;i<doc.numPages;i++){
            if(!alive)return;const page=await doc.getPage(i+1),text=await page.getTextContent();const lines:string[]=[];let line='';
            for(const item of text.items.slice(0,60)){if('str' in item){line+=item.str;if(item.hasEOL){lines.push(line);line='';}}}if(line)lines.push(line);
            const heading=lines.slice(0,8).map(chapterTitle).find(Boolean);if(heading)pages[i].label=heading;if(i%20===19&&alive)callbacks.current.onReady([...pages]);
          }
          if(alive)callbacks.current.onReady([...pages]);
        }catch{/* Page navigation remains available when a PDF has no usable outline/text. */}
      });
    }).catch(e => { if (alive) callbacks.current.onError((e as Error).name === 'PasswordException' ? '此 PDF 需要密码，请先在 PDF 工具中解锁并另存副本后导入。' : `PDF 打开失败：${(e as Error).message}`); });
    return () => { alive = false; void task?.destroy(); };
  }, [props.blob]);
  useEffect(() => {
    const el = scroller.current!; const observer = new ResizeObserver(() => setAvailableWidth(el.clientWidth - 60)); observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document) return;
    let active = true; let render: RenderTask | undefined; let textLayer: pdfjs.TextLayer | undefined;
    void document.getPage(page).then(async pdfPage => {
      if (!active || !canvas.current || !textContainer.current) return;
      const original = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(props.settings.width, availableWidth) / original.width * props.zoom;
      const viewport = pdfPage.getViewport({ scale }); const dpr = Math.min(window.devicePixelRatio, 2);
      const canvasNode = canvas.current;
      canvasNode.width = Math.floor(viewport.width * dpr); canvasNode.height = Math.floor(viewport.height * dpr);
      canvasNode.style.width = `${viewport.width}px`; canvasNode.style.height = `${viewport.height}px`;
      const textNode = textContainer.current; textNode.replaceChildren();
      pageContainer.current!.style.width = `${viewport.width}px`; pageContainer.current!.style.height = `${viewport.height}px`;
      pageContainer.current!.style.setProperty('--scale-factor', String(scale)); pageContainer.current!.style.setProperty('--total-scale-factor', String(scale));
      render = pdfPage.render({ canvas: canvasNode, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await render.promise; if (!active) return;
      textLayer = new pdfjs.TextLayer({ textContentSource: await pdfPage.getTextContent(), container: textNode, viewport });
      await textLayer.render();
    }).catch(e => { if (active && (e as Error).name !== 'RenderingCancelledException' && (e as Error).name !== 'AbortException') callbacks.current.onError(`这一页未能显示：${(e as Error).message}`); });
    return () => { active = false; render?.cancel(); textLayer?.cancel(); };
  }, [document, page, props.settings.width, props.zoom, availableWidth]);
  useEffect(() => {
    if (!document) return;
    scroller.current?.scrollTo({ top: 0 });
    callbacks.current.onLocation({ location: `pdf:${page}`, progress: page / document.numPages * 100, label: `第 ${page} 页`, index: page, total: document.numPages });
  }, [document, page]);
  useImperativeHandle(ref, () => ({
    next: () => setPage(p => Math.min(document?.numPages || 1, p + 1)), prev: () => setPage(p => Math.max(1, p - 1)),
    goTo: location => setPage(Math.min(document?.numPages || 1, Math.max(1, Number(location.split(':')[1]) || 1))),
    seek: progress => setPage(Math.max(1, Math.ceil((document?.numPages || 1) * progress / 100))),
    search: async query => {
      if (!document) return [];
      const results: SearchResult[] = [];
      for (let i = 1; i <= document.numPages && results.length < 100; i++) {
        const pdfPage = await document.getPage(i); const content = await pdfPage.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str : '').join(' ');
        const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
        if (index >= 0) results.push({ label: `第 ${i} 页`, excerpt: text.slice(Math.max(0, index - 25), index + query.length + 80), location: `pdf:${i}` });
      }
      return results;
    },
  }));
  return <div ref={scroller} className="pdf-scroll" onMouseUp={() => { const text = window.getSelection()?.toString().trim(); if (text) callbacks.current.onSelection(text, `pdf:${page}`); }}><div className="pdf-page" ref={pageContainer}><canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} /><div className="textLayer" ref={textContainer} /></div></div>;
});
