import { BarChart3, BookHeart, BookOpen, Bookmark, CalendarDays, Check, Clock3, Download, Flame, MessageSquareText, Moon, Pencil, Plus, Quote, Settings2, Sun, Target, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Book, LibraryState, Note, Review, Settings } from '../types';
import { formatTime, localDateKey } from '../lib/storage';
import { Cover } from './Cover';
import { downloadBlob, EmptyState, IconButton, Stars } from './ui';

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}<span className="heading-dot">.</span></h1><p>{description}</p></div>{action}</div>;
}

export function ReviewsPage({ books, reviews, onEdit, onDelete, onOpen }: { books: Book[]; reviews: Review[]; onEdit: (review?: Review) => void; onDelete: (review: Review) => void; onOpen: (book: Book) => void }) {
  const [sort, setSort] = useState('recent');
  return <div className="page-enter"><PageHeading eyebrow="WORDS THAT STAY" title="书评手记" description="读过的书，会成为你的一部分。" action={<button className="button primary" onClick={() => onEdit()} disabled={!books.length}><Pencil size={16} />写一篇书评</button>} />
    <div className="section-toolbar"><span><MessageSquareText size={17} />{reviews.length} 篇私人手记</span><select aria-label="书评排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近更新</option><option value="rating">评分最高</option></select></div>
    {reviews.length ? <div className="reviews-grid">{[...reviews].sort((a,b) => sort === 'rating' ? b.rating - a.rating : b.updatedAt - a.updatedAt).map(review => {
      const book = books.find(b => b.id === review.bookId); if (!book) return null;
      return <article className="review-card" key={review.id}><div className="review-book-row"><button onClick={() => onOpen(book)} aria-label={`阅读 ${book.title}`}><Cover book={book} /></button><div><span className="eyebrow">READING NOTES</span><h3>{book.title}</h3><Stars value={review.rating} /></div><IconButton label="编辑书评" onClick={() => onEdit(review)}><Pencil size={16} /></IconButton></div><h2>{review.title}</h2><p className="review-body">{review.body}</p><div className="review-bottom"><span>{new Date(review.updatedAt).toLocaleDateString('zh-CN')} · 只对自己可见</span><IconButton label="删除书评" onClick={() => onDelete(review)}><Trash2 size={15} /></IconButton></div></article>;
    })}</div> : <EmptyState title="有些感受，值得写下来" description="为喜欢的书点亮星星，留住读完那一刻的自己。" action={<button className="button secondary" onClick={() => onEdit()} disabled={!books.length}><BookHeart size={17} />写下第一篇书评</button>} />}
    <div className="page-footnote"><Quote size={16} />文字让相遇发生，书评让相遇留下。</div>
  </div>;
}

export function NotesPage({ books, notes, onOpen, onDelete }: { books: Book[]; notes: Note[]; onOpen: (book: Book, location: string) => void; onDelete: (note: Note) => void }) {
  const [kind, setKind] = useState('all'); const [bookId, setBookId] = useState('all');
  const visible = notes.filter(n => (kind === 'all' || n.kind === kind) && (bookId === 'all' || n.bookId === bookId));
  function exportNotes() {
    const text = '# 栖读 · 阅读摘录\n\n' + visible.map(n => `## ${books.find(b => b.id === n.bookId)?.title || '书籍'}\n\n> ${n.text.replaceAll('\n', '\n> ')}\n\n${n.comment || ''}\n\n${new Date(n.createdAt).toLocaleString('zh-CN')} · ${Math.round(n.progress)}%\n`).join('\n---\n\n');
    downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `栖读摘录-${localDateKey()}.md`);
  }
  return <div className="page-enter"><PageHeading eyebrow="LITTLE THINGS, KEPT" title="摘录与书签" description="把那些让你停留的句子，好好收藏。" action={<button className="button secondary" onClick={exportNotes} disabled={!visible.length}><Download size={16} />导出摘录</button>} />
    <div className="section-toolbar"><div className="filter-tabs">{[['all','全部收藏'],['highlight','文字摘录'],['bookmark','阅读书签']].map(([value,label]) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{label}<span>{notes.filter(n => value === 'all' || n.kind === value).length}</span></button>)}</div><select aria-label="按书籍筛选摘录" value={bookId} onChange={e => setBookId(e.target.value)}><option value="all">所有书籍</option>{books.filter(b => notes.some(n => n.bookId === b.id)).map(b => <option value={b.id} key={b.id}>{b.title}</option>)}</select></div>
    {visible.length ? <div className="notes-grid">{[...visible].sort((a,b) => b.createdAt - a.createdAt).map(note => { const book = books.find(b => b.id === note.bookId); if (!book) return null; return <article className="note-card" key={note.id}><div className="note-heading">{note.kind === 'highlight' ? <Quote size={22} strokeWidth={1.3} /> : <Bookmark size={21} strokeWidth={1.3} />}<span>{note.kind === 'highlight' ? '文字摘录' : '阅读书签'}</span><IconButton label="删除收藏" onClick={() => onDelete(note)}><Trash2 size={14} /></IconButton></div><p className="note-quote">{note.text}</p>{note.comment && <p className="note-comment">{note.comment}</p>}<button className="note-source" onClick={() => onOpen(book, note.location)}><BookOpen size={14} />{book.title}<span>{Math.round(note.progress)}%</span></button><time>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</time></article>; })}</div> : <EmptyState title="让喜欢的文字，有处可归" description="阅读时选中文字即可摘录，点击书签图标保存当前位置。" />}
  </div>;
}

