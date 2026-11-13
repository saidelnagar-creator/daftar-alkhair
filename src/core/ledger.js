// الأرصدة: كلها محسوبة من الحركات غير الملغاة (لا شيء مخزَّن).
// نقد الصناديق + المخزن العيني (متوسط تكلفة) + الأصول (متوسط تكلفة، ربح/خسارة محققة وغير محققة).
import { activeMovements, cached, targetAcct, acctFund, priceAt, stepsAt } from './engine.js';
import { costOfQty, mulDiv, roundToStep, ASSET } from './money.js';

// قيود النقد لحركة واحدة: [[حساب, فرق], ...] — مجموعها صفر للتحويل، موجب للوارد، سالب للمنصرف.
export function cashPostings(mv) {
  switch (mv.kind) {
    case 'receipt': {
      const by = new Map();
      for (const l of mv.lines) {
        const acct = l.kind === 'earmark' ? targetAcct(l.target) : mv.acct || 'general';
        by.set(acct, (by.get(acct) || 0) + l.amount);
      }
      return [...by];
    }
    case 'distribution':
      return mv.amount ? [[mv.acct, -mv.amount]] : [];
    case 'expense':
    case 'purchase':
    case 'asset_buy':
      return mv.amount ? [[mv.acct, -mv.amount]] : [];
    case 'asset_sell':
    case 'asset_income':
      return mv.amount ? [[mv.acct, mv.amount]] : [];
    case 'transfer':
      return [
        [mv.from, -mv.amount],
        [mv.to, mv.amount],
      ];
    case 'adjustment':
    case 'opening':
      return mv.target === 'cash' && mv.amount ? [[mv.acct, mv.amount]] : [];
    default:
      return [];
  }
}

const newItem = () => ({
  qty: 0,
  cost: 0,
  purchasedQty: 0,
  purchasedCost: 0,
  donatedQty: 0,
  donatedValue: 0,
  directQty: 0,
  directCost: 0,
  distributedQty: 0,
  distributedCost: 0,
  adjustedQty: 0,
  adjustedCost: 0,
});
const newAsset = () => ({ qty: 0, cost: 0, boughtQty: 0, bought: 0, inQty: 0, inValue: 0, soldQty: 0, sold: 0, soldCost: 0, realized: 0, income: 0 });

function get(map, id, make) {
  if (!map.has(id)) map.set(id, make());
  return map.get(id);
}

