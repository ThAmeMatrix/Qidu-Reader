import type { BookPayload, LibraryState } from '../types';

const DB_NAME = 'qidu-library';
let opening: Promise<IDBDatabase> | undefined;

function database() {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('payloads', { keyPath: 'id' });
      request.result.createObjectStore('state');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = undefined; reject(request.error); };
  });
  return opening;
}

async function operation<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('保存未完成'));
  });
}

export const getState = () => operation<LibraryState | undefined>('state', 'readonly', s => s.get('library'));
export const saveState = (state: LibraryState) => operation<void>('state', 'readwrite', s => s.put(state, 'library'));
export const getPayload = (id: string) => operation<BookPayload | undefined>('payloads', 'readonly', s => s.get(id));
export const savePayload = (payload: BookPayload) => operation<void>('payloads', 'readwrite', s => s.put(payload));
export const deletePayload = (id: string) => operation<void>('payloads', 'readwrite', s => s.delete(id));

export async function restoreLibrary(state: LibraryState, payloads: BookPayload[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['state', 'payloads'], 'readwrite');
    const content = tx.objectStore('payloads'); content.clear();
    for (const payload of payloads) content.put(payload);
    tx.objectStore('state').put(state, 'library');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('恢复失败，原书架未被修改'));
  });
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分钟`;
}
