import {EncyclopediaPanel} from './EncyclopediaPanel';
import { useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, FileText, Globe2, LoaderCircle, MessageSquareText, Plus, Trash2, Upload, X } from 'lucide-react';
import type { Book, Collection, ReadingStatus, Review } from '../types';
import { fileAccept } from '../lib/importers';
import { DownloadEntry } from './DownloadFinder';
import { Cover } from './Cover';
import { Modal, Stars } from './ui';
import { statusLabels } from './Library';

export interface ImportResult { added: number; skipped: number; errors: string[] }
export function ImportDialog({ onClose, onFiles, onUrl }: { onClose: () => void; onFiles: (files: File[]) => Promise<ImportResult>; onUrl: (url: string) => Promise<void> }) {
  const [tab, setTab] = useState<'files' | 'url'>('files');
  const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const [url, setUrl] = useState(''); const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult>();
  const input = useRef<HTMLInputElement>(null);
  async function importFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true); setError(''); setResult(undefined);
    try { setResult(await onFiles(files)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function pickFiles() {
    if (!window.desktop) { input.current?.click(); return; }
    try {
      const chosen = await window.desktop.pickFiles();
      await importFiles(chosen.map(f => new File([new Uint8Array(f.data).buffer], f.name)));
    } catch (e) { setError((e as Error).message); }
  }
  async function addUrl(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await onUrl(url); setResult({ added: 1, skipped: 0, errors: [] }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="把好书带回书架" subtitle="文件、书籍，或一篇想慢慢读的文章。" onClose={() => !busy && onClose()}>
    <div className="modal-tabs"><button className={tab === 'files' ? 'active' : ''} onClick={() => { setTab('files'); setError(''); }} disabled={busy}><FileText size={16} />本地文件</button><button className={tab === 'url' ? 'active' : ''} onClick={() => { setTab('url'); setError(''); }} disabled={busy}><Globe2 size={16} />网页链接</button></div>
    {tab === 'files' ? <><input ref={input} type="file" accept={fileAccept} multiple className="sr-only" aria-label="选择书籍文件" onChange={e => { void importFiles([...e.target.files || []]); e.target.value = ''; }} />
      <button className={`drop-zone ${drag ? 'dragging' : ''}`} disabled={busy} onClick={pickFiles} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) void importFiles([...e.dataTransfer.files]); }}>
        <div className="upload-symbol">{busy ? <LoaderCircle className="spin" size={28} /> : <Upload size={27} strokeWidth={1.4} />}</div><strong>{busy ? '正在整理你的书籍…' : '拖入书籍，或点击选择文件'}</strong><span>TXT、EPUB、PDF、HTML、Markdown</span><small>支持批量导入 · 每个文件不超过 100 MB</small>
      </button><div className="import-tip"><BookOpen size={16} /><p>自动识别 TXT 编码与章节，保留 EPUB 排版。<br />书籍会复制到阅读空间，原文件可以自由整理。</p></div></> : <form onSubmit={addUrl} className="url-form"><label className="field-label" htmlFor="article-url">文章链接</label><div className="url-input"><Globe2 size={17} /><input id="article-url" type="url" placeholder="https://example.com/article" required value={url} onChange={e => setUrl(e.target.value)} disabled={busy} /></div><p>提取公开网页的正文，保存后即可离线阅读。需要登录或动态加载的网页可另存为 HTML 后导入。</p><button type="submit" className="button primary full-width" disabled={busy || !url.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{busy ? '正在提取正文…' : '保存到书架'}</button></form>}
    {error && <div className="error-message" role="alert">{error}</div>}
    {result && <div className="import-result" role="status"><p><Check size={17} />已导入 {result.added} 本{result.skipped > 0 ? `，跳过 ${result.skipped} 本重复书籍` : ''}</p>{result.errors.map((e,i) => <div className="error-message" key={i}>{e}</div>)}<button className="button secondary small" onClick={onClose}>返回书架<ArrowRight size={14} /></button></div>}
  </Modal>;
}

export function DetailDialog({ book, collections, review, onClose, onOpen, onUpdate, onReview, onDelete, onDownloads, onClearCache, clearingCache }: { book: Book; collections: Collection[]; review?: Review; onClose: () => void; onOpen: () => void; onUpdate: (patch: Partial<Book>) => void; onReview: () => void; onDelete: () => void; onDownloads: () => void; onClearCache:()=>void; clearingCache?:boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return <Modal title="关于这本书" onClose={onClose}>
    <div className="book-detail-top"><Cover book={book} /><div><span className="format-badge">{book.sample ? '原创导读示例' : book.format}</span><h2>{book.title}</h2><p>{book.author}</p>{review && <Stars value={review.rating} />}<div className="detail-progress">已读 {Math.round(book.progress)}%<div className="progress-track"><span style={{ width: `${book.progress}%` }} /></div></div></div></div>
    {book.description && <p className="book-description">{book.description}</p>}
    {book.sample && <div className="subtle-callout">示例用于体验阅读功能，正文为原创导读，并非原著全文。你可以导入自己的完整书籍。</div>}
    <label className="field-label">阅读状态</label><div className="status-options">{Object.entries(statusLabels).map(([value, label]) => <button key={value} className={book.status === value ? 'selected' : ''} onClick={() => onUpdate({ status: value as ReadingStatus, ...(value === 'finished' ? { progress: 100 } : {}) })}>{book.status === value && <Check size={14} />}{label}</button>)}</div>
    <label className="field-label">收藏到书单</label><div className="collection-options">{collections.length ? collections.map(c => <label key={c.id}><input type="checkbox" checked={book.collectionIds.includes(c.id)} onChange={e => onUpdate({ collectionIds: e.target.checked ? [...book.collectionIds, c.id] : book.collectionIds.filter(id => id !== c.id) })} /><span className="collection-color" style={{ background: c.color }} />{c.name}</label>) : <span className="muted">在侧边栏新建一份书单吧。</span>}</div>
    <div className="file-details"><span>{book.sample ? '栖读示例库' : book.cacheSource&&!book.cache ? '本地缓存已清空' : book.online&&!book.cache ? '在线书目 · 尚未加载到本地' : book.sourceUrl ? new URL(book.sourceUrl).hostname : `${(book.size / 1024).toFixed(1)} KB · 本地文件`}</span><span>{new Date(book.addedAt).toLocaleDateString('zh-CN')} 添加</span></div>
    {book.cache&&<div className="cache-book-status"><span>已加载到本地 · {(book.size/1048576).toFixed(1)} MB</span><button className="button text-button small" disabled={clearingCache} onClick={onClearCache}>{clearingCache?'正在清理…':'清空缓存'}</button></div>}
    <EncyclopediaPanel title={book.title} author={book.author}/>
    <DownloadEntry onClick={onDownloads}/>
    <div className="modal-actions detail-actions"><button className="button text-button danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} />移出书架</button><button className="button secondary" onClick={onReview}><MessageSquareText size={16} />{review ? '编辑书评' : '写书评'}</button><button className="button primary" onClick={onOpen}><BookOpen size={16} />{book.cache?'阅读本地文件':book.cacheSource?'重新加载到本地':book.online?'查看在线书籍':'阅读'}</button></div>
    {confirmDelete && <div className="inline-confirm"><p>移出《{book.title}》并删除它的书评和摘录？原始文件不受影响。</p><div><button className="button secondary small" onClick={() => setConfirmDelete(false)}>取消</button><button className="button danger-button small" onClick={onDelete}>确认移出</button></div></div>}
  </Modal>;
}

export function ReviewDialog({ books, initialBookId, review, onSave, onClose }: { books: Book[]; initialBookId?: string; review?: Review; onSave: (review: Review) => void; onClose: () => void }) {
  const [bookId, setBookId] = useState(review?.bookId || initialBookId || books[0]?.id || '');
  const [rating, setRating] = useState(review?.rating || 0);
  const [title, setTitle] = useState(review?.title || ''); const [body, setBody] = useState(review?.body || '');
  return <Modal title={review ? '继续这份感受' : '为一本书，留几句话'} subtitle="所有书评仅保存在本机，安心记录真实的想法。" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); onSave({ id: review?.id || crypto.randomUUID(), bookId, rating, title: title.trim(), body: body.trim(), updatedAt: Date.now() }); }}>
      <label className="field-label" htmlFor="review-book">关于哪本书</label><select id="review-book" className="form-input" value={bookId} onChange={e => setBookId(e.target.value)} disabled={!!review}>{books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select>
      <div className="review-rating"><Stars value={rating} onChange={setRating} size={28} /><span>{['轻点星星，为它评分', '不太喜欢', '有些遗憾', '值得一读', '很喜欢', '想再读一遍'][rating]}</span></div>
      <label className="field-label" htmlFor="review-title">给这份感受起个名字</label><input id="review-title" className="form-input" placeholder="例如：在平凡的日子里，看见微光" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} required />
      <label className="field-label" htmlFor="review-body">你的阅读手记</label><textarea id="review-body" className="form-input review-textarea" placeholder="哪一页让你停留？哪个想法想要留下？" value={body} maxLength={20000} onChange={e => setBody(e.target.value)} required /><div className="character-count">{body.length.toLocaleString()} / 20,000</div>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>暂时收起</button><button className="button primary" disabled={!bookId || !rating || !title.trim() || !body.trim()}><Check size={16} />保存书评</button></div>
    </form>
  </Modal>;
}

