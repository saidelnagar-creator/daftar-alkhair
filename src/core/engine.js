// محرك الحالة: الدفتر سجل أحداث append-only، والحالة كلها مشتقة منه بإعادة التشغيل.
// لا يوجد أي رصيد مخزَّن: الأرصدة تُحسب في ledger.js من الحركات.
// هذا الملف خالص (بدون DOM أو IndexedDB) ويُختبر في Node.
import { DEFAULT_CRITERIA, DEFAULT_POINT_VALUE } from '../config/defaults.js';
import { RULES } from '../config/rules.js';
import { stepFor } from './money.js';
import { cmp, yearOf } from './util.js';

export const EVENT_TYPES = Object.freeze([
  'settings.set',
  'list.upsert',
  'subscriber.upsert',
  'subscription.set',
  'family.upsert',
  'family.profile.set',
  'price.set',
  'movement.add',
  'movement.void',
  'due.decision',
  'year.close',
  'year.reopen',
]);

export const LISTS = Object.freeze(['funds', 'campaigns', 'purposes', 'expenseTypes', 'items', 'familyCategories', 'assets']);

export function emptyState() {
  const lists = {};
  for (const l of LISTS) lists[l] = new Map();
  return {
    rev: 0,
    settings: {
      orgName: 'دفتر الخير',
      firstFiscalYear: null,
      digits: 'latn',
      criteria: JSON.parse(JSON.stringify(DEFAULT_CRITERIA)),
      pointValue: JSON.parse(JSON.stringify(DEFAULT_POINT_VALUE)),
      precision: [{ from: '2000-01', ...RULES.precisionDefault }],
      backupReminderDays: null,
    },
    lists,
    subscribers: new Map(),
    families: new Map(),
    prices: new Map(), // assetId -> [{date, price}]
    movements: [], // بترتيب الإدخال؛ الملغاة تبقى مع علامة voided
    mvById: new Map(),
    decisions: new Map(), // "entity:id:month" -> [{decision,date,reason,ts,closingYear}]
    closings: [], // [{year, ts, checkpoint, reopened}]
    vouchers: { R: 0, P: 0, J: 0 }, // آخر رقم سند لكل سلسلة (قبض / صرف / قيد)
    _cache: {},
  };
}

function upsertVersion(arr, key, entry) {
  const i = arr.findIndex((v) => v[key] === entry[key]);
  if (i >= 0) arr[i] = entry;
  else arr.push(entry);
  arr.sort((a, b) => cmp(a[key], b[key]));
}

