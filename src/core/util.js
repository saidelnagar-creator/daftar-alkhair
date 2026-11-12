// أدوات عامة: الشهور، المعرفات، الأخطاء، JSON ثابت الترتيب.
import { MONTH_NAMES } from '../config/defaults.js';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function check(cond, message) {
  if (!cond) throw new ValidationError(message);
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export const ymOf = (date) => date.slice(0, 7);
export const yearOf = (s) => Number(s.slice(0, 4));

export function addMonths(ym, n) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`;
}

// قائمة الشهور من a إلى b شاملة.
export function monthsRange(a, b) {
  const out = [];
  for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function monthLabel(ym, { short = false } = {}) {
  const name = MONTH_NAMES[Number(ym.slice(5, 7)) - 1];
  return short ? name : `${name} ${ym.slice(0, 4)}`;
}

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function newId(prefix = '') {
  const c = globalThis.crypto;
  let raw;
  if (c && typeof c.randomUUID === 'function') raw = c.randomUUID().replace(/-/g, '').slice(0, 20);
  else if (c && typeof c.getRandomValues === 'function') {
    raw = Array.from(c.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    raw = (Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 20);
  }
  return prefix + raw;
}

// JSON بترتيب مفاتيح ثابت — أساس الـ checksum.
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => stableStringify(x === undefined ? null : x)).join(',') + ']';
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function sum(arr, f = (x) => x) {
  let s = 0;
  for (const x of arr) s += f(x);
  return s;
}

export function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
