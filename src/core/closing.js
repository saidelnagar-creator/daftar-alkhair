// الإقفال السنوي: معاينة ← (نسخة تلقائية من طبقة التخزين) ← إقفال بنقطة تحقق ← إمكانية تراجع.
// الدفتر متصل: رصيد افتتاح السنة الجديدة = ناتج إقفال السابقة (نقطة التحقق) ويُتحقق من تطابقه مع إعادة الحساب.
import { acctFund, activeClosing, closedThrough, currentFiscalYear, firstFiscalYear, fiscalYearOf, activeMovements } from './engine.js';
import { assetPosition, cashPostings, computeLedger, fundCash, subAccounts, totalCash } from './ledger.js';
import { allArrears } from './subscriptions.js';
import { allFamilyDues } from './families.js';
import { ValidationError, stableStringify } from './util.js';
import { sha256 } from './sha256.js';

export const yearEnd = (year) => `${year}-12-31`;
export const yearLastMonth = (year) => `${year}-12`;

// نقطة التحقق: الناتج النهائي لكل حساب نقدي وأصل وصنف + المتأخرات المرحّلة.
export function buildCheckpoint(state, year) {
  const led = computeLedger(state, yearEnd(year));
  const cash = {};
  for (const [acct, v] of [...led.cash].sort()) if (v !== 0) cash[acct] = v;
  const assets = {};
  for (const [id, a] of [...led.assets].sort()) if (a.qty !== 0 || a.cost !== 0) assets[id] = { qty: a.qty, cost: a.cost };
  const items = {};
  for (const [id, it] of [...led.items].sort()) if (it.qty !== 0 || it.cost !== 0) items[id] = { qty: it.qty, cost: it.cost };
  const arrears = [];
  for (const a of allArrears(state, yearLastMonth(year))) {
    for (const m of a.months) arrears.push({ subscriberId: a.subscriber.id, month: m.month, remaining: m.remaining });
  }
  const familyDues = [];
  for (const a of allFamilyDues(state, yearLastMonth(year))) {
    for (const m of a.months) familyDues.push({ familyId: a.family.id, month: m.month, remaining: m.remaining });
  }
  const body = { year, cash, assets, items, arrears, familyDues, totalCash: totalCash(led) };
  return { ...body, hash: sha256(stableStringify(body)) };
}

// معاينة قبل الإقفال.
export function previewClose(state, year, { today = null } = {}) {
  const warnings = [];
  const next = currentFiscalYear(state);
  if (year !== next) throw new ValidationError(`السنة التالية للإقفال هي ${next}`);
  if (today && today <= yearEnd(year)) warnings.push(`السنة ${year} لم تنتهِ بعد — بعد الإقفال لا يمكن إضافة حركات بتاريخ داخلها.`);
  const led = computeLedger(state, yearEnd(year));
  if (led.problems.length) warnings.push('توجد أرصدة سالبة في المخزن أو الأصول — راجعها قبل الإقفال.');
  const funds = [];
  for (const f of state.lists.funds.values()) {
    const cash = fundCash(led, f.id);
    const subs = subAccounts(led, f.id).filter((a) => a.balance !== 0);
    let assetsCost = 0;
    let assetsValue = 0;
    for (const a of state.lists.assets.values()) {
      if (a.fundId !== f.id) continue;
      const pos = assetPosition(state, led, a.id, yearEnd(year));
      assetsCost += pos.cost;
      assetsValue += pos.value;
    }
    if (cash !== 0 || subs.length || assetsCost !== 0 || !f.archived) funds.push({ fund: f, cash, subs, assetsCost, assetsValue });
    if (cash < 0) warnings.push(`رصيد «${f.name}» سالب.`);
  }
  const assets = [...state.lists.assets.values()].map((a) => ({ asset: a, ...assetPosition(state, led, a.id, yearEnd(year)) })).filter((p) => p.qty !== 0 || p.cost !== 0 || p.realized !== 0);
  const items = [...state.lists.items.values()].map((it) => ({ item: it, qty: led.items.get(it.id)?.qty || 0, cost: led.items.get(it.id)?.cost || 0 })).filter((x) => x.qty !== 0 || x.cost !== 0);
  const arrears = allArrears(state, yearLastMonth(year));
  const familyDues = allFamilyDues(state, yearLastMonth(year));
  const flows = yearFlows(state, year);
  return { year, endDate: yearEnd(year), funds, assets, items, arrears, familyDues, flows, totalCash: totalCash(led), warnings, checkpoint: buildCheckpoint(state, year) };
}