// تطبيق حدث واحد (بدون تحقق — السجل موثوق؛ التحقق يتم قبل الإضافة في validate.js).
export function applyEvent(state, ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'settings.set':
      state.settings[d.key] = d.value;
      break;
    case 'list.upsert': {
      const map = state.lists[d.list];
      if (!map) break;
      map.set(d.item.id, { ...(map.get(d.item.id) || {}), ...d.item });
      break;
    }
    case 'subscriber.upsert': {
      const old = state.subscribers.get(d.id) || { versions: [] };
      state.subscribers.set(d.id, { ...old, ...d, versions: old.versions });
      break;
    }
    case 'subscription.set': {
      const s = state.subscribers.get(d.subscriberId);
      if (s) upsertVersion(s.versions, 'from', { from: d.from, amount: d.amount });
      break;
    }
    case 'family.upsert': {
      const old = state.families.get(d.id) || { profiles: [] };
      state.families.set(d.id, { ...old, ...d, profiles: old.profiles });
      break;
    }
    case 'family.profile.set': {
      const f = state.families.get(d.familyId);
      if (f) upsertVersion(f.profiles, 'from', { from: d.from, ...d.profile });
      break;
    }
    case 'price.set': {
      if (!state.prices.has(d.assetId)) state.prices.set(d.assetId, []);
      upsertVersion(state.prices.get(d.assetId), 'date', { date: d.date, price: d.price });
      break;
    }
    case 'movement.add': {
      const mv = { ...d.movement, seq: state.movements.length, ts: ev.ts };
      state.movements.push(mv);
      state.mvById.set(mv.id, mv);
      if (mv.voucher && mv.voucher.n > (state.vouchers[mv.voucher.s] || 0)) state.vouchers[mv.voucher.s] = mv.voucher.n;
      break;
    }
    case 'movement.void': {
      const mv = state.mvById.get(d.movementId);
      if (mv && !mv.voided) mv.voided = { ts: ev.ts, date: d.date, reason: d.reason || '' };
      break;
    }
    case 'due.decision': {
      const key = `${d.entity}:${d.entityId}:${d.month}`;
      if (!state.decisions.has(key)) state.decisions.set(key, []);
      state.decisions.get(key).push({ decision: d.decision, date: d.date, reason: d.reason || '', ts: ev.ts, closingYear: d.closingYear ?? null });
      break;
    }
    case 'year.close':
      state.closings.push({ year: d.year, ts: ev.ts, date: d.date, checkpoint: d.checkpoint, reopened: false });
      break;
    case 'year.reopen': {
      const c = [...state.closings].reverse().find((x) => x.year === d.year && !x.reopened);
      if (c) {
        c.reopened = true;
        c.reopenedAt = ev.ts;
        // التراجع عن الإقفال يلغي قرارات «لن يُسدد» التي اتُّخذت ضمن ذلك الإقفال.
        for (const [key, stack] of state.decisions) {
          const kept = stack.filter((x) => x.closingYear !== d.year);
          if (kept.length) state.decisions.set(key, kept);
          else state.decisions.delete(key);
        }
      }
      break;
    }
    default:
      break; // أنواع مجهولة تُتجاهل (توافق أمامي)
  }
  state.rev++;
  state._cache = {};
  return state;
}

export function buildState(events) {
  const state = emptyState();
  for (const ev of events) applyEvent(state, ev);
  return state;
}

// ---------- دوال قراءة أساسية ----------

export function cached(state, key, compute) {
  if (!(key in state._cache)) state._cache[key] = compute();
  return state._cache[key];
}

export function activeMovements(state) {
  return cached(state, 'active', () => state.movements.filter((m) => !m.voided).sort((a, b) => cmp(a.date, b.date) || a.seq - b.seq));
}

export function firstFiscalYear(state, nowYear = new Date().getFullYear()) {
  if (state.settings.firstFiscalYear) return state.settings.firstFiscalYear;
  let min = nowYear;
  for (const m of state.movements) min = Math.min(min, yearOf(m.date));
  return min;
}

// آخر سنة مقفولة (غير متراجع عنها) أو null.
export function closedThrough(state) {
  let y = null;
  for (const c of state.closings) if (!c.reopened && (y === null || c.year > y)) y = c.year;
  return y;
}

export function activeClosing(state, year) {
  return state.closings.find((c) => c.year === year && !c.reopened) || null;
}

export function isLockedDate(state, date) {
  const y = closedThrough(state);
  return y !== null && yearOf(date) <= y;
}

export function isLockedMonth(state, month) {
  const y = closedThrough(state);
  return y !== null && yearOf(month) <= y;
}

// السنة المالية لتاريخ: ميلادية، وما قبل بداية الدفاتر يُحسب ضمن أول سنة.
export function fiscalYearOf(state, date) {
  return Math.max(yearOf(date), firstFiscalYear(state));
}

// السنة المفتوحة الحالية = بعد آخر إقفال، أو أول سنة.
export function currentFiscalYear(state, nowYear = new Date().getFullYear()) {
  const y = closedThrough(state);
  return y === null ? firstFiscalYear(state, nowYear) : y + 1;
}

function versionAt(arr, key, point) {
  let found = null;
  for (const v of arr) {
    if (v[key] <= point) found = v;
    else break;
  }
  return found;
}

