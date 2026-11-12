// نسخة مرآة داخلية + علامة وجود: خط دفاع ثانٍ ضد تلف أو اختفاء IndexedDB وحده.
//   المرآة: آخر نسخة احتياطية كاملة تُكتب تلقائياً في Cache Storage (مخزن مستقل عن IndexedDB وعن كاش ملفات التطبيق).
//   العلامة: عدد الأحداث وآخر معرّف في localStorage — تكشف عند التشغيل أن بيانات كانت موجودة ثم اختفت.
// تنبيه: كل ذلك على نفس الجهاز ونفس الرابط؛ حذف التطبيق أو بيانات الموقع يمسحها معاً. لا تغني عن التصدير خارج الهاتف.
const MIRROR_CACHE = 'daftar-mirror-v1'; // اسم لا يبدأ ببادئة كاش الأصول حتى لا يحذفه الـ Service Worker
const MIRROR_KEY = './__mirror__/backup.json';
const CANARY_KEY = 'daftar-alkhair:canary';

export const mirrorSupported = () => typeof caches !== 'undefined';

export async function writeMirror(doc) {
  if (!mirrorSupported()) return false;
  const cache = await caches.open(MIRROR_CACHE);
  await cache.put(MIRROR_KEY, new Response(JSON.stringify(doc), { headers: { 'Content-Type': 'application/json' } }));
  return true;
}

export async function readMirror() {
  if (!mirrorSupported()) return null;
  try {
    const cache = await caches.open(MIRROR_CACHE);
    const res = await cache.match(MIRROR_KEY);
    return res ? await res.json() : null;
  } catch {
    return null;
  }
}

export function writeCanary(store) {
  try {
    const ev = store.events;
    localStorage.setItem(CANARY_KEY, JSON.stringify({ events: ev.length, last: ev.length ? ev[ev.length - 1].id : null, at: new Date().toISOString() }));
  } catch {
    /* localStorage غير متاح */
  }
}

export function readCanary() {
  try {
    return JSON.parse(localStorage.getItem(CANARY_KEY) || 'null');
  } catch {
    return null;
  }
}

// كاتب المرآة: بعد كل تغيير بمهلة قصيرة، وفوراً عند ذهاب التطبيق للخلفية.
export function startMirror(store, { delay = 2500 } = {}) {
  let timer = null;
  let dirty = false;
  const flush = async () => {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;
    try {
      await writeMirror(store.exportDoc('mirror'));
    } catch (e) {
      console.warn('mirror write failed', e);
    }
  };
  const touch = () => {
    dirty = true;
    writeCanary(store);
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  store.subscribe(touch);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush();
    });
    window.addEventListener('pagehide', flush);
  }
  return { flush, touch };
}
