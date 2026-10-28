import { BarChart3, BookHeart, BookOpen, Bookmark, ChevronRight, CircleHelp, Compass, Folder, LibraryBig, Plus, Settings2, Sprout } from 'lucide-react';
import type { Collection, Page } from '../types';
import { IconButton } from './ui';

export function Sidebar({ page, collectionId, collections, bookCount, noteCount, onPage, onCollection, onNewCollection, onHelp }: {
  page: Page; collectionId?: string; collections: Collection[]; bookCount: number; noteCount: number;
  onPage: (page: Page) => void; onCollection: (id: string) => void; onNewCollection: () => void; onHelp: () => void;
}) {
  const navigation = [
    { id: 'library' as const, label: '我的书架', icon: LibraryBig, count: bookCount },
    { id: 'discover' as const, label: '发现好书', icon: Compass },
    { id: 'reviews' as const, label: '书评手记', icon: BookHeart },
    { id: 'notes' as const, label: '摘录与书签', icon: Bookmark, count: noteCount || undefined },
    { id: 'stats' as const, label: '阅读足迹', icon: BarChart3 },
  ];
  return <aside className="sidebar">
    <div className="brand"><div className="brand-icon"><BookOpen size={25} strokeWidth={1.6} /></div><div><span>栖读</span><small>QIDU READER</small></div></div>
    <div className="sidebar-label">我的阅读空间</div>
    <nav className="primary-nav">{navigation.map(item => <button key={item.id} className={page === item.id && !collectionId ? 'active' : ''} onClick={() => onPage(item.id)}><item.icon size={19} strokeWidth={1.65} /><span>{item.label}</span>{item.count !== undefined && <small>{item.count}</small>}</button>)}</nav>
    <div className="collection-heading"><span className="sidebar-label">我的书单</span><IconButton label="新建书单" onClick={onNewCollection}><Plus size={15} /></IconButton></div>
    <nav className="collection-nav">{collections.map(c => <button key={c.id} className={collectionId === c.id ? 'active' : ''} onClick={() => onCollection(c.id)}><Folder size={16} style={{ color: c.color }} strokeWidth={1.5} /><span>{c.name}</span><ChevronRight size={13} /></button>)}<button className="add-collection" onClick={onNewCollection}><Plus size={15} /><span>新建书单</span></button></nav>
    <div className="sidebar-bottom"><div className="reading-invitation"><Sprout size={22} strokeWidth={1.3} /><p>给忙碌的生活，<br />留一页空白。</p><span>A MOMENT FOR YOURSELF</span></div><button className={`settings-nav ${page === 'settings' ? 'active' : ''}`} onClick={() => onPage('settings')}><Settings2 size={17} />偏好设置</button><div className="local-profile"><div className="profile-avatar">读</div><div><strong>自在阅读者</strong><small><span />本地阅读空间</small></div><IconButton label="使用指南" onClick={onHelp}><CircleHelp size={17} /></IconButton></div></div>
  </aside>;
}
