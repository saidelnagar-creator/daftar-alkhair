// غلاف صغير لـ IndexedDB بوعود. إصدار قاعدة IndexedDB (IDB_VERSION) يخص تعريف المخازن فقط
// ولا علاقة له بإصدار هيكل البيانات (schemaVersion) الذي تديره سلسلة الترحيلات.
export const IDB_VERSION = 1;

export function openDB(name, idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!idb) return reject(new Error('IndexedDB غير متاح في هذا المتصفح'));
    const req = idb.open(name, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'seq' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('قاعدة البيانات مفتوحة في نافذة أخرى'));
  });
}

// ينفّذ fn داخل معاملة واحدة: إما تنجح كلها أو لا يُكتب شيء.
export function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('أُلغيت المعاملة'));
    try {
      result = fn(Object.fromEntries([].concat(stores).map((s) => [s, t.objectStore(s)])), t);
    } catch (e) {
      try {
        t.abort();
      } catch {
        /* تجاهل */
      }
      reject(e);
    }
  });
}

export function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(db, store) {
  return tx(db, [store], 'readonly', (s) => reqP(s[store].getAll())).then((p) => p);
}
