// النسخ الاحتياطي التلقائي المستمر على Google Drive (اختياري — يُفعَّل من: المزيد ← النسخ الاحتياطي).
// بعد كل تغيير في الدفتر بمهلة قصيرة تُرفع نسخة كاملة إلى ملف واحد في حساب صاحب الدفتر (Drive يحتفظ بإصداراته).
// الإعداد على الجهاز فقط (meta.drive): معرّف العميل، رمز الدخول المؤقت، معرّف الملف — لا يدخل سجل الأحداث ولا النسخ.
// لا خادم: التفويض بإعادة توجيه إلى Google ثم العودة لرابط التطبيق. رمز الدخول يعيش ساعة؛ عند انتهائه
// يبقى الرفع معلَّقاً ويظهر زر «تجديد الاتصال» (نقرة واحدة، وبلا شاشة موافقة ما دام الحساب مسجلاً في المتصفح).
import { DRIVE_FILE_NAME, driveAuthUrl, driveDownload, driveTokenValid, driveUpload, parseAuthFragment } from '../core/drive.js';
import { encryptBackup } from '../core/crypto-backup.js';
import { redactNeedEvents } from '../core/need.js';
import { newId } from '../core/util.js';

let timer = null;
let busy = false;
let again = false;

export const driveConfig = (store) => store.meta.drive || null;
export const driveEnabled = (store) => !!driveConfig(store)?.clientId && !!driveConfig(store)?.auto;
// رابط العودة = رابط التطبيق نفسه (بلا index.html ولا hash) — يجب أن يطابق ما سُجّل في Google Cloud حرفياً.
export const driveRedirectUri = () => (location.origin + location.pathname).replace(/index\.html$/, '');

async function patch(store, changes) {
  await store.setMeta('drive', { ...(driveConfig(store) || {}), ...changes });
  store._notify();
}

// الحالة للعرض: off | ok | pending | needs-auth | error
export function driveStatus(store) {
  const c = driveConfig(store);
  if (!c || !c.clientId || !c.auto) return { state: 'off' };
  const pending = Math.max(0, store.events.length - (c.lastEvents || 0));
  if (!driveTokenValid(c)) return { state: 'needs-auth', pending, lastAt: c.lastAt || null };
  if (c.lastError) return { state: 'error', pending, lastAt: c.lastAt || null, error: c.lastError };
  return { state: pending ? 'pending' : 'ok', pending, lastAt: c.lastAt || null };
}

// بدء التفويض: حفظ علامة عشوائية ثم الانتقال إلى Google. silent: بلا شاشة موافقة إن أمكن.
export async function driveConnect(store, { silent = false } = {}) {
  const c = driveConfig(store);
  if (!c?.clientId) throw new Error('أدخل معرّف العميل (Client ID) أولاً');
  const state = newId('g');
  await store.setMeta('drive', { ...c, pending: { state, silent, back: location.hash || '#/' } });
  location.assign(driveAuthUrl({ clientId: c.clientId, redirectUri: driveRedirectUri(), state, silent }));
}

// يُستدعى عند فتح التطبيق: إن كان الرابط عودة من Google يحفظ الرمز ويعيد المسار. يعيد true إن عالج عودة.
export async function driveHandleReturn(store) {
  const res = parseAuthFragment(location.hash);
  if (!res) return false;
  const c = driveConfig(store);
  const pending = c?.pending;
  const back = pending?.back && !/access_token|error=/.test(pending.back) ? pending.back : '#/backup';
  history.replaceState(null, '', location.pathname + location.search + back);
  if (!c || !pending || pending.state !== res.state) return true; // رابط لا يخصنا: يُتجاهل
  if (res.error) {
    if (pending.silent && /interaction_required|login_required|consent_required|account_selection_required/.test(res.error)) {
      await driveConnect(store, { silent: false }); // تحتاج موافقة ظاهرة: مرة واحدة
      return true;
    }
    await store.setMeta('drive', { ...c, pending: undefined, lastError: res.error === 'access_denied' ? 'رُفض الإذن من حساب Google' : `تعذّر الاتصال بـ Google (${res.error})` });
    return true;
  }
  await store.setMeta('drive', { ...c, pending: undefined, token: res.token, expiresAt: res.expiresAt, lastError: null });
  return true;
}

export async function driveDisconnect(store) {
  const c = driveConfig(store) || {};
  await patch(store, { token: undefined, expiresAt: undefined, auto: false, pending: undefined, lastError: null, clientId: c.clientId });
}

// رفع فوري. يعيد { ok } أو يرمي. force: حتى لو لا تغييرات جديدة.
export async function driveSyncNow(store, { force = false, fetchFn = globalThis.fetch } = {}) {
  const c = driveConfig(store);
  if (!c?.clientId) return { ok: false, reason: 'off' };
  if (!driveTokenValid(c)) return { ok: false, reason: 'needs-auth' };
  if (!force && (c.lastEvents || 0) === store.events.length) return { ok: true, skipped: true };
  if (busy) {
    again = true;
    return { ok: false, reason: 'busy' };
  }
  busy = true;
  try {
    const count = store.events.length;
    const doc = store.exportDoc('drive', c.redactNeed ? { redact: redactNeedEvents } : {});
    const payload = c.password ? await encryptBackup(doc, c.password) : doc;
    const res = await driveUpload({ token: c.token, fileId: c.fileId || null, name: DRIVE_FILE_NAME, content: JSON.stringify(payload), fetchFn });
    await store.setMeta('drive', { ...driveConfig(store), fileId: res.fileId, lastAt: new Date().toISOString(), lastEvents: count, lastError: null });
    if (!c.redactNeed) await store.markBackedUp(); // نسخة كاملة خارج الجهاز
    else store._notify();
    return { ok: true };
  } catch (e) {
    const expired = e.status === 401;
    await patch(store, { lastError: expired ? null : e.message, ...(expired ? { token: undefined, expiresAt: 0 } : {}) });
    return { ok: false, reason: expired ? 'needs-auth' : 'error', error: e.message };
  } finally {
    busy = false;
    if (again) {
      again = false;
      schedule(store, 1500);
    }
  }
}

export async function driveFetchBackup(store, { fetchFn = globalThis.fetch } = {}) {
  const c = driveConfig(store);
  if (!driveTokenValid(c)) throw new Error('جدّد الاتصال بـ Google Drive أولاً');
  return (await driveDownload({ token: c.token, fileId: c.fileId || null, fetchFn })).text;
}

function schedule(store, delay) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (driveEnabled(store) && navigator.onLine !== false) driveSyncNow(store).catch(() => {});
  }, delay);
}

// يبدأ المراقبة: كل تغيير في الدفتر يُرفع بعد مهلة، وعند عودة الاتصال أو العودة للتطبيق.
export function startDriveSync(store, { delay = 5000 } = {}) {
  let seen = store.events.length;
  store.subscribe(() => {
    if (store.events.length === seen) return; // تغيّر meta فقط
    seen = store.events.length;
    if (driveEnabled(store)) schedule(store, delay);
  });
  window.addEventListener('online', () => driveEnabled(store) && schedule(store, 1000));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && driveEnabled(store)) schedule(store, 1500);
  });
  if (driveEnabled(store)) schedule(store, 2000);
}
