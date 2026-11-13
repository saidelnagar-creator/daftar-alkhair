// الالتزام العيني الشهري للأسر: خطة بتاريخ سريان (family.inkind.set)، ما وصل منها وما تبقى،
// التوزيع المجمّع لعدة أسر وعدة شهور، البدائل ونسبة الاستبدال، واقتراح كميات الشراء.
// كل الدوال خالصة: تخطط حركات صرف عادية (distribution) تُحفظ عبر Book — لا نوع حركة جديد ولا رصيد مخزَّن.
import { acctBalance, computeLedger, itemPosition } from './ledger.js';
import { activeMovements, cached, inkindPlanAt, stepsAt } from './engine.js';
import { familyFirstMonth, familyMonthStatus } from './families.js';
import { mulDiv, roundToStep } from './money.js';
import { cmp, monthsRange, ymOf } from './util.js';

// ما غُطّي من الالتزام: أسرة ← "شهر|صنف" ← كمية (بوحدة صنف الالتزام).
export function inkindIndex(state) {
  return cached(state, 'inkindIndex', () => {
    const idx = new Map();
    for (const mv of activeMovements(state)) {
      if (mv.kind !== 'distribution' || !mv.familyId || !mv.inkindLines) continue;
      let m = idx.get(mv.familyId);
      if (!m) idx.set(mv.familyId, (m = new Map()));
      for (const l of mv.inkindLines) m.set(`${l.month}|${l.itemId}`, (m.get(`${l.month}|${l.itemId}`) || 0) + l.qty);
    }
    return idx;
  });
}

// حالة التزام شهر لأسرة: لكل صنف المطلوب والمغطّى والمتبقي.
export function inkindMonthStatus(state, familyId, month) {
  const covered = inkindIndex(state).get(familyId);
  return inkindPlanAt(state, familyId, month).map((l) => {
    const c = covered?.get(`${month}|${l.itemId}`) || 0;
    return { month, itemId: l.itemId, qty: l.qty, alts: l.alts || [], covered: c, remaining: Math.max(0, l.qty - c) };
  });
}

export const hasInkindPlan = (state, familyId) => (state.families.get(familyId)?.inkind || []).some((v) => v.lines.length > 0);

// أول شهر في خطة الأسرة العينية (أو null).
export function inkindFirstMonth(state, familyId) {
  const v = (state.families.get(familyId)?.inkind || []).find((x) => x.lines.length > 0);
  return v ? v.from : null;
}

// البنود المتبقية لأسرة في مدى شهور (اختيارياً لأصناف محددة).
export function inkindRemaining(state, familyId, fromMonth, toMonth, itemIds = null) {
  const out = [];
  if (fromMonth > toMonth) return out;
  for (const m of monthsRange(fromMonth, toMonth)) {
    for (const st of inkindMonthStatus(state, familyId, m)) {
      if (st.remaining > 0 && (!itemIds || itemIds.includes(st.itemId))) out.push(st);
    }
  }
  return out;
}

// إجمالي الالتزام (المطلوب والمتبقي) من كل صنف لمجموعة أسر في فترة.
export function inkindTotals(state, { familyIds, fromMonth, toMonth, itemIds = null }) {
  const by = new Map();
  for (const id of familyIds) {
    for (const m of fromMonth <= toMonth ? monthsRange(fromMonth, toMonth) : []) {
      for (const st of inkindMonthStatus(state, id, m)) {
        if (itemIds && !itemIds.includes(st.itemId)) continue;
        if (!by.has(st.itemId)) by.set(st.itemId, { itemId: st.itemId, required: 0, covered: 0, remaining: 0, families: new Set() });
        const r = by.get(st.itemId);
        r.required += st.qty;
        r.covered += Math.min(st.covered, st.qty);
        r.remaining += st.remaining;
        r.families.add(id);
      }
    }
  }
  return [...by.values()].map((r) => ({ ...r, families: r.families.size }));
}