// الاشتراك المطلوب لمشترك في شهر (نسخ زمنية).
export function requiredAt(state, subscriberId, month) {
  const s = state.subscribers.get(subscriberId);
  if (!s) return 0;
  const v = versionAt(s.versions, 'from', month);
  return v ? v.amount : 0;
}

export function profileAt(state, familyId, month) {
  const f = state.families.get(familyId);
  if (!f) return null;
  return versionAt(f.profiles, 'from', month);
}

export function pointValueAt(state, month) {
  const v = versionAt(state.settings.pointValue || [], 'from', month);
  return v ? v.value : 0;
}

// الخانات العشرية السارية في تاريخ/شهر (نسخ زمنية: التغيير لا يمس الماضي).
export function precisionAt(state, dateOrMonth) {
  const v = versionAt(state.settings.precision || [], 'from', String(dateOrMonth).slice(0, 7));
  return v || { from: '2000-01', ...RULES.precisionDefault };
}

// خطوات التقريب بوحدات التخزين في تاريخ: { money, qty, asset }.
export function stepsAt(state, dateOrMonth) {
  const p = precisionAt(state, dateOrMonth);
  return { money: stepFor(RULES.scales.money, p.money), qty: stepFor(RULES.scales.qty, p.qty), asset: stepFor(RULES.scales.asset, p.asset) };
}

export function priceAt(state, assetId, date) {
  const v = versionAt(state.prices.get(assetId) || [], 'date', date);
  return v || null;
}

export function decisionFor(state, entity, entityId, month) {
  const stack = state.decisions.get(`${entity}:${entityId}:${month}`);
  return stack && stack.length ? stack[stack.length - 1] : null;
}

export function isWrittenOff(state, entity, entityId, month) {
  const d = decisionFor(state, entity, entityId, month);
  return !!d && d.decision === 'writeoff';
}

// ---------- الحسابات النقدية ----------
// الحساب النقدي = صندوق، أو صندوق#مفتاح-فرعي (حملة أو أمانة مخصصة).
export function targetAcct(target) {
  if (!target) return 'general';
  switch (target.type) {
    case 'fund':
      return target.id;
    case 'campaign':
      return `campaigns#campaign:${target.id}`;
    case 'family':
      return `earmarked#family:${target.id}`;
    case 'category':
      return `earmarked#category:${target.id}`;
    default:
      return 'general';
  }
}

export const acctFund = (acct) => acct.split('#')[0];
export const acctSub = (acct) => acct.split('#')[1] || null;

export function acctLabel(state, acct) {
  const fund = state.lists.funds.get(acctFund(acct));
  const sub = acctSub(acct);
  const fname = fund ? fund.name : acctFund(acct);
  if (!sub) return fname;
  const [type, id] = sub.split(':');
  if (type === 'campaign') return `حملة: ${state.lists.campaigns.get(id)?.name || id}`;
  if (type === 'family') return `مخصص لأسرة: ${state.families.get(id)?.name || id}`;
  if (type === 'category') return `مخصص لفئة: ${state.lists.familyCategories.get(id)?.name || id}`;
  return `${fname} (${sub})`;
}

// السندات المتسلسلة: قبض (R) لكل وارد، صرف (P) لكل منصرف، قيد (J) لما عداهما. الرقم يُثبَّت عند الإدخال ولا يُعاد استخدامه.
const VOUCHER_SERIES = { receipt: 'R', inkind_receipt: 'R', asset_income: 'R', asset_sell: 'R', distribution: 'P', expense: 'P', purchase: 'P', asset_buy: 'P' };
export const VOUCHER_LABEL = Object.freeze({ R: 'سند قبض', P: 'سند صرف', J: 'قيد' });
export const voucherSeries = (kind) => VOUCHER_SERIES[kind] || 'J';
export function nextVoucher(state, kind) {
  const s = voucherSeries(kind);
  return { s, n: (state.vouchers[s] || 0) + 1 };
}
export const voucherText = (mv) => (mv.voucher ? `${VOUCHER_LABEL[mv.voucher.s]} رقم ${mv.voucher.n}` : '');
