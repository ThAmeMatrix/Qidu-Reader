import JSZip from 'jszip';
import type { BookPayload, LibraryState } from '../types';
import { readablePayload } from './book-cache';
import { sanitizeHtml } from './importers';
import { validateDownloadProvider } from './downloads';
import { safeUrl, validateSource } from './sources';

function assert(condition: unknown, message = '备份文件结构不完整或版本不兼容'): asserts condition { if (!condition) throw new Error(message); }
const string = (value: unknown, max = 20000): value is string => typeof value === 'string' && value.length <= max;
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export function validateState(value: unknown): asserts value is LibraryState {
  assert(value && typeof value === 'object');
  const state = value as LibraryState;
  assert(state.version === 1 && Array.isArray(state.books) && Array.isArray(state.reviews) && Array.isArray(state.notes) && Array.isArray(state.collections));
  assert(state.books.length <= 10000 && state.notes.length <= 100000 && state.reviews.length <= 10000 && state.collections.length <= 1000);
  const ids = new Set<string>();
  for (const book of state.books) {
    assert(book && string(book.id, 80) && /^[\w-]+$/.test(book.id) && !ids.has(book.id)); ids.add(book.id);
    assert(string(book.title, 1000) && string(book.author, 1000) && ['TXT','EPUB','PDF','HTML','MD','WEB'].includes(book.format) && ['reading','want','finished'].includes(book.status));
    assert(number(book.progress, 0, 100) && number(book.cover, 0, 5) && Number.isInteger(book.cover) && number(book.addedAt, 0, 1e15) && number(book.size, 0, 1e12));
    assert(Array.isArray(book.collectionIds) && book.collectionIds.every(id => string(id, 80)));
    assert(book.location === undefined || string(book.location, 4000));
    assert(book.coverImage === undefined || (string(book.coverImage, 3e6) && /^data:image\/(png|jpeg|webp|gif);base64,/.test(book.coverImage)));
    assert(book.sourceUrl === undefined || (string(book.sourceUrl, 4096) && /^https?:\/\//i.test(book.sourceUrl)));
    assert(book.description === undefined || string(book.description, 20000));
    assert(book.favorite === undefined || typeof book.favorite === 'boolean');
    if(book.cache!==undefined){assert(book.cache&&string(book.cache.name,2000)&&number(book.cache.loadedAt,0,1e15));assert(book.cache.downloadId===undefined||/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(book.cache.downloadId));}
    if(book.cacheSource!==undefined){const source=book.cacheSource;assert(source&&string(source.url,16384)&&(/^(?:https?:|magnet:)/.test(source.url))&&['TXT','EPUB','PDF','ZIP','RAR','7Z'].includes(source.format));assert(string(source.name,2000)&&string(source.bookTitle,1000)&&string(source.bookAuthor,1000));}
    if (book.online !== undefined) {
      const remote = book.online;
      assert((book.format === 'WEB'||book.cache||book.cacheSource) && remote && string(remote.sourceId,80) && string(remote.sourceName,60) && safeUrl(remote.url) && string(remote.title,1000) && string(remote.author,1000) && string(remote.description,20000));
      assert(remote.coverUrl === undefined || safeUrl(remote.coverUrl));
      assert(remote.tags === undefined || (Array.isArray(remote.tags) && remote.tags.length <= 30 && remote.tags.every(t => string(t,200))));
    }
  }
  for (const review of state.reviews) assert(review && string(review.id, 80) && ids.has(review.bookId) && number(review.rating, 1, 5) && string(review.title, 1000) && string(review.body) && number(review.updatedAt, 0, 1e15));
  for (const note of state.notes) assert(note && string(note.id, 80) && ids.has(note.bookId) && ['highlight','bookmark'].includes(note.kind) && string(note.text) && (note.comment === undefined || string(note.comment)) && string(note.location, 4000) && number(note.progress, 0, 100) && number(note.createdAt, 0, 1e15));
  for (const collection of state.collections) assert(collection && string(collection.id, 80) && string(collection.name, 80) && /^#[a-fA-F0-9]{6}$/.test(collection.color));
  const settings = state.settings; assert(settings && ['light','dark'].includes(settings.appTheme) && typeof settings.reduceMotion === 'boolean' && number(settings.dailyGoal, 1, 1440));
  const reader = settings.reader; assert(reader && ['paper','light','dark','green'].includes(reader.theme) && ['serif','sans'].includes(reader.font) && number(reader.fontSize, 14, 32) && number(reader.lineHeight, 1.4, 2.6) && number(reader.width, 500, 1000));
  assert(state.readingSeconds && typeof state.readingSeconds === 'object' && !Array.isArray(state.readingSeconds));
  for (const [day, seconds] of Object.entries(state.readingSeconds)) assert(/^\d{4}-\d{2}-\d{2}$/.test(day) && number(seconds, 0, 86400));
  if (state.sources !== undefined) { assert(Array.isArray(state.sources) && state.sources.length <= 50); const sourceIds = new Set<string>(); for (const source of state.sources) { validateSource(source); assert(!sourceIds.has(source.id)); sourceIds.add(source.id); } }
  if (state.downloadProviders !== undefined) { assert(Array.isArray(state.downloadProviders) && state.downloadProviders.length <= 50); const providerIds = new Set<string>(); for (const provider of state.downloadProviders) { validateDownloadProvider(provider); assert(!providerIds.has(provider.id)); providerIds.add(provider.id); } }
  assert(state.searchHistory === undefined || (Array.isArray(state.searchHistory) && state.searchHistory.length <= 10 && state.searchHistory.every(q => string(q,100))));
  assert(state.sourceCatalogVersion === undefined || (Number.isSafeInteger(state.sourceCatalogVersion) && state.sourceCatalogVersion >= 0));
}

export async function createBackup(state: LibraryState): Promise<Blob> {
  const zip = new JSZip(); zip.file('library.json', JSON.stringify(state));
  for (const book of state.books) {
    if (book.sample || book.online&&!book.cache || book.cacheSource&&!book.cache) continue;
    const payload = await readablePayload(book);
    if (!payload) throw new Error(`《${book.title}》的文件内容缺失，请重新导入后再备份`);
    if (payload.blob) zip.file(`books/${book.id}.bin`, await payload.blob.arrayBuffer());
    if (payload.chapters) zip.file(`books/${book.id}.json`, JSON.stringify(payload.chapters));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
}

export async function readBackup(file: File): Promise<{ state: LibraryState; payloads: BookPayload[] }> {
  assert(file.size <= 500 * 1024 * 1024, '备份超过 500 MB，暂时无法导入');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifest = zip.file('library.json'); assert(manifest, '这不是有效的栖读备份文件');
  const state: unknown = JSON.parse(await manifest.async('string')); validateState(state);
  const payloads: BookPayload[] = [];
  for (const book of state.books) {
    if (book.sample || book.online&&!book.cache || book.cacheSource&&!book.cache) continue;
    const file = zip.file(`books/${book.id}.${book.format === 'PDF' || book.format === 'EPUB' ? 'bin' : 'json'}`);
    assert(file, `备份缺少《${book.title}》的内容`);
    if (book.format === 'PDF' || book.format === 'EPUB') payloads.push({ id: book.id, blob: new Blob([await file.async('arraybuffer')]) });
    else {
      const chapters = JSON.parse(await file.async('string'));
      assert(Array.isArray(chapters) && chapters.length > 0 && chapters.length <= 100000);
      for (const chapter of chapters) { assert(chapter && string(chapter.id, 1000) && string(chapter.title, 1000) && string(chapter.html, 100e6)); chapter.html = sanitizeHtml(chapter.html); }
      payloads.push({ id: book.id, chapters });
    }
  }
  for(const book of state.books)if(book.cache)delete book.cache.downloadId;
  return { state, payloads };
}