// ما يُعطى فعلاً مقابل بند التزام: الصنف نفسه أو بديله المعرَّف للأسرة، مضروباً في نسبة الشهر (مثلاً 75%).
// choice: { give: itemId, pct: 1..100+ }. بديل غير معرَّف لهذه الأسرة ← يُعطى الصنف الأصلي.
export function givenFor(line, remaining, choice, qtyStep) {
  const pct = choice && Number.isInteger(choice.pct) && choice.pct > 0 ? choice.pct : 100;
  let itemId = line.itemId;
  let qty = remaining;
  if (choice && choice.give && choice.give !== line.itemId) {
    const alt = (line.alts || []).find((a) => a.itemId === choice.give);
    if (alt) {
      itemId = alt.itemId;
      qty = mulDiv(remaining, alt.qty, line.qty);
    }
  }
  qty = roundToStep(mulDiv(qty, pct, 100), qtyStep);
  return { itemId, qty };
}

function stockRows(state, need) {
  const led = computeLedger(state);
  return [...need].map(([itemId, qty]) => {
    const stock = itemPosition(led, itemId).qty;
    return { itemId, qty, stock, short: Math.max(0, qty - stock) };
  });
}

// خطة توزيع عيني مجمّع ضمن الالتزام: لكل أسرة حركة صرف واحدة تغطي بنودها المتبقية في المدى المختار.
// choices: { [صنف الالتزام]: { give, pct } } — بديل و/أو نسبة استبدال لهذه الدفعة.
export function planInkindBatch(state, { familyIds, fromMonth, toMonth, itemIds = null, choices = {}, date, batchId, note = '' }) {
  const step = stepsAt(state, date).qty;
  const movements = [];
  const need = new Map();
  const families = [];
  for (const familyId of familyIds) {
    const lines = inkindRemaining(state, familyId, fromMonth, toMonth, itemIds);
    if (!lines.length) continue;
    const give = new Map();
    const inkindLines = [];
    for (const l of lines) {
      const g = givenFor(l, l.remaining, choices[l.itemId], step);
      if (g.qty <= 0) continue;
      give.set(g.itemId, (give.get(g.itemId) || 0) + g.qty);
      inkindLines.push({ month: l.month, itemId: l.itemId, qty: l.remaining });
    }
    if (!inkindLines.length) continue;
    const items = [...give].map(([itemId, qty]) => ({ itemId, qty }));
    for (const it of items) need.set(it.itemId, (need.get(it.itemId) || 0) + it.qty);
    const mv = { kind: 'distribution', date, familyId, amount: 0, lines: [], items, inkindLines };
    if (batchId) mv.batchId = batchId;
    if (note) mv.note = note;
    movements.push(mv);
    families.push({ familyId, items, inkindLines });
  }
  return { movements, families, totals: stockRows(state, need) };
}

// توزيع إضافي بكمية ثابتة لكل أسرة (مثل لحم الأضاحي). deduct: يُخصم من التزام الصنف (أو ما هو بديل له) الأقدم أولاً.
export function planInkindExtra(state, { familyIds, items, date, deduct = false, fromMonth = null, toMonth = null, batchId, note = '', udhiyaId = null }) {
  const movements = [];
  const need = new Map();
  for (const familyId of familyIds) {
    const inkindLines = [];
    if (deduct && fromMonth && toMonth) {
      for (const it of items) {
        let left = it.qty;
        for (const l of inkindRemaining(state, familyId, fromMonth, toMonth)) {
          if (left <= 0) break;
          const alt = l.itemId === it.itemId ? { qty: l.qty } : (l.alts || []).find((a) => a.itemId === it.itemId);
          if (!alt) continue;
          // المعطى (بوحدة الصنف المعطى) ← ما يغطيه من الالتزام (بوحدة صنف الالتزام)
          const canCover = mulDiv(left, l.qty, alt.qty);
          const cover = Math.min(l.remaining, canCover);
          if (cover <= 0) continue;
          inkindLines.push({ month: l.month, itemId: l.itemId, qty: cover });
          left -= Math.min(left, mulDiv(cover, alt.qty, l.qty));
        }
      }
    }
    const mv = { kind: 'distribution', date, familyId, amount: 0, lines: [], items: items.map((it) => ({ itemId: it.itemId, qty: it.qty })) };
    if (inkindLines.length) mv.inkindLines = inkindLines;
    if (batchId) mv.batchId = batchId;
    if (udhiyaId) mv.udhiyaId = udhiyaId;
    if (note) mv.note = note;
    movements.push(mv);
    for (const it of items) need.set(it.itemId, (need.get(it.itemId) || 0) + it.qty);
  }
  return { movements, totals: stockRows(state, need) };
}

