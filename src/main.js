// نقطة التشغيل: فتح المخزن (مع ترحيل آمن إن لزم) ثم الواجهة ثم Service Worker.
import { APP_VERSION } from './config/version.js';
import { Store } from './storage/store.js';
import { startApp, showUpdateBanner } from './ui/app.js';
import { confirmDialog, toast } from './ui/components.js';
import { readCanary, readMirror, startMirror, writeCanary } from './storage/mirror.js';
import { parseBackup } from './core/backup.js';
import { seedEvents } from './core/book.js';

const bootMsg = (text, isError = false) => {
  const el = document.getElementById('boot-msg');
  if (el) {
    el.textContent = text;
    if (isError) el.style.color = 'var(--bad)';
  }
};

async function boot() {
  let store;
  try {
    store = await Store.open();
  } catch (e) {
    console.error(e);
    bootMsg(e.message || 'تعذّر فتح قاعدة البيانات', true);
    return;
  }
  // طلب تخزين دائم حتى لا يمسح المتصفح البيانات تلقائياً
  try {
    if (navigator.storage?.persist) navigator.storage.persist();
  } catch {
    /* غير مدعوم */
  }
  // حماية من ضياع البيانات: هل كانت هنا بيانات ثم اختفت قاعدة البيانات؟ اعرض الاسترجاع قبل أي شيء.
  const mirror = startMirror(store);
  if (store.isFresh) await offerRecovery(store);
  writeCanary(store);
  if (store.events.length > seedEvents().length) mirror.touch(); // مرآة أولى لدفتر موجود قبل هذه الميزة
  startApp(store);
  window.__daftar = { version: APP_VERSION, store, mirror }; // للتشخيص والاختبارات الآلية
  if (store.migrationInfo) toast(`تمت ترقية هيكل البيانات إلى الإصدار ${store.migrationInfo.to} (نسخة تلقائية محفوظة)`);
  registerSW();
}

// قاعدة جديدة فارغة مع وجود نسخة مرآة أو علامة تدل على بيانات سابقة ⇒ نعرض الاسترجاع.
async function offerRecovery(store) {
  const seeds = seedEvents().length;
  const doc = await readMirror();
  const canary = readCanary();
  const hasMirror = doc && Array.isArray(doc.events) && doc.events.length > seeds;
  if (!hasMirror && !(canary && canary.events > seeds)) return;
  const boot = document.getElementById('boot-msg');
  if (boot) boot.textContent = 'تنبيه: بيانات الدفتر غير موجودة على الجهاز';
  if (!hasMirror) {
    await confirmDialog({ title: 'بيانات الدفتر غير موجودة', message: `كان على هذا الجهاز دفتر به ${canary.events} حدثاً ولم يعد موجوداً (ربما مُسحت بيانات الموقع).\nلا توجد نسخة مرآة داخلية — استورد آخر نسخة احتياطية من: المزيد ← النسخ الاحتياطي.`, okText: 'فهمت', cancelText: 'إغلاق' });
    return;
  }
  const when = doc.exportedAt ? new Date(doc.exportedAt).toLocaleString('ar-EG') : '';
  const ok = await confirmDialog({
    title: 'استرجاع بيانات الدفتر؟',
    message: `قاعدة البيانات على الجهاز فارغة، لكن توجد نسخة مرآة داخلية محفوظة تلقائياً (${when}) بها ${doc.counts?.movements ?? ''} حركة.\nاسترجاعها يعيد الدفتر كما كان.`,
    okText: 'استرجاع',
    cancelText: 'بدء دفتر فارغ',
  });
  if (!ok) return;
  try {
    await store.importBackup(parseBackup(doc), 'replace');
    toast('تم استرجاع الدفتر من النسخة المرآة');
  } catch (e) {
    await confirmDialog({ title: 'تعذّر الاسترجاع', message: `${e.message}\nاستورد آخر نسخة احتياطية من: المزيد ← النسخ الاحتياطي.`, okText: 'فهمت', cancelText: 'إغلاق' });
  }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // تحكّم عامل جديد: أعد التحميل مرة واحدة لتشغيل الكود الجديد (البيانات في IndexedDB لا تُمس)
    if (reloading || !window.__daftarUpdating) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      const offer = (worker) => {
        if (!worker) return;
        showUpdateBanner(() => {
          window.__daftarUpdating = true;
          worker.postMessage({ type: 'SKIP_WAITING' });
        });
      };
      const track = (w) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      track(reg.installing); // تحديث بدأ تثبيته قبل وصولنا هنا
      reg.addEventListener('updatefound', () => track(reg.installing));
      if (navigator.serviceWorker.controller) reg.update().catch(() => {}); // فحص فوري عند كل فتح
      // فحص التحديث عند العودة للتطبيق
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('SW registration failed', e));
}

boot();