// وارد/منصرف السنة المالية (التحويلات الداخلية لا تُحسب).
export function yearFlows(state, year) {
  let inflow = 0;
  let outflow = 0;
  let count = 0;
  for (const mv of activeMovements(state)) {
    if (fiscalYearOf(state, mv.date) !== year) continue;
    count++;
    if (mv.kind === 'transfer') continue;
    for (const [, d] of cashPostings(mv)) {
      if (d > 0) inflow += d;
      else outflow -= d;
    }
  }
  return { inflow, outflow, net: inflow - outflow, count };
}

// تنفيذ الإقفال على دفتر (Book): قرارات «لن يُسدد» ثم حدث الإقفال — كتلة واحدة.
// writeoffs: [{entity:'subscriber'|'family', entityId, month, reason}]
export function closeYear(book, year, { writeoffs = [], date, now = new Date() } = {}) {
  const trial = book.fork();
  for (const w of writeoffs) {
    trial.dispatch('due.decision', { entity: w.entity, entityId: w.entityId, month: w.month, decision: 'writeoff', date, reason: w.reason, closingYear: year }, { now });
  }
  const checkpoint = buildCheckpoint(trial.state, year);
  trial.dispatch('year.close', { year, date, checkpoint }, { now });
  const added = trial.events.slice(book.events.length);
  book.commit(added);
  return { events: added, checkpoint };
}

export function reopenYear(book, year, { reason = '', now = new Date() } = {}) {
  return book.dispatch('year.reopen', { year, reason }, { now });
}

// التحقق من سلامة الأرشيف: نقطة التحقق المخزَّنة يجب أن تساوي إعادة الحساب من الحركات.
export function verifyCheckpoint(state, year) {
  const c = activeClosing(state, year);
  if (!c) return { ok: false, reason: 'السنة غير مقفولة' };
  const fresh = buildCheckpoint(state, year);
  const diffs = [];
  const keys = new Set([...Object.keys(c.checkpoint.cash || {}), ...Object.keys(fresh.cash)]);
  for (const k of keys) {
    const a = c.checkpoint.cash[k] || 0;
    const b = fresh.cash[k] || 0;
    if (a !== b) diffs.push({ kind: 'cash', key: k, stored: a, computed: b });
  }
  for (const part of ['assets', 'items']) {
    const ks = new Set([...Object.keys(c.checkpoint[part] || {}), ...Object.keys(fresh[part])]);
    for (const k of ks) {
      const a = c.checkpoint[part][k] || { qty: 0, cost: 0 };
      const b = fresh[part][k] || { qty: 0, cost: 0 };
      if (a.qty !== b.qty || a.cost !== b.cost) diffs.push({ kind: part, key: k, stored: a, computed: b });
    }
  }
  return { ok: diffs.length === 0, diffs };
}

// الأرصدة الافتتاحية لسنة = نقطة تحقق السنة السابقة (أو أصفار لأول سنة).
export function openingBalances(state, year) {
  const c = activeClosing(state, year - 1);
  if (!c) return { cash: {}, assets: {}, items: {}, fromCheckpoint: false };
  return { cash: c.checkpoint.cash, assets: c.checkpoint.assets, items: c.checkpoint.items, fromCheckpoint: true };
}

export function openingCashOfFund(state, year, fundId) {
  const o = openingBalances(state, year);
  let s = 0;
  for (const [acct, v] of Object.entries(o.cash)) if (acctFund(acct) === fundId) s += v;
  return s;
}

export function closedYears(state) {
  return state.closings.filter((c) => !c.reopened).map((c) => c.year).sort();
}

export function fiscalInfo(state, nowYear) {
  return { first: firstFiscalYear(state, nowYear), closedThrough: closedThrough(state), current: currentFiscalYear(state, nowYear) };
}
