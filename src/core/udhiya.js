// صندوق الأضحية — يُدار كجزء منفصل: اشتراكات بنِسب مختلفة في ذبائح بأوزان وأسعار وتكاليف مختلفة.
// أموال المشتركين ليست من مال المشروع فلا تدخل دفتر الحركات. يدخل حسابات المشروع فقط نصيب الفقراء:
// يُرحَّل كتبرع عيني (inkind_receipt فيه udhiyaId) بكميته وقيمته، ثم يُوزَّع بحركات صرف عادية تُظهر لمن ذهب.
import { activeMovements } from './engine.js';
import { QTY, mulDiv, roundToStep, splitByWeights } from './money.js';

// ملخص ذبيحة: التكلفة الكلية، نصيب كل مشترك (تكلفة / مدفوع / باقٍ)، تكلفة الكيلو، وقيمة نصيب الفقراء.
export function udhiyaSummary(state, u, { step = 1 } = {}) {
  const extra = (u.costs || []).reduce((a, c) => a + (c.amount || 0), 0);
  const total = (u.price || 0) + extra;
  const shares = u.shares || [];
  const sold = shares.reduce((a, s) => a + s.parts, 0);
  const totalParts = u.totalParts || sold;
  const unsold = Math.max(0, totalParts - sold);
  const weights = [...shares.map((s) => s.parts), unsold];
  const split = totalParts > 0 && total > 0 ? splitByWeights(total, weights, step) : weights.map(() => 0);
  const meat = u.meatWeight || 0;
  const poorQty = u.poorQty || 0;
  const perPartMeat = totalParts > 0 ? Math.floor((meat - poorQty) / totalParts) : 0;
  const rows = shares.map((s, i) => ({ ...s, cost: split[i], paid: s.paid || 0, balance: (s.paid || 0) - split[i], pct: totalParts ? Math.round((1000 * s.parts) / totalParts) / 10 : 0, meat: perPartMeat * s.parts }));
  const paid = rows.reduce((a, r) => a + r.paid, 0);
  const posted = [];
  const given = [];
  for (const mv of activeMovements(state)) {
    if (mv.udhiyaId !== u.id) continue;
    if (mv.kind === 'inkind_receipt') posted.push(mv);
    else if (mv.kind === 'distribution') given.push(mv);
  }
  const qtyOf = (mv) => (mv.items || []).reduce((a, it) => a + it.qty, 0);
  return {
    total,
    extra,
    totalParts,
    sold,
    unsold,
    unsoldCost: split[split.length - 1] || 0,
    shares: rows,
    paid,
    outstanding: rows.reduce((a, r) => a + Math.max(0, -r.balance), 0),
    overpaid: rows.reduce((a, r) => a + Math.max(0, r.balance), 0),
    costPerKg: meat > 0 ? roundToStep(mulDiv(total, QTY, meat), step) : null,
    yieldPct: u.liveWeight ? Math.round((1000 * meat) / u.liveWeight) / 10 : null,
    poorQty,
    poorValue: meat > 0 ? roundToStep(mulDiv(total, poorQty, meat), step) : 0,
    perPartMeat,
    posted,
    postedQty: posted.reduce((a, mv) => a + qtyOf(mv), 0),
    given,
    givenQty: given.reduce((a, mv) => a + qtyOf(mv), 0),
  };
}

// حركة ترحيل نصيب الفقراء إلى حسابات المشروع (تبرع عيني يدخل المخزن بقيمته).
export function udhiyaPostMovement(state, u, { date, step = 1, qty = null }) {
  const sum = udhiyaSummary(state, u, { step });
  const left = Math.max(0, sum.poorQty - sum.postedQty);
  const q = qty === null ? left : qty;
  const meat = u.meatWeight || 0;
  return { kind: 'inkind_receipt', date, payer: { type: 'other', name: `أضحية: ${u.name}` }, items: [{ itemId: u.itemId, qty: q, value: meat > 0 ? roundToStep(mulDiv(sum.total, q, meat), step) : 0 }], udhiyaId: u.id, note: 'نصيب الفقراء من الأضحية' };
}

export function udhiyaSeasons(state) {
  const by = new Map();
  for (const u of state.udhiya.values()) {
    const y = u.season || Number(u.date.slice(0, 4));
    if (!by.has(y)) by.set(y, []);
    by.get(y).push(u);
  }
  return [...by].sort((a, b) => b[0] - a[0]).map(([season, list]) => ({ season, list: list.sort((a, b) => (a.date < b.date ? -1 : 1)) }));
}
