import { ArrowDownUp, ArrowRight, BookOpen, Check, ChevronDown, Clock3, Grid2X2, Heart, List, MoreHorizontal, Plus, Search, SlidersHorizontal, Sparkles, Sun, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Book, Collection, ReadingStatus, Review } from '../types';
import { Cover, Sprig } from './Cover';
import { EmptyState, IconButton, Stars } from './ui';

export const statusLabels: Record<ReadingStatus, string> = { reading: '正在读', want: '想读', finished: '已读完' };

interface Props {
  books: Book[]; reviews: Review[]; collection?: Collection;
  search: string; onClearSearch: () => void;
  onFavorite: (book: Book) => void; onOpen: (book: Book) => void; onDetails: (book: Book) => void; onImport: () => void;
}

export function Library({ books, reviews, collection, search, onClearSearch, onOpen, onFavorite, onDetails, onImport }: Props) {
  const [filter, setFilter] = useState<'all' | 'favorite' | ReadingStatus>('all');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState('recent');
  const [format, setFormat] = useState('all');
  const [showFormats, setShowFormats] = useState(false);
  const base = useMemo(() => books.filter(b => !collection || b.collectionIds.includes(collection.id)), [books, collection]);
  const current = [...books].filter(b => b.status === 'reading' && !b.online).sort((a,b) => (b.lastRead || 0) - (a.lastRead || 0))[0];
  const visible = useMemo(() => base.filter(b =>
    (filter === 'all' || (filter === 'favorite' ? b.favorite : b.status === filter)) && (format === 'all' || b.format === format) &&
    (!search || `${b.title} ${b.author} ${b.format}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  ).sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : sort === 'progress' ? b.progress - a.progress : sort === 'added' ? b.addedAt - a.addedAt : (b.lastRead || b.addedAt) - (a.lastRead || a.addedAt)), [base, filter, format, search, sort]);

  return <div className="library-page page-enter">
    <div className="page-heading"><div><div className="eyebrow">YOUR LITTLE LIBRARY</div><h1>{collection?.name || '我的书架'}<span className="heading-dot">.</span></h1><p>{collection ? '把相似的灵感，放在同一个地方。' : '总有一本书，让时间慢下来。'}</p></div><button className="button primary" onClick={onImport}><Plus size={17} />导入书籍</button></div>
    {!collection && !search && <div className="feature-row">
      <section className="continue-card">
        <div className="continue-content"><div className="section-kicker"><span className="small-dot" />{current ? '让阅读继续' : '给自己一段阅读时光'}</div>
          <h2>{current?.title || '下一页，新的世界'}</h2><p>{current?.description || '翻开一本好书，让思绪自由漫游。'}</p>
          {current && <div className="continue-progress"><div className="progress-track"><span style={{ width: `${current.progress}%` }} /></div><span>{current.progress > 0 ? `已读 ${Math.round(current.progress)}%` : '故事，即将开始'}</span></div>}
          <button className="continue-button" onClick={() => current ? onOpen(current) : onImport()}>{current?.progress ? '继续阅读' : current ? '开始阅读' : '添加第一本书'}<ArrowRight size={16} /></button>
        </div>
        <div className="continue-art"><div className="art-halo" /><Sprig className="hero-sprig" />{current && <Cover book={current} className="hero-book" />}<div className="book-shadow" /></div>
        <span className="hero-caption">A LITTLE ESCAPE, EVERY DAY.</span>
      </section>
      <section className="quote-card"><div className="quote-top"><span>片刻闲读</span><Sun size={21} strokeWidth={1.3} /></div><span className="quote-mark">“</span><p>把生活调慢一格，<br />让文字，轻轻抵达。</p><div className="quote-bottom"><span>阅读，是温柔的自我关照</span><span className="quote-line" /></div><Sprig className="quote-sprig" /></section>
    </div>}
    <section className="shelf-section">
      <div className="shelf-title-row"><h2>{search ? `搜索「${search}」` : '书页之间'}<span>{search ? visible.length : base.length} 本藏书</span></h2><div className="shelf-hint"><span className="small-dot" />{base.some(b => b.sample) ? '内含原创导读示例' : '好书，都在这里'}</div></div>
      <div className="shelf-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="阅读状态">
          {([['all', '全部书籍'], ['reading', '正在读'], ['want', '想读'], ['finished', '已读完'], ['favorite', '我的收藏']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}<span>{base.filter(b => key === 'all' || (key === 'favorite' ? b.favorite : b.status === key)).length}</span></button>)}
        </div>
        <div className="shelf-tools"><div className="sort-select"><ArrowDownUp size={14} /><select aria-label="书籍排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="title">书名排序</option><option value="progress">阅读进度</option></select><ChevronDown size={12} /></div><IconButton label="筛选文件格式" className={showFormats ? 'active' : ''} onClick={() => setShowFormats(!showFormats)}><SlidersHorizontal size={16} /></IconButton><span className="tool-divider" /><div className="view-toggle"><IconButton label="网格视图" className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')}><Grid2X2 size={16} /></IconButton><IconButton label="列表视图" className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')}><List size={18} /></IconButton></div></div>
      </div>
      {showFormats && <div className="format-filters"><span>文件格式</span>{['all', 'TXT', 'EPUB', 'PDF', 'HTML', 'MD', 'WEB'].map(f => <button className={format === f ? 'selected' : ''} key={f} onClick={() => setFormat(f)}>{f === 'all' ? '全部' : f}</button>)}</div>}
      {search && <button className="search-clear" onClick={onClearSearch}><X size={13} />清除搜索</button>}
      {visible.length ? <div className={layout === 'grid' ? 'book-grid' : 'book-list'}>
        {visible.map(book => {
          const rating = reviews.find(r => r.bookId === book.id)?.rating;
          return <article className={`book-card ${layout === 'list' ? 'book-row' : ''}`} key={book.id}>
            <button className="cover-button" onClick={() => onOpen(book)} aria-label={`阅读 ${book.title}`}><Cover book={book} /><span className="cover-hover"><BookOpen size={20} />{book.online&&!book.cache ? '查看书籍' : '翻开阅读'}</span>{book.status === 'finished' && <span className="finished-badge"><Check size={12} />已读</span>}</button>
            <div className="book-info"><div className="book-name-row"><button className="book-title" onClick={() => onOpen(book)} title={book.title}>{book.title}</button><IconButton label={`${book.title} 详情与管理`} onClick={() => onDetails(book)}><MoreHorizontal size={17} /></IconButton></div><p className="book-author" title={book.author}>{book.author}</p><div className="book-meta"><span className={`format-badge format-${book.format.toLowerCase()}`}>{book.sample ? '导读' : book.online&&!book.cache ? '在线' : book.format}</span>{book.status === 'reading' ? <span className="reading-status"><span className="small-dot" />{book.progress > 0 ? `已读 ${Math.round(book.progress)}%` : '正在读'}</span> : <span className="muted">{statusLabels[book.status]}</span>}{rating ? <Stars value={rating} size={11} /> : null}<button className={`shelf-favorite ${book.favorite ? 'active' : ''}`} aria-label={`${book.favorite ? '取消收藏' : '收藏'} ${book.title}`} aria-pressed={!!book.favorite} onClick={() => onFavorite(book)}><Heart size={12} fill={book.favorite ? 'currentColor' : 'none'}/></button></div>{book.status === 'reading' && <div className="book-progress"><span style={{ width: `${Math.max(book.progress, 2)}%` }} /></div>}</div>
            {layout === 'list' && <div className="list-actions"><span>{book.sample ? '原创导读示例' : new Date(book.addedAt).toLocaleDateString('zh-CN')}</span><button className="button secondary small" onClick={() => onOpen(book)}>阅读<ArrowRight size={14} /></button></div>}
          </article>;
        })}
      </div> : <EmptyState title={search ? '还没有找到这本书' : filter === 'finished' ? '每一次读完，都值得纪念' : '书架留了一点空白'} description={search ? '试试书名、作者，或文件格式。' : '导入一本喜欢的书，或者调整筛选条件。'} action={<button className="button secondary" onClick={() => { if (search) onClearSearch(); setFilter('all'); setFormat('all'); }}>{search ? <Search size={16} /> : <BookOpen size={16} />}查看全部书籍</button>} />}
      <div className="shelf-footer"><span><BookOpen size={14} />每一次翻页，都是与自己的相遇。</span><span>支持 TXT · EPUB · PDF · 网页 · Markdown</span></div>
    </section>
    <div className="library-bottom-note"><Sparkles size={13} /><span>你的书架，只属于你。所有阅读记录均保存在本机。</span><Clock3 size={13} /><span>随时回来，接着读。</span></div>
  </div>;
}