export function StatsPage({ state }: { state: LibraryState }) {
  const days = Array.from({ length: 7 }, (_, i) => { const date = new Date(); date.setDate(date.getDate() - 6 + i); return { key: localDateKey(date), label: ['周日','周一','周二','周三','周四','周五','周六'][date.getDay()] }; });
  const total = Object.values(state.readingSeconds).reduce((a,b) => a+b, 0);
  const today = state.readingSeconds[localDateKey()] || 0;
  const week = days.reduce((n,d) => n + (state.readingSeconds[d.key] || 0), 0);
  const max = Math.max(state.settings.dailyGoal * 60, ...days.map(d => state.readingSeconds[d.key] || 0));
  const stats = [
    { label: '累计阅读', value: formatTime(total), icon: Clock3, color: 'warm' },
    { label: '读完的书', value: `${state.books.filter(b => b.status === 'finished').length} 本`, icon: BookOpen, color: 'sage' },
    { label: '有阅读的日子', value: `${Object.values(state.readingSeconds).filter(s => s >= 60).length} 天`, icon: CalendarDays, color: 'blue' },
    { label: '留下的感受', value: `${state.notes.length + state.reviews.length} 则`, icon: BookHeart, color: 'rose' },
  ];
  return <div className="page-enter"><PageHeading eyebrow="EVERY PAGE COUNTS" title="阅读足迹" description="不必追赶进度，你走过的每一页都有意义。" /><div className="stats-grid">{stats.map(s => <div className={`stat-card ${s.color}`} key={s.label}><s.icon size={21} strokeWidth={1.5} /><span>{s.label}</span><strong>{s.value}</strong></div>)}</div>
    <div className="stats-detail-grid"><section className="chart-card"><div className="chart-title"><div><h2>这一周，和书在一起</h2><p>近 7 天共阅读 {formatTime(week)}</p></div><BarChart3 size={20} /></div><div className="week-chart">{days.map((day,i) => { const seconds = state.readingSeconds[day.key] || 0; return <div className={`chart-column ${i === 6 ? 'today' : ''}`} key={day.key}><span>{seconds >= 60 ? `${Math.floor(seconds / 60)} 分` : seconds > 0 ? `${seconds} 秒` : '—'}</span><div className="bar-track"><div className="chart-bar" style={{ height: `${Math.max(2, seconds / max * 100)}%` }} /></div><label>{i === 6 ? '今天' : day.label}</label></div>; })}</div><p className="chart-caption">只记录阅读器处于前台且有活动的时间。</p></section><section className="goal-card"><div className="section-kicker"><Target size={16} />今天的小目标</div><div className="goal-ring" style={{ '--goal': `${Math.min(100, today / (state.settings.dailyGoal * 60) * 100)}%` } as React.CSSProperties}><div><strong>{Math.floor(today / 60)}<small>分钟</small></strong><span>目标 {state.settings.dailyGoal} 分钟</span></div></div><h3>{today >= state.settings.dailyGoal * 60 ? '今天的约定，完成了' : '每天一点，慢慢积累'}</h3><p>让阅读成为日常，而不是任务。</p></section></div>
    <div className="stats-message"><Flame size={21} /><div><h3>阅读的价值，远不止数字</h3><p>那些被文字触动的时刻，会在生活里慢慢发芽。</p></div></div>
  </div>;
}

