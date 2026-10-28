import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, BookmarkPlus, Check, ChevronLeft, ChevronRight, Expand, Highlighter, List, LoaderCircle, MessageSquareText, Minus, PanelLeftClose, Plus, Search, Settings2, Shrink, Trash2, Type, X } from 'lucide-react';
import { sameReadingLocation } from '../lib/bookmarks';
import type { Book, BookPayload, Note, ReaderSettings } from '../types';
import { readablePayload } from '../lib/book-cache';
import { sampleChapters } from '../lib/samples';
import { EpubReader, PdfReader, TextReader, readerPalette, type ReaderHandle, type ReadingLocation, type SearchResult, type TocEntry } from './reader/engines';
import { EmptyState, IconButton } from './ui';

interface Props {
  book: Book; initialLocation?: string; settings: ReaderSettings; notes: Note[];
  onClose: () => void; onProgress: (location: string, progress: number) => void;
  onSettings: (settings: ReaderSettings) => void; onNote: (note: Note) => void;
  onDeleteNote: (id: string) => void;
  onTick: (seconds: number) => void; onReview: () => void;
}

export default function Reader(props: Props) {
  const { book, settings } = props;
  const callbacks = useRef(props); callbacks.current = props;
  const initialLocation = useRef(props.initialLocation || book.location);
  const engine = useRef<ReaderHandle>(null); const searchInput = useRef<HTMLInputElement>(null);
  const [payload, setPayload] = useState<BookPayload>(); const [error, setError] = useState('');
  const [toc, setToc] = useState<TocEntry[]>([]); const [ready, setReady] = useState(false);
  const [location, setLocation] = useState<ReadingLocation>({ location: initialLocation.current || '', progress: book.progress, label: book.title, index: 1, total: 1 });
  const [panel, setPanel] = useState<'toc' | 'search' | 'notes' | null>(null);
  const [showSettings, setShowSettings] = useState(false); const [focus, setFocus] = useState(false);
  const [query, setQuery] = useState(''); const [results, setResults] = useState<SearchResult[]>([]); const [searching, setSearching] = useState(false); const [searchError, setSearchError] = useState('');
  const [selected, setSelected] = useState<{ text: string; location: string }>(); const [comment, setComment] = useState('');
  const [zoom, setZoom] = useState(1); const [jump, setJump] = useState('');
  const activity = useRef(Date.now()); const pendingSeconds = useRef(0);
  const isPdf = book.format === 'PDF';
  const palette = readerPalette[settings.theme];
  useEffect(() => {
    let active = true;
    void (async () => {
      const data = book.sample ? { id: book.id, chapters: sampleChapters(book) } : await readablePayload(book);
      if (!data) throw new Error('找不到这本书的内容，请重新导入原始文件。');
      if (active) setPayload(data);
    })().catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [book.id]);
  useEffect(() => {
    const active = () => { activity.current = Date.now(); };
    const flush = () => { if (pendingSeconds.current) { callbacks.current.onTick(pendingSeconds.current); pendingSeconds.current = 0; } };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus() && Date.now() - activity.current < 120000) pendingSeconds.current++;
      if (pendingSeconds.current >= 15) flush();
    }, 1000);
    window.addEventListener('pointerdown', active); window.addEventListener('keydown', active); window.addEventListener('wheel', active, { passive: true }); window.addEventListener('blur', flush);
    return () => { clearInterval(timer); flush(); window.removeEventListener('pointerdown', active); window.removeEventListener('keydown', active); window.removeEventListener('wheel', active); window.removeEventListener('blur', flush); };
  }, []);
  const onLocation = useCallback((next: ReadingLocation) => { setLocation(next); callbacks.current.onProgress(next.location, next.progress); }, []);
  const onSelection = useCallback((text: string, target?: string) => { if (text.length > 10000) text = text.slice(0, 10000); setSelected({ text, location: target || '' }); setComment(''); }, []);
  const addBookmark = () => {
    if (!ready) return;
    const existing = props.notes.filter(n => n.kind === 'bookmark' && sameReadingLocation(n.location, location.location));
    if (existing.length) { existing.forEach(n => props.onDeleteNote(n.id)); return; }
    props.onNote({ id: crypto.randomUUID(), bookId: book.id, kind: 'bookmark', text: location.label, location: location.location, progress: location.progress, createdAt: Date.now() });
  };
  const onKey = (event: KeyboardEvent) => {
    activity.current = Date.now();
    const element = event.target as HTMLElement;
    const editing = element?.matches?.('input,textarea,select,[contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setPanel('search'); setTimeout(() => searchInput.current?.focus(), 30); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); addBookmark(); return; }
    if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) { if (selected) setSelected(undefined); else if (showSettings) setShowSettings(false); else if (panel) setPanel(null); else if (focus) setFocus(false); else props.onClose(); }
    if (editing || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); engine.current?.next(); }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); engine.current?.prev(); }
  };
  const keyboard = useRef(onKey); keyboard.current = onKey;
  useEffect(() => { const handler = (event: KeyboardEvent) => keyboard.current(event); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  useEffect(() => {
    if (!query.trim() || !ready) { setResults([]); setSearching(false); return; }
    let active = true; setSearching(true); setSearchError('');
    const timer = setTimeout(() => { void engine.current?.search(query.trim()).then(matches => { if (active) { setResults(matches); setSearching(false); } }).catch(() => { if (active) { setSearching(false); setSearchError('查找未完成，请稍后重试。'); } }); }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query, ready]);
  const common = { initialLocation: initialLocation.current, settings, onReady: (entries: TocEntry[]) => { setToc(entries); setReady(true); }, onLocation, onSelection, onError: setError, onKey: (event: KeyboardEvent) => keyboard.current(event), onActivity: () => { activity.current = Date.now(); } };
  const bookmarked = props.notes.some(n => n.kind === 'bookmark' && sameReadingLocation(n.location, location.location));
  return <div className={`reader reader-${settings.theme} ${focus ? 'reader-focus' : ''}`} style={{ '--reader-bg': palette.background, '--reader-ink': palette.color } as React.CSSProperties}>
    <header className="reader-header"><button className="reader-back" onClick={props.onClose}><ArrowLeft size={18} /><span>返回书架</span></button><div className="reader-book-title"><strong>{book.title}</strong><span>{book.author}</span></div><div className="reader-tools"><IconButton label="写书评" onClick={props.onReview}><MessageSquareText size={18} /></IconButton><IconButton label={bookmarked ? '取消书签（Ctrl D）' : '添加书签（Ctrl D）'} className={bookmarked ? 'active' : ''} onClick={addBookmark} disabled={!ready}><Bookmark size={18} fill={bookmarked ? 'currentColor' : 'none'} /></IconButton><IconButton label="阅读样式" className={showSettings ? 'active' : ''} onClick={() => setShowSettings(!showSettings)}><Type size={20} /></IconButton><IconButton label={focus ? '退出专注模式' : '专注模式'} onClick={() => { setFocus(!focus); setPanel(null); setShowSettings(false); }}>{focus ? <Shrink size={18} /> : <Expand size={18} />}</IconButton></div></header>
    <div className="reader-layout"><div className="reader-rail"><IconButton label="目录" className={panel === 'toc' ? 'active' : ''} onClick={() => setPanel(panel === 'toc' ? null : 'toc')}><List size={20} /></IconButton><IconButton label="书内查找（Ctrl F）" className={panel === 'search' ? 'active' : ''} onClick={() => { setPanel(panel === 'search' ? null : 'search'); setTimeout(() => searchInput.current?.focus(), 30); }}><Search size={19} /></IconButton><IconButton label="本书摘录与书签" className={panel === 'notes' ? 'active' : ''} onClick={() => setPanel(panel === 'notes' ? null : 'notes')}><Highlighter size={19} /></IconButton><span /><IconButton label="阅读设置" onClick={() => setShowSettings(!showSettings)}><Settings2 size={18} /></IconButton></div>
      {panel && <aside className="reader-panel"><div className="reader-panel-heading"><h3>{{ toc: isPdf ? '目录与页面' : '书籍目录', search: '在书中寻找', notes: '留下的片刻' }[panel]}</h3><IconButton label="收起侧栏" onClick={() => setPanel(null)}><PanelLeftClose size={17} /></IconButton></div>
        {panel === 'toc' && <><p className="reader-panel-caption">{isPdf ? `${toc.length} 个目录条目` : `共 ${toc.length} 个章节`}</p><div className="toc-list">{toc.map((entry,i) => <button key={`${entry.location}-${i}`} className={entry.location === location.location || (!isPdf && entry.label === location.label) ? 'active' : ''} style={{ paddingLeft: 18 + (entry.depth || 0) * 12 }} onClick={() => engine.current?.goTo(entry.location)}><span>{String(i + 1).padStart(2, '0')}</span>{entry.label}</button>)}</div></>}
        {panel === 'search' && <><div className="reader-search"><Search size={16} /><input ref={searchInput} placeholder="搜索文字…" aria-label="书内搜索" value={query} onChange={e => setQuery(e.target.value)} /><button aria-label="清除书内搜索" onClick={() => setQuery('')}><X size={14} /></button></div><p className="reader-panel-caption">{searching ? '正在翻找书页…' : query ? `找到 ${results.length}${results.length === 100 ? '+' : ''} 个位置` : isPdf ? '可搜索文字型 PDF；扫描件不含文字层。' : '输入一个词，找到它在书中的回响。'}</p>{searchError && <div className="error-message">{searchError}</div>}<div className="search-results">{results.map((result,i) => <button key={i} onClick={() => engine.current?.goTo(result.location)}><strong>{result.label}</strong><p>{result.excerpt}</p></button>)}</div></>}
        {panel === 'notes' && <div className="reader-notes">{props.notes.length ? [...props.notes].reverse().map(note => <div className="reader-note-item" key={note.id}><button onClick={() => engine.current?.goTo(note.location)}><span>{note.kind === 'highlight' ? <Highlighter size={14} /> : <Bookmark size={14} />}{Math.round(note.progress)}%</span><p>{note.text}</p>{note.comment && <small>{note.comment}</small>}</button><button className="remove-reader-note" aria-label={`删除${note.kind === 'bookmark' ? '书签' : '摘录'} ${note.text.slice(0,20)}`} onClick={() => props.onDeleteNote(note.id)}><Trash2 size={14}/></button></div>) : <p className="reader-panel-caption">选中文字保存摘录，或点击顶部的书签图标。</p>}</div>}
      </aside>}
      <main className="reader-content"><div className="running-title"><span>{location.label}</span><span>{book.sample ? '原创导读 · 非原著全文' : book.format}</span></div>
        {error ? <div className="reader-error"><EmptyState title="这本书暂时没有打开" description={error} action={<button className="button secondary" onClick={props.onClose}>返回书架</button>} /></div> : !payload ? <div className="reader-loading"><LoaderCircle className="spin" size={28} /><span>正在翻开书页…</span></div> : payload.chapters ? <TextReader ref={engine} {...common} chapters={payload.chapters} searchQuery={query.trim()} /> : payload.blob && isPdf ? <PdfReader ref={engine} {...common} blob={payload.blob} zoom={zoom} /> : payload.blob ? <EpubReader ref={engine} {...common} blob={payload.blob} /> : null}
        {focus && <button className="exit-focus button secondary small" onClick={() => setFocus(false)}><Shrink size={15} />退出专注</button>}
      </main>
    </div>
    <footer className="reader-footer"><span className="reader-save-status"><Check size={13} />进度自动保存</span><div className="reader-pagination"><IconButton label="上一页" disabled={!ready} onClick={() => engine.current?.prev()}><ChevronLeft size={19} /></IconButton><form onSubmit={e => { e.preventDefault(); const value = Number(jump); if (value >= 1 && value <= location.total) { if (isPdf) engine.current?.goTo(`pdf:${value}`); else if (book.format === 'EPUB') engine.current?.seek((value - 1) / location.total * 100); else engine.current?.goTo(`text:${value - 1}:0`); setJump(''); } }}><input aria-label={isPdf ? '跳转页码' : '跳转章节'} type="number" min="1" max={location.total} placeholder={String(location.index)} value={jump} onChange={e => setJump(e.target.value)} /><span>/ {location.total} {isPdf ? '页' : '章'}</span></form><IconButton label="下一页" disabled={!ready} onClick={() => engine.current?.next()}><ChevronRight size={19} /></IconButton></div><div className="reader-progress-control"><input type="range" aria-label="阅读进度" min="0" max="100" step=".1" value={location.progress} disabled={!ready} onChange={e => engine.current?.seek(Number(e.target.value))} /><span>{Math.round(location.progress)}%</span></div></footer>
    {showSettings && <div className="reader-settings"><div className="reader-panel-heading"><h3>舒服地读</h3><IconButton label="关闭阅读设置" onClick={() => setShowSettings(false)}><X size={17} /></IconButton></div><label className="field-label">阅读主题</label><div className="reader-theme-options">{Object.entries(readerPalette).map(([value,color]) => <button key={value} style={{ background: color.background, color: color.color }} className={settings.theme === value ? 'selected' : ''} onClick={() => props.onSettings({ ...settings, theme: value as ReaderSettings['theme'] })}>{settings.theme === value && <Check size={14} />}{({ paper: '纸间', light: '晴日', dark: '夜读', green: '青苔' })[value]}</button>)}</div>{isPdf ? <><label className="field-label">页面缩放</label><div className="font-size-control"><IconButton label="缩小 PDF" onClick={() => setZoom(Math.max(.5, zoom - .1))}><Minus size={16} /></IconButton><span>{Math.round(zoom * 100)}%</span><IconButton label="放大 PDF" onClick={() => setZoom(Math.min(2, zoom + .1))}><Plus size={16} /></IconButton></div><p className="muted small-text">PDF 保留原始页面排版。</p></> : <><label className="field-label">字体</label><div className="segmented-control"><button className={settings.font === 'serif' ? 'selected' : ''} onClick={() => props.onSettings({ ...settings, font: 'serif' })}>宋体 · 书卷气</button><button className={settings.font === 'sans' ? 'selected' : ''} onClick={() => props.onSettings({ ...settings, font: 'sans' })}>黑体 · 简明</button></div><label className="field-label">字号</label><div className="font-size-control"><IconButton label="缩小字号" disabled={settings.fontSize <= 14} onClick={() => props.onSettings({ ...settings, fontSize: settings.fontSize - 1 })}><Minus size={16} /></IconButton><span>{settings.fontSize} px</span><IconButton label="放大字号" disabled={settings.fontSize >= 32} onClick={() => props.onSettings({ ...settings, fontSize: settings.fontSize + 1 })}><Plus size={16} /></IconButton></div><label className="field-label">行间距离 <span>{settings.lineHeight.toFixed(1)}</span></label><input className="full-width" aria-label="阅读行距" type="range" min="1.4" max="2.6" step=".1" value={settings.lineHeight} onChange={e => props.onSettings({ ...settings, lineHeight: Number(e.target.value) })} /></>}<label className="field-label">页面宽度 <span>{settings.width}px</span></label><input className="full-width" type="range" aria-label="阅读页面宽度" min="500" max="1000" step="20" value={settings.width} onChange={e => props.onSettings({ ...settings, width: Number(e.target.value) })} /><p className="settings-tip">每一本书，都沿用你喜欢的样式。</p></div>}
    {selected && <div className="selection-card" role="dialog" aria-label="保存文字摘录"><div className="selection-heading"><span><Highlighter size={16} />留住这一句</span><IconButton label="取消摘录" onClick={() => setSelected(undefined)}><X size={16} /></IconButton></div><blockquote>{selected.text}</blockquote><input className="form-input" aria-label="摘录想法" placeholder="写一点此刻的想法（选填）" value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} /><button className="button primary small" onClick={() => { props.onNote({ id: crypto.randomUUID(), bookId: book.id, kind: 'highlight', text: selected.text, comment: comment.trim(), location: selected.location || location.location, progress: location.progress, createdAt: Date.now() }); setSelected(undefined); window.getSelection()?.removeAllRanges(); }}><BookmarkPlus size={15} />保存摘录</button></div>}
  </div>;
}