export function CollectionDialog({ collections, onClose, onSave }: { collections: Collection[]; onClose: () => void; onSave: (collection: Collection) => void }) {
  const [name, setName] = useState(''); const [color, setColor] = useState('#a47757');
  const duplicate = collections.some(c => c.name === name.trim());
  return <Modal title="收藏一种心情" subtitle="用一份书单，串起相似的故事。" onClose={onClose}><form onSubmit={e => { e.preventDefault(); if (name.trim() && !duplicate) onSave({ id: crypto.randomUUID(), name: name.trim(), color }); }}><label className="field-label" htmlFor="collection-name">书单名称</label><input id="collection-name" className="form-input" data-autofocus placeholder="例如：在路上、枕边书、关于生活" value={name} onChange={e => setName(e.target.value)} maxLength={24} required /><label className="field-label">选一种颜色</label><div className="color-options">{['#a47757', '#81937c', '#6d899c', '#a17c9b', '#c5a45a', '#9a6b68'].map(c => <button key={c} type="button" style={{ background: c }} aria-label={`书单颜色 ${c}`} className={c === color ? 'selected' : ''} onClick={() => setColor(c)}>{c === color && <Check size={17} />}</button>)}</div>{duplicate && <div className="error-message">已经有同名书单了，换一个名字吧。</div>}<div className="modal-actions"><button className="button primary" disabled={!name.trim() || duplicate}><Plus size={16} />创建书单</button></div></form></Modal>;
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return <Modal title="慢慢读，自在读" subtitle="欢迎来到栖读，你的私人阅读空间。" onClose={onClose}><div className="help-content"><p><strong>01　把书放进来</strong>点击「导入书籍」或把文件拖进书架，支持 TXT、EPUB、PDF、HTML 和 Markdown；也可以保存网页正文。</p><p><strong>02　找到舒服的节奏</strong>阅读时可调整字号、行距、页面宽度和主题。目录、全文搜索、书签与进度会帮你随时接着读。</p><p><strong>03　留住自己的声音</strong>选中文字后保存摘录，或为书籍写一篇只属于自己的书评。书单可以把不同兴趣整理在一起。</p><div className="shortcut-list"><span>搜索书架 <kbd>Ctrl K</kbd></span><span>导入书籍 <kbd>Ctrl O</kbd></span><span>退出阅读 <kbd>Esc</kbd></span><span>前后翻页 <kbd>← →</kbd></span><span>书内查找 <kbd>Ctrl F</kbd></span><span>添加 / 取消书签 <kbd>Ctrl D</kbd></span></div><p className="muted">内置书籍是原创导读示例，并非原著全文。PDF 扫描件以原页面显示，暂不提供 OCR。DRM 加密 EPUB 暂不支持。</p></div><button className="button primary full-width" onClick={onClose}>开始我的阅读时光<ArrowRight size={16} /></button></Modal>;
}
