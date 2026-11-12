// القوائم المالية بالقيد المزدوج — مشتقة من دفتر الحركات (لا تخزين إضافي ولا تغيير في النموذج).
// كل حركة تُترجم إلى قيد متوازن (مدين = دائن) على دليل حسابات صغير، ومنه:
// ميزان المراجعة، قائمة الأنشطة (الإيرادات والمصروفات)، وقائمة المركز المالي بتصنيف صافي الأصول مقيّد/غير مقيّد.
import { acctFund, activeMovements, targetAcct } from './engine.js';
import { assetPosition, computeLedger } from './ledger.js';

export const ACCOUNTS = Object.freeze({
  1100: 'النقدية بالصناديق',
  1200: 'المخزون العيني (بالتكلفة)',
  1300: 'الأصول والاستثمارات (بالتكلفة)',
  3100: 'صافي الأصول أول الفترة',
  4100: 'اشتراكات شهرية',
  4200: 'تبرعات عامة',
  4300: 'تبرعات مقيّدة (مخصصة)',
  4400: 'تبرعات عينية وأصول موهوبة',
  4500: 'عوائد استثمار',
  4600: 'أرباح بيع أصول',
  4900: 'تسويات دائنة',
  5100: 'مساعدات نقدية للأسر',
  5200: 'مساعدات عينية',
  5300: 'مصروفات برامج وأنشطة',
  5400: 'مصروفات إدارية وعمومية',
  5500: 'مصروفات جمع تبرعات',
  5600: 'خسائر بيع أصول',
  5900: 'تسويات مدينة',
});

export const EXPENSE_FUNCTIONS = Object.freeze({ program: 'برامج وأنشطة', admin: 'إدارية وعمومية', fundraising: 'جمع تبرعات' });
const FUNCTION_CODE = { program: 5300, admin: 5400, fundraising: 5500 };

// التصنيف الوظيفي لنوع المصروف (حقل function في القائمة؛ القديم بلا حقل: الإداري الافتراضي فقط إداري).
export function expenseFunction(state, expenseTypeId) {
  const t = state.lists.expenseTypes.get(expenseTypeId);
  if (t && t.function in FUNCTION_CODE) return t.function;
  return expenseTypeId === 'x-admin' ? 'admin' : 'program';
}

// قيد حركة واحدة: [{ code, acct?, dr, cr }]. eff = أثر الحركة من computeLedger (تكلفة الخارج، الربح المحقق…).
export function journalLines(state, mv, eff = {}) {
  const out = [];
  const dr = (code, amount, acct) => amount && out.push(amount > 0 ? { code, acct, dr: amount, cr: 0 } : { code, acct, dr: 0, cr: -amount });
  const cr = (code, amount, acct) => dr(code, -amount, acct);
  switch (mv.kind) {
    case 'receipt':
      for (const l of mv.lines) {
        dr(1100, l.amount, l.kind === 'earmark' ? targetAcct(l.target) : mv.acct || 'general');
        cr(l.kind === 'earmark' ? 4300 : l.kind === 'extra' ? 4200 : 4100, l.amount);
      }
      break;
    case 'inkind_receipt': {
      const v = mv.items.reduce((a, it) => a + (it.value || 0), 0);
      dr(mv.direct ? 5200 : 1200, v);
      cr(4400, v);
      break;
    }
    case 'distribution':
      dr(5100, mv.amount);
      cr(1100, mv.amount, mv.acct);
      dr(5200, eff.costOut || 0);
      cr(1200, eff.costOut || 0);
      break;
    case 'expense':
      dr(FUNCTION_CODE[expenseFunction(state, mv.expenseTypeId)], mv.amount);
      cr(1100, mv.amount, mv.acct);
      break;
    case 'purchase':
      dr(mv.direct ? 5200 : 1200, mv.amount);
      cr(1100, mv.amount, mv.acct);
      break;
    case 'transfer':
      dr(1100, mv.amount, mv.to);
      cr(1100, mv.amount, mv.from);
      break;
    case 'asset_buy':
      dr(1300, mv.amount);
      cr(1100, mv.amount, mv.acct);
      break;
    case 'asset_sell': {
      const cost = eff.costOut || 0;
      const realized = mv.amount - cost;
      dr(1100, mv.amount, mv.acct);
      cr(1300, cost);
      if (realized > 0) cr(4600, realized);
      else dr(5600, -realized);
      break;
    }
    case 'asset_in':
      dr(1300, mv.value || 0);
      cr(4400, mv.value || 0);
      break;
    case 'asset_income':
      dr(1100, mv.amount, mv.acct);
      cr(4500, mv.amount);
      break;
    case 'adjustment':
    case 'opening': {
      const code = mv.target === 'cash' ? 1100 : mv.target === 'item' ? 1200 : 1300;
      const amount = mv.target === 'cash' ? mv.amount : eff.costDelta || 0;
      dr(code, amount, mv.target === 'cash' ? mv.acct : undefined);
      if (mv.kind === 'opening') cr(3100, amount);
      else if (amount > 0) cr(4900, amount);
      else dr(5900, -amount);
      break;
    }
    default:
      break;
  }
  return out;
}