// asOf: تاريخ شامل (YYYY-MM-DD) أو null للكل. extra: حركات افتراضية إضافية (للتحقق قبل الحفظ). skip: معرف حركة تُستبعد.
export function computeLedger(state, asOf = null, { extra = null, skip = null } = {}) {
  const run = () => {
    const cash = new Map();
    const items = new Map();
    const assets = new Map();
    const effects = new Map();
    const problems = [];
    let inflow = 0;
    let outflow = 0;
    let list = activeMovements(state);
    if (extra || skip) {
      list = list.filter((m) => m.id !== skip);
      if (extra) list = [...list, ...extra].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq ?? 1e15) - (b.seq ?? 1e15)));
    }
    for (const mv of list) {
      if (asOf && mv.date > asOf) continue;
      const eff = { cash: cashPostings(mv) };
      const step = stepsAt(state, mv.date).money; // تكاليف مشتقة تُقرَّب حسب الخانات السارية في تاريخ الحركة
      for (const [acct, delta] of eff.cash) cash.set(acct, (cash.get(acct) || 0) + delta);
      if (mv.kind !== 'transfer') {
        for (const [, delta] of eff.cash) {
          if (delta > 0) inflow += delta;
          else outflow -= delta;
        }
      }
      switch (mv.kind) {
        case 'inkind_receipt':
          for (const it of mv.items) {
            const s = get(items, it.itemId, newItem);
            s.donatedQty += it.qty;
            s.donatedValue += it.value || 0;
            if (mv.direct) {
              s.directQty += it.qty;
              s.directCost += it.value || 0;
            } else {
              s.qty += it.qty;
              s.cost += it.value || 0;
            }
          }
          break;
        case 'purchase':
          for (const l of mv.lines) {
            const s = get(items, l.itemId, newItem);
            s.purchasedQty += l.qty;
            s.purchasedCost += l.cost;
            if (mv.direct) {
              s.directQty += l.qty;
              s.directCost += l.cost;
            } else {
              s.qty += l.qty;
              s.cost += l.cost;
            }
          }
          break;
        case 'distribution': {
          let costOut = 0;
          for (const it of mv.items || []) {
            const s = get(items, it.itemId, newItem);
            if (it.qty > s.qty) problems.push({ mvId: mv.id, kind: 'item', id: it.itemId, date: mv.date });
            const c = costOfQty(s.cost, s.qty, it.qty, step);
            s.qty -= it.qty;
            s.cost -= c;
            s.distributedQty += it.qty;
            s.distributedCost += c;
            costOut += c;
          }
          if (costOut) eff.costOut = costOut;
          break;
        }
        case 'asset_buy': {
          const a = get(assets, mv.assetId, newAsset);
          a.qty += mv.qty;
          a.cost += mv.amount;
          a.boughtQty += mv.qty;
          a.bought += mv.amount;
          break;
        }
        case 'asset_in': {
          const a = get(assets, mv.assetId, newAsset);
          a.qty += mv.qty;
          a.cost += mv.value || 0;
          a.inQty += mv.qty;
          a.inValue += mv.value || 0;
          break;
        }
        case 'asset_sell': {
          const a = get(assets, mv.assetId, newAsset);
          if (mv.qty > a.qty) problems.push({ mvId: mv.id, kind: 'asset', id: mv.assetId, date: mv.date });
          const c = costOfQty(a.cost, a.qty, mv.qty, step);
          a.qty -= mv.qty;
          a.cost -= c;
          a.soldQty += mv.qty;
          a.sold += mv.amount;
          a.soldCost += c;
          a.realized += mv.amount - c;
          eff.costOut = c;
          eff.realized = mv.amount - c;
          break;
        }
        case 'asset_income':
          if (mv.assetId) get(assets, mv.assetId, newAsset).income += mv.amount;
          break;
        case 'adjustment':
        case 'opening':
          if (mv.target === 'item') {
            const s = get(items, mv.itemId, newItem);
            let c = mv.cost || 0;
            if (mv.qty < 0 && mv.cost === undefined) c = -costOfQty(s.cost, s.qty, -mv.qty, step);
            if (s.qty + mv.qty < 0) problems.push({ mvId: mv.id, kind: 'item', id: mv.itemId, date: mv.date });
            s.qty += mv.qty;
            s.cost += c;
            s.adjustedQty += mv.qty;
            s.adjustedCost += c;
            eff.costDelta = c;
          } else if (mv.target === 'asset') {
            const a = get(assets, mv.assetId, newAsset);
            let c = mv.cost || 0;
            if (mv.qty < 0 && mv.cost === undefined) c = -costOfQty(a.cost, a.qty, -mv.qty, step);
            if (a.qty + mv.qty < 0) problems.push({ mvId: mv.id, kind: 'asset', id: mv.assetId, date: mv.date });
            a.qty += mv.qty;
            a.cost += c;
            a.inQty += mv.qty;
            a.inValue += c;
            eff.costDelta = c;
          }
          break;
        default:
          break;
      }
      effects.set(mv.id, eff);
    }
    return { cash, items, assets, effects, problems, inflow, outflow };
  };
  if (extra || skip) return run();
  return cached(state, 'ledger:' + (asOf || ''), run);
}

export function fundCash(ledger, fundId) {
  let s = 0;
  for (const [acct, v] of ledger.cash) if (acctFund(acct) === fundId) s += v;
  return s;
}

export function acctBalance(ledger, acct) {
  return ledger.cash.get(acct) || 0;
}

export function totalCash(ledger) {
  let s = 0;
  for (const v of ledger.cash.values()) s += v;
  return s;
}

// الحسابات الفرعية (حملات وأمانات) غير الصفرية لصندوق.
export function subAccounts(ledger, fundId) {
  const out = [];
  for (const [acct, v] of ledger.cash) if (acctFund(acct) === fundId && acct.includes('#')) out.push({ acct, balance: v });
  return out;
}

// تقييم أصل: المدفوع (التكلفة)، القيمة الحالية (آخر سعر مُدخل حتى التاريخ)، الربح/الخسارة.
export function assetPosition(state, ledger, assetId, date = '9999-12-31') {
  const a = ledger.assets.get(assetId) || newAsset();
  const p = priceAt(state, assetId, date);
  const value = p ? roundToStep(mulDiv(a.qty, p.price, ASSET), stepsAt(state, date).money) : a.cost;
  return {
    assetId,
    qty: a.qty,
    cost: a.cost,
    price: p ? p.price : null,
    priceDate: p ? p.date : null,
    value,
    unrealized: value - a.cost,
    realized: a.realized,
    income: a.income,
    raw: a,
  };
}

