// ترحيل 1 → 2: من أعداد صحيحة بالجنيه/الوحدة إلى أعداد صحيحة بمعاملات عشرية.
//   الإصدار 1: المبالغ بالجنيه الصحيح، الكميات العينية وكميات الأصول بالوحدة الصحيحة.
//   الإصدار 2: المبالغ ×10 (خانة عشرية)، الكميات العينية ×100 (خانتان)، كميات الأصول/الذهب ×1000 (3 خانات).
// السبب: اعتماد الكسور بقرار صاحب الدفتر (انظر docs/ASSUMPTIONS.md و docs/CHANGELOG.md).
// لا تعدّل هذا الملف بعد النشر.
const M = 10;
const Q = 100;
const A = 1000;

const mul = (x, k) => (typeof x === 'number' ? x * k : x);

function movement(mv) {
  const out = { ...mv };
  if ('amount' in out) out.amount = mul(out.amount, M);
  if ('value' in out) out.value = mul(out.value, M);
  if (Array.isArray(out.lines)) {
    out.lines = out.lines.map((l) => {
      const n = { ...l };
      if ('amount' in n) n.amount = mul(n.amount, M);
      if ('cost' in n) n.cost = mul(n.cost, M);
      if ('qty' in n) n.qty = mul(n.qty, Q); // بنود الشراء العيني
      return n;
    });
  }
  if (Array.isArray(out.items)) out.items = out.items.map((it) => ({ ...it, qty: mul(it.qty, Q), ...('value' in it ? { value: mul(it.value, M) } : {}) }));
  if (['asset_buy', 'asset_sell', 'asset_in'].includes(out.kind)) out.qty = mul(out.qty, A);
  if (out.kind === 'adjustment' || out.kind === 'opening') {
    if (out.target === 'item') out.qty = mul(out.qty, Q);
    if (out.target === 'asset') out.qty = mul(out.qty, A);
    if ('cost' in out) out.cost = mul(out.cost, M);
  }
  return out;
}

function checkpoint(c) {
  if (!c) return c;
  const out = { ...c };
  out.cash = Object.fromEntries(Object.entries(c.cash || {}).map(([k, v]) => [k, mul(v, M)]));
  out.assets = Object.fromEntries(Object.entries(c.assets || {}).map(([k, v]) => [k, { qty: mul(v.qty, A), cost: mul(v.cost, M) }]));
  out.items = Object.fromEntries(Object.entries(c.items || {}).map(([k, v]) => [k, { qty: mul(v.qty, Q), cost: mul(v.cost, M) }]));
  out.arrears = (c.arrears || []).map((a) => ({ ...a, remaining: mul(a.remaining, M) }));
  out.familyDues = (c.familyDues || []).map((a) => ({ ...a, remaining: mul(a.remaining, M) }));
  if ('totalCash' in out) out.totalCash = mul(out.totalCash, M);
  delete out.hash; // يُعاد التحقق بالحساب لا بالبصمة القديمة
  return out;
}

function event(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'subscription.set':
      return { ...ev, data: { ...d, amount: mul(d.amount, M) } };
    case 'family.profile.set':
      return { ...ev, data: { ...d, profile: { ...d.profile, monthlyAmount: d.profile?.monthlyAmount == null ? null : mul(d.profile.monthlyAmount, M) } } };
    case 'price.set':
      return { ...ev, data: { ...d, price: mul(d.price, M) } };
    case 'settings.set':
      if (d.key === 'pointValue') return { ...ev, data: { ...d, value: (d.value || []).map((x) => ({ ...x, value: mul(x.value, M) })) } };
      return ev;
    case 'movement.add':
      return { ...ev, data: { ...d, movement: movement(d.movement) } };
    case 'year.close':
      return { ...ev, data: { ...d, checkpoint: checkpoint(d.checkpoint) } };
    default:
      return ev;
  }
}

export const m002 = {
  from: 1,
  to: 2,
  description: 'المبالغ بأعشار الجنيه، الكميات العينية بالمئات، كميات الأصول بالآلاف',
  migrate(doc) {
    return { ...doc, schemaVersion: 2, events: doc.events.map(event) };
  },
};