// تصنيف الصندوق لصافي الأصول: غير مقيّد (عام واحتياطي) / مقيّد (كل ما عداهما: حملات، أمانات، وقف، استثمار…).
export const isUnrestrictedFund = (state, fundId) => ['general', 'reserve'].includes(state.lists.funds.get(fundId)?.type);

// القوائم لفترة [from, to] (تواريخ شاملة؛ null = بلا حد).
export function buildStatements(state, { from = null, to = null } = {}) {
  const led = computeLedger(state, to);
  const bal = new Map(); // code -> صافي (مدين − دائن): تراكمي لحسابات الأصول، وللفترة لغيرها
  const add = (code, v) => bal.set(code, (bal.get(code) || 0) + v);
  let priorNet = 0; // صافي ما قبل الفترة من حسابات صافي الأصول والإيرادات والمصروفات (دائن − مدين)
  let debits = 0;
  let credits = 0;
  let unbalanced = 0;
  for (const mv of activeMovements(state)) {
    if (to && mv.date > to) continue;
    const before = !!from && mv.date < from;
    let sum = 0;
    for (const l of journalLines(state, mv, led.effects.get(mv.id))) {
      sum += l.dr - l.cr;
      if (!before) {
        debits += l.dr;
        credits += l.cr;
      }
      if (l.code < 2000) add(l.code, l.dr - l.cr);
      else if (before) priorNet += l.cr - l.dr;
      else add(l.code, l.dr - l.cr);
    }
    if (sum !== 0) unbalanced++;
  }
  add(3100, -priorNet);
  const trial = Object.keys(ACCOUNTS)
    .map(Number)
    .map((code) => ({ code, name: ACCOUNTS[code], debit: Math.max(0, bal.get(code) || 0), credit: Math.max(0, -(bal.get(code) || 0)) }))
    .filter((r) => r.debit || r.credit);
  const row = (code) => ({ code, name: ACCOUNTS[code], amount: Math.abs(bal.get(code) || 0) * (code >= 5000 ? Math.sign(bal.get(code) || 0) || 1 : -Math.sign(bal.get(code) || 0) || 1) });
  const revenues = [4100, 4200, 4300, 4400, 4500, 4600, 4900].filter((c) => bal.get(c)).map(row);
  const expenses = [5100, 5200, 5300, 5400, 5500, 5600, 5900].filter((c) => bal.get(c)).map(row);
  const totalRevenue = revenues.reduce((a, r) => a + r.amount, 0);
  const totalExpense = expenses.reduce((a, r) => a + r.amount, 0);
  const of = (c) => bal.get(c) || 0;
  const program = of(5100) + of(5200) + of(5300);
  const admin = of(5400);
  const fundraising = of(5500);
  const functional = program + admin + fundraising;

  // المركز المالي
  const funds = [];
  let unrestricted = 0;
  let restricted = 0;
  for (const f of state.lists.funds.values()) {
    let cash = 0;
    for (const [acct, v] of led.cash) if (acctFund(acct) === f.id) cash += v;
    if (cash === 0) continue;
    const free = isUnrestrictedFund(state, f.id);
    if (free) unrestricted += cash;
    else restricted += cash;
    funds.push({ fund: f, cash, unrestricted: free });
  }
  let investmentsValue = 0;
  for (const a of state.lists.assets.values()) investmentsValue += assetPosition(state, led, a.id, to || '9999-12-31').value;
  const cash = of(1100);
  const inventory = of(1200);
  const investments = of(1300);
  const netStart = -(bal.get(3100) || 0);
  return {
    from,
    to,
    trial,
    totals: { debit: trial.reduce((a, r) => a + r.debit, 0), credit: trial.reduce((a, r) => a + r.credit, 0), periodDebits: debits, periodCredits: credits, unbalanced },
    activities: {
      revenues,
      expenses,
      totalRevenue,
      totalExpense,
      surplus: totalRevenue - totalExpense,
      functional: { program, admin, fundraising, adminRatio: functional ? admin / functional : 0, programRatio: functional ? program / functional : 0 },
    },
    position: {
      funds,
      cash,
      inventory,
      investments,
      investmentsValue,
      totalAssets: cash + inventory + investments,
      netAssets: { start: netStart, surplus: totalRevenue - totalExpense, end: netStart + totalRevenue - totalExpense, unrestricted, restricted, invested: inventory + investments },
    },
  };
}
