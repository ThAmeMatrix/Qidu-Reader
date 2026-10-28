import {HardDrive,Trash2} from 'lucide-react';
import type {Book} from '../types';
export function LocalCachePanel({books,busy,onClear}:{books:Book[];busy?:string;onClear:(book:Book)=>Promise<unknown>}){
 const cached=books.filter(book=>book.cache),total=cached.reduce((n,b)=>n+b.size,0);
 return <section className="local-cache-panel"><h2><HardDrive size={18}/>本地阅读缓存 <small>{cached.length} 本 · {(total/1048576).toFixed(1)} MB</small></h2><p>清空缓存会删除下载文件，保留收藏、书评和阅读进度。再次阅读时可重新加载。</p>{cached.map(book=><div className="cache-book-status" key={book.id}><div><strong>{book.title}</strong><small>{book.format} · {(book.size/1048576).toFixed(1)} MB</small></div><button className="button secondary small" aria-label={`清空《${book.title}》缓存`} disabled={!!busy} onClick={()=>void onClear(book)}><Trash2 size={13}/>{busy===book.id?'正在清理…':'清空缓存'}</button></div>)}{!cached.length&&<p>还没有加载到本地的作品。</p>}</section>;
}