export function itemPosition(ledger, itemId) {
  return ledger.items.get(itemId) || newItem();
}

// إجمالي قيمة أصول صندوق (بالتكلفة وبالقيمة الحالية).
export function fundAssets(state, ledger, fundId, date) {
  let cost = 0;
  let value = 0;
  for (const asset of state.lists.assets.values()) {
    if (asset.fundId !== fundId) continue;
    const pos = assetPosition(state, ledger, asset.id, date);
    cost += pos.cost;
    value += pos.value;
  }
  return { cost, value };
}

export function inventoryCost(ledger) {
  let s = 0;
  for (const it of ledger.items.values()) s += it.cost;
  return s;
}

// رصيد مجمَّع (للعرض فقط): مجموع نقد الصناديق المختارة. لا يغيّر حساب أي صندوق — كل صندوق يبقى بحساباته وأصوله.
export function rollupBalance(state, ledger, rollup) {
  const parts = (rollup.funds || []).filter((id) => state.lists.funds.has(id)).map((id) => ({ fund: state.lists.funds.get(id), cash: fundCash(ledger, id) }));
  return { rollup, parts, total: parts.reduce((a, p) => a + p.cash, 0) };
}

export function rollups(state, ledger) {
  return (state.settings.rollups || []).map((r) => rollupBalance(state, ledger, r));
}

// المجاميع التي يدخل فيها صندوق.
export const rollupsOfFund = (state, fundId) => (state.settings.rollups || []).filter((r) => (r.funds || []).includes(fundId));

// نظرة على نوع أصل عبر كل الصناديق (مثلاً الذهب): إجمالي للمعرفة فقط، وتفصيل كل صندوق على حدة دون دمج الحسابات.
// الكميات تُجمع لكل وحدة قياس على حدة (جرام مع جرام).
export function assetsByKind(state, ledger, date = '9999-12-31') {
  const kinds = new Map();
  for (const a of state.lists.assets.values()) {
    const p = assetPosition(state, ledger, a.id, date);
    if (a.archived && p.qty === 0 && p.cost === 0) continue;
    if (!kinds.has(a.kind)) kinds.set(a.kind, { kind: a.kind, cost: 0, value: 0, units: new Map(), funds: new Map() });
    const k = kinds.get(a.kind);
    k.cost += p.cost;
    k.value += p.value;
    k.units.set(a.unit, (k.units.get(a.unit) || 0) + p.qty);
    if (!k.funds.has(a.fundId)) k.funds.set(a.fundId, { fundId: a.fundId, cost: 0, value: 0, units: new Map(), assets: [] });
    const f = k.funds.get(a.fundId);
    f.cost += p.cost;
    f.value += p.value;
    f.units.set(a.unit, (f.units.get(a.unit) || 0) + p.qty);
    f.assets.push({ asset: a, pos: p });
  }
  const units = (m) => [...m].map(([unit, qty]) => ({ unit, qty }));
  return [...kinds.values()].map((k) => ({ ...k, units: units(k.units), funds: [...k.funds.values()].map((f) => ({ ...f, units: units(f.units) })) }));
}

// كل ما يتبع صندوقاً: نقده، حساباته الفرعية، أصوله (كل أصل بتقييمه)، والإجمالي.
export function fundHoldings(state, ledger, fundId, date = '9999-12-31') {
  const cash = fundCash(ledger, fundId);
  const assets = [...state.lists.assets.values()].filter((a) => a.fundId === fundId).map((asset) => ({ asset, pos: assetPosition(state, ledger, asset.id, date) })).filter((x) => !x.asset.archived || x.pos.qty !== 0 || x.pos.cost !== 0);
  const assetsCost = assets.reduce((a, x) => a + x.pos.cost, 0);
  const assetsValue = assets.reduce((a, x) => a + x.pos.value, 0);
  return { fundId, cash, subs: subAccounts(ledger, fundId).filter((a) => a.balance !== 0), assets, assetsCost, assetsValue, total: cash + assetsValue };
}
