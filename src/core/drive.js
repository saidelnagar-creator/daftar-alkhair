// النسخ الاحتياطي التلقائي على Google Drive — منطق خالص (بلا DOM): روابط التفويض وعميل رفع بسيط.
// لا خادم ولا مكتبات خارجية: تفويض OAuth بإعادة توجيه (response_type=token) بمعرّف العميل الخاص بصاحب الدفتر،
// وصلاحية drive.file فقط (التطبيق لا يرى في Drive إلا الملفات التي أنشأها هو).
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_FILE_NAME = 'daftar-alkhair-backup.json';

export function driveAuthUrl({ clientId, redirectUri, state, silent = false, hint = '' }) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'token', scope: DRIVE_SCOPE, state, include_granted_scopes: 'true' });
  if (silent) q.set('prompt', 'none');
  if (hint) q.set('login_hint', hint);
  return `${DRIVE_AUTH_ENDPOINT}?${q}`;
}

// يقرأ نتيجة التفويض من جزء الـ hash بعد العودة. يعيد null إن لم يكن الرابط عودة من Google.
export function parseAuthFragment(hash, now = Date.now()) {
  const h = String(hash || '').replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(h) || !/(^|&)state=/.test(h)) return null;
  const q = new URLSearchParams(h);
  if (q.get('error')) return { error: q.get('error'), state: q.get('state') };
  const expiresIn = Number(q.get('expires_in') || 3600);
  return { token: q.get('access_token'), expiresAt: now + Math.max(60, expiresIn - 120) * 1000, state: q.get('state') };
}

export const driveTokenValid = (cfg, now = Date.now()) => !!cfg && !!cfg.token && Number(cfg.expiresAt) > now;

export class DriveError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

async function call(fetchFn, url, init) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    throw new DriveError('تعذّر الاتصال بـ Google Drive (لا يوجد إنترنت؟)', 0);
  }
  if (!res.ok) throw new DriveError(res.status === 401 ? 'انتهت صلاحية الاتصال بـ Google Drive' : `رفض Google Drive الطلب (${res.status})`, res.status);
  return res.json();
}

// يرفع نص النسخة: يحدّث الملف المعروف، وإن لم يُعرف أو حُذف يبحث بالاسم ثم ينشئ ملفاً جديداً. يعيد { fileId, modifiedTime }.
export async function driveUpload({ token, fileId = null, name = DRIVE_FILE_NAME, content, fetchFn = globalThis.fetch }) {
  const auth = { Authorization: `Bearer ${token}` };
  const update = (id) => call(fetchFn, `${DRIVE_UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: content });
  if (fileId) {
    try {
      const r = await update(fileId);
      return { fileId: r.id, modifiedTime: r.modifiedTime };
    } catch (e) {
      if (e.status !== 404) throw e; // الملف حُذف من Drive: أنشئ غيره
    }
  }
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
  const found = await call(fetchFn, `${DRIVE_API}?q=${q}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`, { headers: auth });
  if (found.files && found.files.length) {
    const r = await update(found.files[0].id);
    return { fileId: r.id, modifiedTime: r.modifiedTime };
  }
  const boundary = 'daftar' + Math.random().toString(36).slice(2);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const r = await call(fetchFn, `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, { method: 'POST', headers: { ...auth, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return { fileId: r.id, modifiedTime: r.modifiedTime };
}

// ينزّل نص آخر نسخة من Drive (للاسترجاع على جهاز جديد).
export async function driveDownload({ token, fileId = null, name = DRIVE_FILE_NAME, fetchFn = globalThis.fetch }) {
  const auth = { Authorization: `Bearer ${token}` };
  let id = fileId;
  if (!id) {
    const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
    const found = await call(fetchFn, `${DRIVE_API}?q=${q}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`, { headers: auth });
    if (!found.files || !found.files.length) throw new DriveError('لا توجد نسخة للدفتر على هذا الحساب في Drive', 404);
    id = found.files[0].id;
  }
  let res;
  try {
    res = await fetchFn(`${DRIVE_API}/${encodeURIComponent(id)}?alt=media`, { headers: auth });
  } catch {
    throw new DriveError('تعذّر الاتصال بـ Google Drive (لا يوجد إنترنت؟)', 0);
  }
  if (!res.ok) throw new DriveError(`تعذّر تنزيل النسخة (${res.status})`, res.status);
  return { fileId: id, text: await res.text() };
}