export function SettingsPage({ settings, onChange, onExport, onRestore, busy, children }: { children?:React.ReactNode; settings: Settings; onChange: (settings: Settings) => void; onExport: () => void; onRestore: (file: File) => void; busy: boolean }) {
  const restore = useRef<HTMLInputElement>(null);
  return <div className="page-enter settings-page"><PageHeading eyebrow="MAKE YOURSELF AT HOME" title="偏好设置" description="把阅读空间，调成你喜欢的样子。" />
    <section className="settings-card"><div className="settings-section-title"><Settings2 size={19} /><h2>空间与习惯</h2></div><div className="setting-row"><div><strong>界面主题</strong><p>阅读页面的配色可以单独设置。</p></div><div className="segmented-control"><button className={settings.appTheme === 'light' ? 'selected' : ''} onClick={() => onChange({ ...settings, appTheme: 'light' })}><Sun size={16} />日间</button><button className={settings.appTheme === 'dark' ? 'selected' : ''} onClick={() => onChange({ ...settings, appTheme: 'dark' })}><Moon size={16} />夜间</button></div></div><div className="setting-row"><div><strong>每日阅读目标</strong><p>为自己留一小段专注的时间。</p></div><select aria-label="每日阅读目标" className="form-input compact" value={settings.dailyGoal} onChange={e => onChange({ ...settings, dailyGoal: Number(e.target.value) })}>{[10,15,20,30,45,60,90,120].map(n => <option key={n} value={n}>{n} 分钟</option>)}</select></div><div className="setting-row"><div><strong>减少动态效果</strong><p>简化页面切换和悬停时的动画。</p></div><button role="switch" aria-checked={settings.reduceMotion} aria-label="减少动态效果" className={`switch ${settings.reduceMotion ? 'on' : ''}`} onClick={() => onChange({ ...settings, reduceMotion: !settings.reduceMotion })}><span /></button></div></section>
    <section className="settings-card"><div className="settings-section-title"><BookOpen size={19} /><h2>默认阅读样式</h2></div><div className="setting-row"><div><strong>正文字体</strong><p>字号、行距、主题可在阅读时随时调整。</p></div><div className="segmented-control"><button className={settings.reader.font === 'serif' ? 'selected' : ''} onClick={() => onChange({ ...settings, reader: { ...settings.reader, font: 'serif' } })}>宋体</button><button className={settings.reader.font === 'sans' ? 'selected' : ''} onClick={() => onChange({ ...settings, reader: { ...settings.reader, font: 'sans' } })}>黑体</button></div></div><div className="setting-row"><div><strong>默认字号</strong><p>适用于 TXT、EPUB、HTML 和 Markdown。</p></div><div className="range-control"><input aria-label="默认字号" type="range" min="14" max="32" value={settings.reader.fontSize} onChange={e => onChange({ ...settings, reader: { ...settings.reader, fontSize: Number(e.target.value) } })} /><span>{settings.reader.fontSize}px</span></div></div></section>
    <section className="settings-card"><div className="settings-section-title"><Download size={19} /><h2>我的阅读资料</h2></div><div className="setting-row"><div><strong>完整备份</strong><p>导出书籍文件、书单、进度、书评与摘录。</p></div><button className="button secondary" onClick={onExport} disabled={busy}><Download size={16} />{busy ? '正在处理…' : '导出备份'}</button></div><div className="setting-row"><div><strong>恢复备份</strong><p>从 .qidu 文件恢复资料，确认后替换当前书架。</p></div><button className="button secondary" onClick={() => restore.current?.click()} disabled={busy}><Upload size={16} />选择备份</button><input className="sr-only" ref={restore} type="file" accept=".qidu" aria-label="恢复备份文件" onChange={e => { const file = e.target.files?.[0]; if (file) onRestore(file); e.target.value = ''; }} /></div></section>
    {children}
    <div className="about-app"><BookOpen size={25} strokeWidth={1.3} /><strong>栖读 QIDU</strong><span>版本 1.7.0 · 本地优先 · 私人书架</span><p>给阅读一个安静的空间。</p></div>
  </div>;
}
