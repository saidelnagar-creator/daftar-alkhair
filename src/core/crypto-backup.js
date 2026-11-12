// تشفير النسخة الاحتياطية بكلمة سر (اختياري): AES-256-GCM بمفتاح مشتق بـ PBKDF2-SHA256 عبر WebCrypto.
// الملف المشفَّر لا يُقرأ بدون كلمة السر — ولا توجد طريقة لاسترجاعها إن نُسيت.
import { APP_ID } from '../config/version.js';
import { ValidationError } from './util.js';

const subtle = globalThis.crypto && globalThis.crypto.subtle;
export const KDF_ITERATIONS = 250000;
export const canEncrypt = () => !!subtle;
export const isEncryptedBackup = (obj) => !!obj && obj.app === APP_ID && obj.format === 'backup-encrypted';

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(doc, password, { iterations = KDF_ITERATIONS } = {}) {
  if (!subtle) throw new ValidationError('التشفير غير متاح في هذا المتصفح');
  if (typeof password !== 'string' || password.length < 6) throw new ValidationError('كلمة السر 6 أحرف على الأقل');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(doc))));
  return { app: APP_ID, format: 'backup-encrypted', v: 1, kdf: 'PBKDF2-SHA256', iterations, cipher: 'AES-256-GCM', exportedAt: doc.exportedAt, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

// يعيد مستند النسخة (كائناً) جاهزاً لـ parseBackup. كلمة سر خاطئة أو ملف معدَّل ⇒ ValidationError.
export async function decryptBackup(obj, password) {
  if (!subtle) throw new ValidationError('فك التشفير غير متاح في هذا المتصفح');
  if (!isEncryptedBackup(obj) || obj.v !== 1) throw new ValidationError('ملف مشفَّر بصيغة غير معروفة');
  try {
    const key = await deriveKey(String(password), fromB64(obj.salt), obj.iterations);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(obj.iv) }, key, fromB64(obj.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new ValidationError('كلمة السر غير صحيحة أو الملف تالف');
  }
}
