import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { initialState } from '../src/lib/samples';
import { getPayload, getState, localDateKey, restoreLibrary, savePayload, saveState } from '../src/lib/storage';
import { createBackup, readBackup, validateState } from '../src/lib/backup';
import { defaultSources } from '../src/lib/sources';
import { defaultDownloadProviders } from '../src/lib/downloads';

describe('local reading data', () => {
  it('persists book progress, reviews and reader preferences', async () => {
    const state = structuredClone(initialState); state.books[0].progress = 37; state.books[0].location = 'text:1:0.48'; state.settings.reader.theme = 'dark';
    await saveState(state); expect(await getState()).toEqual(state);
  });
  it('persists chapter payloads', async () => {
    const payload = { id: 'test-content', chapters: [{ id: '1', title: '开篇', html: '<p>保存在本机。</p>' }] };
    await savePayload(payload); expect(await getPayload(payload.id)).toEqual(payload);
  });
  it('restores state and content in one transaction', async () => {
    const state = structuredClone(initialState);
    const payload = { id: 'restored', chapters: [{ id: '1', title: '新的书', html: '<p>新的内容。</p>' }] };
    await restoreLibrary(state, [payload]);
    expect(await getPayload('test-content')).toBeUndefined(); expect(await getPayload('restored')).toEqual(payload); expect(await getState()).toEqual(state);
  });
  it('round-trips a complete backup', async () => {
    const state = structuredClone(initialState);
    state.downloadProviders = [{ ...defaultDownloadProviders[2],enabled:false }, { ...defaultDownloadProviders[5],id:'download-personal',name:'个人下载站',searchUrl:'https://example.org/?q={title}&format={format}' }];
    state.books.push({ ...state.books[0], id: 'backup-book', title: '备份测试', sample: false, progress: 42 });
    await savePayload({ id: 'backup-book', chapters: [{ id: '1', title: '回来', html: '<p>数据完整保存。</p>' }] });
    const blob = await createBackup(state);
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
    const result = await readBackup(new NodeFile([new Uint8Array(arrayBuffer)], 'test.qidu') as unknown as File);
    expect(result.state).toEqual(state); expect(result.payloads[0].chapters?.[0].html).toContain('数据完整保存');
  });
  it('rejects malicious and malformed backup settings', () => {
    expect(() => validateState({ version: 1 })).toThrow();
    const state = structuredClone(initialState); state.books[0].coverImage = 'javascript:alert(1)'; expect(() => validateState(state)).toThrow();
    const invalid = structuredClone(initialState); invalid.settings.reader.fontSize = Infinity; expect(() => validateState(invalid)).toThrow();
  });
  it('backs up online metadata without requiring offline book content', async () => {
    const state = structuredClone(initialState); state.sources = structuredClone(defaultSources); state.searchHistory = ['秋日'];
    state.books.push({ ...state.books[0], id:'online-test', sample:false, format:'WEB', favorite:false, online:{sourceId:'zongheng',sourceName:'纵横中文网',url:'https://book.zongheng.com/book/123.html',title:'秋日',author:'作者',description:'在线书目'} });
    const blob = await createBackup(state);
    const bytes = await new Promise<ArrayBuffer>((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob); });
    const restored = await readBackup(new NodeFile([new Uint8Array(bytes)],'online.qidu') as unknown as File);
    expect(restored.state).toEqual(state);expect(restored.payloads).toHaveLength(0);
  });
  it('uses the local day for reading statistics', () => expect(localDateKey(new Date(2026,9,23,0,30))).toBe('2026-10-23'));
});
