// التقارير: كلها دوال خالصة تقرأ من الحالة. المبالغ بأعشار الجنيه.
import { MOVEMENT_KINDS } from '../config/defaults.js';
import { acctFund, acctLabel, activeMovements, profileAt, requiredAt, targetAcct, voucherText } from './engine.js';
import { assetPosition, cashPostings, computeLedger, fundAssets, fundCash, inventoryCost, totalCash } from './ledger.js';
import { allArrears, monthStatus, subscriberIndex } from './subscriptions.js';
import { allFamilyDues, familyIndex, familyMonthStatus } from './families.js';
import { cmp, monthsRange, ymOf } from './util.js';

const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

export function payerName(state, payer) {
  if (!payer) return '';
  if (payer.type === 'subscriber') return state.subscribers.get(payer.id)?.name || 'مشترك';
  return payer.name || 'متبرع';
}

// وصف مختصر لحركة للعرض والبحث.
export function describeMovement(state, mv) {
  const L = state.lists;
  const kind = MOVEMENT_KINDS[mv.kind] || mv.kind;
  let title = kind;
  let party = '';
  let amount = mv.amount ?? 0;
  let sign = 0;
  switch (mv.kind) {
    case 'receipt':
      party = payerName(state, mv.payer);
      title = mv.lines.some((l) => l.kind === 'sub' || l.kind === 'advance') ? 'سداد اشتراك' : 'تبرع';
      sign = 1;
      break;
    case 'inkind_receipt':
      party = payerName(state, mv.payer);
      amount = mv.items.reduce((a, it) => a + (it.value || 0), 0);
      title = 'تبرع عيني: ' + mv.items.map((it) => L.items.get(it.itemId)?.name || '').join('، ');
      break;
    case 'distribution':
      party = mv.familyId ? state.families.get(mv.familyId)?.name || 'أسرة' : mv.beneficiary || 'مستفيد';
      title = mv.amount ? 'صرف لأسرة' : 'توزيع عيني';
      if (mv.items?.length) title += ': ' + mv.items.map((it) => L.items.get(it.itemId)?.name || '').join('، ');
      sign = -1;
      break;
    case 'expense':
      title = 'مصروف: ' + (L.expenseTypes.get(mv.expenseTypeId)?.name || 'عام');
      sign = -1;
      break;
    case 'purchase':
      title = (mv.direct ? 'شراء وتوزيع مباشر: ' : 'شراء للمخزن: ') + mv.lines.map((l) => L.items.get(l.itemId)?.name || '').join('، ');
      sign = -1;
      break;
    case 'transfer':
      title = `تحويل: ${acctLabel(state, mv.from)} ← ${acctLabel(state, mv.to)}`;
      break;
    case 'asset_buy':
      title = 'شراء ' + (L.assets.get(mv.assetId)?.name || 'أصل');
      sign = -1;
      break;
    case 'asset_sell':
      title = 'بيع ' + (L.assets.get(mv.assetId)?.name || 'أصل');
      sign = 1;
      break;
    case 'asset_in':
      title = 'أصل وارد: ' + (L.assets.get(mv.assetId)?.name || '');
      amount = mv.value || 0;
      party = payerName(state, mv.payer);
      break;
    case 'asset_income':
      title = 'عائد: ' + (L.assets.get(mv.assetId)?.name || 'استثمار');
      sign = 1;
      break;
    case 'adjustment':
    case 'opening': {
      const what = mv.target === 'cash' ? acctLabel(state, mv.acct) : mv.target === 'item' ? L.items.get(mv.itemId)?.name : L.assets.get(mv.assetId)?.name;
      title = `${kind}: ${what || ''}`;
      amount = mv.target === 'cash' ? Math.abs(mv.amount) : Math.abs(mv.cost || 0);
      sign = mv.target === 'cash' ? Math.sign(mv.amount) : 0;
      break;
    }
    default:
      break;
  }
  return { title, party, amount, sign, kind };
}