// اقتراح كميات الشراء: ما يكفي الأسر المختارة للشهور والأصناف المختارة (بالبدائل والنسب)، مطروحاً منه المخزون إن طُلب.
export function suggestPurchase(state, { familyIds, fromMonth, toMonth, itemIds = null, choices = {}, date, deductStock = true }) {
  const plan = planInkindBatch(state, { familyIds, fromMonth, toMonth, itemIds, choices, date });
  return plan.totals.map((t) => ({ itemId: t.itemId, need: t.qty, stock: t.stock, buy: deductStock ? t.short : t.qty, families: plan.families.filter((f) => f.items.some((i) => i.itemId === t.itemId)).length })).sort((a, b) => cmp(a.itemId, b.itemId));
}

// خطة صرف نقدي مجمّع: المتبقي من استحقاق كل أسرة حتى شهر toMonth (شاملاً شهوراً قادمة = مقدماً).
// useAmana: إن كان للأسرة أمانة باسمها تُصرف منها أولاً ثم الباقي من الحساب المختار.
export function planCashBatch(state, { familyIds, toMonth, date, acct, useAmana = false, batchId, note = '' }) {
  const payMonth = ymOf(date);
  const led = computeLedger(state);
  const movements = [];
  const families = [];
  const byAcct = new Map();
  let total = 0;
  for (const familyId of familyIds) {
    const first = familyFirstMonth(state, familyId);
    if (!first || first > toMonth) continue;
    const lines = [];
    for (const m of monthsRange(first, toMonth)) {
      const st = familyMonthStatus(state, familyId, m, payMonth);
      if (st.remaining > 0) lines.push({ kind: 'entitlement', month: m, amount: st.remaining });
    }
    if (!lines.length) continue;
    const sum = lines.reduce((a, l) => a + l.amount, 0);
    const amanaAcct = `earmarked#family:${familyId}`;
    let amana = useAmana ? Math.max(0, acctBalance(led, amanaAcct)) : 0;
    const parts = [];
    if (amana > 0 && amanaAcct !== acct) {
      const a = [];
      const b = [];
      for (const l of lines) {
        const fromAmana = Math.min(amana, l.amount);
        if (fromAmana > 0) a.push({ ...l, amount: fromAmana });
        if (l.amount - fromAmana > 0) b.push({ ...l, amount: l.amount - fromAmana });
        amana -= fromAmana;
      }
      if (a.length) parts.push([amanaAcct, a]);
      if (b.length) parts.push([acct, b]);
    } else parts.push([acct, lines]);
    for (const [from, ls] of parts) {
      const amount = ls.reduce((x, l) => x + l.amount, 0);
      const mv = { kind: 'distribution', date, familyId, acct: from, amount, lines: ls };
      if (batchId) mv.batchId = batchId;
      if (note) mv.note = note;
      movements.push(mv);
      byAcct.set(from, (byAcct.get(from) || 0) + amount);
    }
    families.push({ familyId, months: lines.map((l) => l.month), total: sum });
    total += sum;
  }
  const accounts = [...byAcct].map(([a, amount]) => ({ acct: a, amount, balance: acctBalance(led, a), short: Math.max(0, amount - acctBalance(led, a)) }));
  return { movements, families, total, accounts };
}

// تنفيذ خطة مجمّعة على دفتر تجريبي (داخل store.run): كل الحركات أو لا شيء.
export function executeBatch(book, movements, { now = new Date() } = {}) {
  return movements.map((mv) => book.addMovement(mv, { now }));
}
