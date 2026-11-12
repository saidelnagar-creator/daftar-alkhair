// أعداد صحيحة فقط: المبالغ بأعشار الجنيه، الكميات بالمئات، كميات الأصول بالآلاف.
// لا تستخدم الكسور العائمة للتخزين أبداً؛ التحويل يتم هنا فقط عند الإدخال والعرض.
import { RULES } from '../config/rules.js';

export const MONEY = RULES.scales.money;
export const QTY = RULES.scales.qty;
export const ASSET = RULES.scales.asset;

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(s) {
  return String(s)
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٫]/g, '.')
    .replace(/[٬,\s]/g, '');
}

// تقريب نصف لأعلى بعيداً عن الصفر (متماثل للسالب).
export function roundHalfUp(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

// تحويل نص/رقم إلى وحدات صحيحة حسب المعامل. يعيد null إذا كان الإدخال غير صالح
// أو يحتوي خانات عشرية أكثر من المسموح.
// maxDecimals: أقصى خانات عشرية مسموحة في الإدخال (افتراضياً ما يسمح به معامل التخزين).
export function parseUnits(input, scale, maxDecimals = null) {
  if (input === null || input === undefined) return null;
  const s = normalizeDigits(input).trim();
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '-' || s === '.') return null;
  const neg = s.startsWith('-');
  const [ip, fp = ''] = (neg ? s.slice(1) : s).split('.');
  const decimals = String(scale).length - 1;
  if (fp.replace(/0+$/, '').length > Math.min(decimals, maxDecimals ?? decimals)) return null;
  const units = Number(ip || '0') * scale + Number((fp + '000').slice(0, decimals) || '0');
  if (!Number.isSafeInteger(units)) return null;
  return neg ? -units : units;
}

// تحويل رقم عائم (من مصدر خارجي مثل الإكسيل) إلى وحدات مع التقريب.
export function unitsFromFloat(x, scale) {
  return roundHalfUp(Number(x) * scale);
}

export function formatUnits(units, scale, { arabic = false, sign = false } = {}) {
  if (units === null || units === undefined || Number.isNaN(units)) return '—';
  const neg = units < 0;
  const abs = Math.abs(units);
  const ip = Math.floor(abs / scale);
  const fp = abs % scale;
  let out = String(ip).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (fp) {
    const decimals = String(scale).length - 1;
    out += '.' + String(fp).padStart(decimals, '0').replace(/0+$/, '');
  }
  if (neg) out = '-' + out;
  else if (sign && units > 0) out = '+' + out;
  if (arabic) out = out.replace(/\d/g, (d) => AR_DIGITS[d]).replace(/,/g, '٬').replace('.', '٫');
  return out;
}

export const parseMoney = (s, decimals = null) => parseUnits(s, MONEY, decimals);
export const parseQty = (s, decimals = null) => parseUnits(s, QTY, decimals);
export const parseAssetQty = (s, decimals = null) => parseUnits(s, ASSET, decimals);

// خطوة التقريب بوحدات التخزين لعدد خانات معيّن: مبالغ بلا كسور ⇒ 10 (أي جنيه كامل).
export const stepFor = (scale, decimals) => scale / 10 ** Math.min(decimals, String(scale).length - 1);
export const isMultiple = (x, step) => Number.isSafeInteger(x) && x % step === 0;
export const roundToStep = (x, step) => roundHalfUp(x / step) * step;
export const fmtMoney = (u, o) => formatUnits(u, MONEY, o);
export const fmtQty = (u, o) => formatUnits(u, QTY, o);
export const fmtAssetQty = (u, o) => formatUnits(u, ASSET, o);

export function isAmount(x) {
  return Number.isSafeInteger(x);
}

// round(a*b/c) بدقة كاملة (BigInt عند تجاوز المدى الآمن).
export function mulDiv(a, b, c) {
  if (c === 0) throw new Error('قسمة على صفر');
  const p = a * b;
  if (Number.isSafeInteger(p)) return roundHalfUp(p / c);
  const A = BigInt(a) * BigInt(b);
  const C = BigInt(c);
  const neg = A < 0n !== C < 0n;
  const absA = A < 0n ? -A : A;
  const absC = C < 0n ? -C : C;
  const q = (absA * 2n + absC) / (absC * 2n);
  return Number(neg ? -q : q);
}

// تقسيم مبلغ على n بنود بالتساوي: كل بند مقرَّب (لمضاعفات step) وآخر بند يأخذ الباقي (المجموع محفوظ دائماً).
export function splitEven(total, n, step = 1) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('عدد البنود غير صالح');
  const each = roundToStep(total / n, step);
  const parts = new Array(n).fill(each);
  parts[n - 1] = total - each * (n - 1);
  return parts;
}

// تقسيم مبلغ بنسب أوزان: كل بند مقرَّب وآخر بند (ذو وزن) يأخذ الباقي.
export function splitByWeights(total, weights, step = 1) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('مجموع الأوزان يجب أن يكون موجباً');
  let last = -1;
  weights.forEach((w, i) => {
    if (w > 0) last = i;
  });
  const parts = [];
  let used = 0;
  weights.forEach((w, i) => {
    if (i === last) {
      parts.push(total - used);
    } else {
      const p = w > 0 ? roundToStep(mulDiv(total, w, sum), step) : 0;
      parts.push(p);
      used += p;
    }
  });
  return parts;
}

// تقريب سلسلة مبالغ لمضاعفات step بالتراكم: كل بند يبقى ضمن خطوة واحدة من قيمته والمجموع محفوظ (إن كان مضاعفاً).
export function roundSeries(values, step) {
  let exact = 0;
  let rounded = 0;
  return values.map((v) => {
    exact += v;
    const target = roundToStep(exact, step);
    const part = target - rounded;
    rounded = target;
    return part;
  });
}

// تكلفة الكمية الخارجة بمتوسط التكلفة (مقرَّبة لمضاعفات step)؛ إذا خرجت كل الكمية تخرج كل التكلفة (لا يبقى فرق تقريب).
export function costOfQty(totalCost, totalQty, qtyOut, step = 1) {
  if (qtyOut >= totalQty) return totalCost;
  if (totalQty <= 0) return 0;
  return Math.max(0, Math.min(totalCost, roundToStep(mulDiv(totalCost, qtyOut, totalQty), step)));
}