export function searchMovements(state, { text = '', kinds = null, fundId = null, acct = null, from = null, to = null, subscriberId = null, familyId = null, includeVoided = false, limit = 0 } = {}) {
  const q = text.trim().toLowerCase();
  const out = [];
  const list = state.movements;
  for (let i = list.length - 1; i >= 0; i--) {
    const mv = list[i];
    if (mv.voided && !includeVoided) continue;
    if (kinds && !kinds.includes(mv.kind)) continue;
    if (!inRange(mv.date, from, to)) continue;
    if (subscriberId && !(mv.payer?.type === 'subscriber' && mv.payer.id === subscriberId)) continue;
    if (familyId && mv.familyId !== familyId) continue;
    if (fundId || acct) {
      const accts = cashPostings(mv).map((p) => p[0]);
      if (acct && !accts.includes(acct)) continue;
      if (fundId && !accts.some((a) => acctFund(a) === fundId)) continue;
    }
    if (q) {
      const d = describeMovement(state, mv);
      const hay = `${d.title} ${d.party} ${mv.note || ''} ${mv.reason || ''} ${mv.date} ${(d.amount / 10).toString()} ${voucherText(mv)}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(mv);
  }
  out.sort((a, b) => cmp(b.date, a.date) || b.seq - a.seq);
  return limit ? out.slice(0, limit) : out;
}

// كشف حساب صندوق (أو حساب فرعي): رصيد أول الفترة ثم الحركات برصيد متحرك.
export function acctStatement(state, { fundId = null, acct = null, from = null, to = null }) {
  const match = (a) => (acct ? a === acct : acctFund(a) === fundId);
  let opening = 0;
  let balance = 0;
  const rows = [];
  for (const mv of activeMovements(state)) {
    let delta = 0;
    let hit = false;
    for (const [a, d] of cashPostings(mv)) {
      if (match(a)) {
        delta += d;
        hit = true;
      }
    }
    if (!hit) continue;
    if (from && mv.date < from) {
      opening += delta;
      balance += delta;
      continue;
    }
    if (to && mv.date > to) continue;
    balance += delta;
    rows.push({ mv, delta, balance });
  }
  return { opening, rows, closing: balance };
}

// تقرير بالشهر (حسب تاريخ الحركة): وارد ومنصرف مفصّل، مع أرقام الاشتراكات المنسوبة للشهر.
export function reportByMonth(state, { from, to, nowMonth }) {
  const months = new Map();
  const row = (m) => {
    if (!months.has(m)) months.set(m, { month: m, receipts: 0, otherIn: 0, distributions: 0, expenses: 0, purchases: 0, assetBuys: 0, inflow: 0, outflow: 0, net: 0, required: 0, paidForMonth: 0, extraForMonth: 0, remaining: 0 });
    return months.get(m);
  };
  for (const m of monthsRange(ymOf(from), ymOf(to))) row(m);
  for (const mv of activeMovements(state)) {
    if (!inRange(mv.date, from, to)) continue;
    const r = row(ymOf(mv.date));
    if (mv.kind === 'transfer') continue;
    for (const [, d] of cashPostings(mv)) {
      if (d > 0) r.inflow += d;
      else r.outflow -= d;
    }
    if (mv.kind === 'receipt') r.receipts += mv.amount;
    else if (mv.kind === 'asset_sell' || mv.kind === 'asset_income') r.otherIn += mv.amount;
    else if (mv.kind === 'distribution') r.distributions += mv.amount;
    else if (mv.kind === 'expense') r.expenses += mv.amount;
    else if (mv.kind === 'purchase') r.purchases += mv.amount;
    else if (mv.kind === 'asset_buy') r.assetBuys += mv.amount;
  }
  // أرقام الاشتراك المنسوبة للشهر (لا لتاريخ الدفع)
  const attributed = attributedByMonth(state);
  for (const r of months.values()) {
    r.net = r.inflow - r.outflow;
    for (const s of state.subscribers.values()) {
      const st = monthStatus(state, s.id, r.month, nowMonth || r.month);
      r.required += st.required;
      r.remaining += st.remaining;
    }
    const a = attributed.get(r.month);
    r.paidForMonth = a?.sub || 0;
    r.extraForMonth = a?.extra || 0;
  }
  return [...months.values()].sort((a, b) => cmp(a.month, b.month));
}

// مجموع بنود الدفعات المنسوبة لكل شهر (اشتراك/مقدم، وزيادة/مخصص إن كان لها شهر).
export function attributedByMonth(state) {
  const out = new Map();
  for (const mv of activeMovements(state)) {
    if (mv.kind !== 'receipt') continue;
    for (const l of mv.lines) {
      if (!l.month) continue;
      if (!out.has(l.month)) out.set(l.month, { sub: 0, extra: 0, total: 0 });
      const e = out.get(l.month);
      if (l.kind === 'sub' || l.kind === 'advance') e.sub += l.amount;
      else e.extra += l.amount;
      e.total += l.amount;
    }
  }
  return out;
}

// تقرير بالشخص: لكل مشترك المطلوب/المسدد/المتبقي لشهور الفترة + إجمالي ما دفعه نقداً في الفترة.
export function reportBySubscriber(state, { fromMonth, toMonth, nowMonth }) {
  const idx = subscriberIndex(state);
  const out = [];
  for (const s of state.subscribers.values()) {
    const r = { subscriber: s, required: 0, paid: 0, remaining: 0, writeoff: 0, cash: 0, extra: 0, paidMonths: 0, dueMonths: 0 };
    for (const m of monthsRange(fromMonth, toMonth)) {
      const st = monthStatus(state, s.id, m, nowMonth);
      r.required += st.required;
      r.paid += Math.min(st.paid, Math.max(st.required, st.paid));
      r.remaining += st.remaining;
      r.writeoff += st.writeoffAmount;
      if (st.required > 0 && st.remaining === 0 && st.status !== 'writeoff') r.paidMonths++;
      if (st.remaining > 0 && m <= nowMonth) r.dueMonths++;
    }
    for (const mv of idx.get(s.id)?.receipts || []) {
      if (ymOf(mv.date) < fromMonth || ymOf(mv.date) > toMonth) continue;
      r.cash += mv.amount;
      for (const l of mv.lines) if (l.kind === 'extra' || l.kind === 'earmark') r.extra += l.amount;
    }
    out.push(r);
  }
  return out;
}

// تقرير بالغرض/الفئة: الوارد حسب غرض البند، والمنصرف حسب غرض الصرف ونوع المصروف.
export function reportByPurpose(state, { from, to }) {
  const receipts = new Map();
  const distributions = new Map();
  const expenses = new Map();
  const bump = (map, key, v) => map.set(key, (map.get(key) || 0) + v);
  for (const mv of activeMovements(state)) {
    if (!inRange(mv.date, from, to)) continue;
    if (mv.kind === 'receipt') for (const l of mv.lines) bump(receipts, l.purposeId || (l.kind === 'sub' || l.kind === 'advance' ? 'p-subscription' : 'p-general'), l.amount);
    else if (mv.kind === 'distribution') {
      for (const l of mv.lines || []) bump(distributions, l.purposeId || (l.kind === 'entitlement' ? '_entitlement' : '_none'), l.amount);
    } else if (mv.kind === 'expense') bump(expenses, mv.expenseTypeId || '_none', mv.amount);
    else if (mv.kind === 'purchase') bump(expenses, '_purchase', mv.amount);
  }
  const name = (id) =>
    id === '_entitlement' ? 'استحقاق شهري' : id === '_none' ? 'غير محدد' : id === '_purchase' ? 'مشتريات عينية' : state.lists.purposes.get(id)?.name || state.lists.expenseTypes.get(id)?.name || id;
  const list = (map) => [...map].map(([id, amount]) => ({ id, name: name(id), amount })).sort((a, b) => b.amount - a.amount);
  return { receipts: list(receipts), distributions: list(distributions), expenses: list(expenses) };
}

// تقرير بفئة الأسر (مثل الأيتام): ما خُصص للفئة وما صُرف لأسرها ورصيد الأمانة.
export function reportByCategory(state, { from, to }) {
  const led = computeLedger(state);
  const out = [];
  for (const c of state.lists.familyCategories.values()) {
    const r = { category: c, earmarkedIn: 0, distributed: 0, families: 0, balance: led.cash.get(`earmarked#category:${c.id}`) || 0 };
    for (const f of state.families.values()) {
      const p = f.profiles[f.profiles.length - 1];
      if (p && (p.categories || []).includes(c.id)) r.families++;
    }
    for (const mv of activeMovements(state)) {
      if (!inRange(mv.date, from, to)) continue;
      if (mv.kind === 'receipt') {
        for (const l of mv.lines) if (l.kind === 'earmark' && l.target.type === 'category' && l.target.id === c.id) r.earmarkedIn += l.amount;
      } else if (mv.kind === 'distribution' && mv.familyId) {
        const p = profileAt(state, mv.familyId, ymOf(mv.date)) || state.families.get(mv.familyId)?.profiles[0];
        if (p && (p.categories || []).includes(c.id)) r.distributed += mv.amount;
      }
    }
    out.push(r);
  }
  return out;
}

// تقرير بالحملة: وارد / منصرف / رصيد.
export function reportByCampaign(state, { from = null, to = null } = {}) {
  const out = [];
  for (const c of state.lists.campaigns.values()) {
    const acct = targetAcct({ type: 'campaign', id: c.id });
    const r = { campaign: c, inflow: 0, outflow: 0, balance: 0 };
    for (const mv of activeMovements(state)) {
      for (const [a, d] of cashPostings(mv)) {
        if (a !== acct) continue;
        r.balance += d;
        if (!inRange(mv.date, from, to)) continue;
        if (d > 0) r.inflow += d;
        else r.outflow -= d;
      }
    }
    out.push(r);
  }
  return out;
}

// تقرير بالصندوق: رصيد أول الفترة، وارد، منصرف، تحويلات، رصيد آخر الفترة + الأصول.
export function reportByFund(state, { from = null, to = null } = {}) {
  const rows = new Map();
  for (const f of state.lists.funds.values()) rows.set(f.id, { fund: f, opening: 0, inflow: 0, outflow: 0, transferIn: 0, transferOut: 0, closing: 0 });
  for (const mv of activeMovements(state)) {
    if (to && mv.date > to) continue;
    for (const [a, d] of cashPostings(mv)) {
      const r = rows.get(acctFund(a));
      if (!r) continue;
      r.closing += d;
      if (from && mv.date < from) {
        r.opening += d;
        continue;
      }
      if (mv.kind === 'transfer') {
        if (d > 0) r.transferIn += d;
        else r.transferOut -= d;
      } else if (d > 0) r.inflow += d;
      else r.outflow -= d;
    }
  }
  const led = computeLedger(state, to);
  for (const r of rows.values()) Object.assign(r, { assets: fundAssets(state, led, r.fund.id, to || '9999-12-31') });
  return [...rows.values()];
}

// تقرير بالأسرة.
export function reportByFamily(state, { from = null, to = null, fromMonth, toMonth, nowMonth }) {
  const idx = familyIndex(state);
  const led = computeLedger(state);
  const out = [];
  for (const f of state.families.values()) {
    const r = { family: f, cash: 0, itemsCost: 0, count: 0, entitled: 0, received: 0, remaining: 0, deliveredMonths: 0, dueMonths: 0 };
    for (const mv of idx.get(f.id)?.distributions || []) {
      if (!inRange(mv.date, from, to)) continue;
      r.cash += mv.amount;
      r.itemsCost += led.effects.get(mv.id)?.costOut || 0;
      r.count++;
    }
    for (const m of monthsRange(fromMonth, toMonth)) {
      const st = familyMonthStatus(state, f.id, m, nowMonth);
      r.entitled += st.entitled;
      r.received += st.received;
      r.remaining += m <= nowMonth ? st.remaining : 0;
      if (st.status === 'delivered' || st.status === 'advance') r.deliveredMonths++;
      if (st.remaining > 0 && m <= nowMonth) r.dueMonths++;
    }
    out.push(r);
  }
  return out;
}

// أرقام اللوحة الرئيسية.
export function dashboard(state, today) {
  const led = computeLedger(state);
  const month = ymOf(today);
  const arrears = allArrears(state, month);
  const famDues = allFamilyDues(state, month);
  let assetsCost = 0;
  let assetsValue = 0;
  for (const a of state.lists.assets.values()) {
    const p = assetPosition(state, led, a.id, today);
    assetsCost += p.cost;
    assetsValue += p.value;
  }
  let monthIn = 0;
  let monthOut = 0;
  for (const mv of activeMovements(state)) {
    if (ymOf(mv.date) !== month || mv.kind === 'transfer') continue;
    for (const [, d] of cashPostings(mv)) {
      if (d > 0) monthIn += d;
      else monthOut -= d;
    }
  }
  return {
    totalCash: totalCash(led),
    general: fundCash(led, 'general'),
    assetsCost,
    assetsValue,
    inventoryCost: inventoryCost(led),
    arrearsTotal: arrears.reduce((a, x) => a + x.total, 0),
    arrearsCount: arrears.length,
    familyDuesTotal: famDues.reduce((a, x) => a + x.total, 0),
    familyDuesCount: famDues.length,
    monthIn,
    monthOut,
    problems: led.problems.length,
  };
}

// مجاميع عامة لفترة (للمطابقة والتقارير).
export function totals(state, { from = null, to = null } = {}) {
  const t = { receipts: 0, distributions: 0, expenses: 0, purchases: 0, assetBuys: 0, assetSells: 0, assetIncome: 0, inflow: 0, outflow: 0 };
  for (const mv of activeMovements(state)) {
    if (!inRange(mv.date, from, to)) continue;
    if (mv.kind === 'receipt') t.receipts += mv.amount;
    else if (mv.kind === 'distribution') t.distributions += mv.amount;
    else if (mv.kind === 'expense') t.expenses += mv.amount;
    else if (mv.kind === 'purchase') t.purchases += mv.amount;
    else if (mv.kind === 'asset_buy') t.assetBuys += mv.amount;
    else if (mv.kind === 'asset_sell') t.assetSells += mv.amount;
    else if (mv.kind === 'asset_income') t.assetIncome += mv.amount;
    if (mv.kind !== 'transfer') {
      for (const [, d] of cashPostings(mv)) {
        if (d > 0) t.inflow += d;
        else t.outflow -= d;
      }
    }
  }
  return t;
}

export { requiredAt };
