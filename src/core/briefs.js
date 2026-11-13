// مؤشرات القرار والتقارير الجاهزة للمشاركة (مجلس الإدارة، المشتركون، المتبرعون، المقيّم) وتقرير الحركات المخصص.
// دوال خالصة تعيد بنية موحّدة تُعرض على الشاشة أو تُطبع أو تُرسل نصاً أو تُصدَّر Excel:
//   { title, subtitle, sections: [{ heading, rows: [[label, value, type]], table: { cols: [{label,type}], rows }, bars: [{label,value}], notes: [] }] }
// الأنواع: text | money | int | pct | qty. التقارير الموجهة للخارج لا تحمل أسماء أسر ولا تفاصيل تقييم.
import { MOVEMENT_KINDS, ASSET_KINDS } from '../config/defaults.js';
import { acctFund, acctLabel, activeMovements, closedThrough, profileAt, voucherText } from './engine.js';
import { assetPosition, assetsByKind, cashPostings, computeLedger, fundCash, fundHoldings, inventoryCost, itemPosition, rollups, totalCash } from './ledger.js';
import { allArrears, monthStatus } from './subscriptions.js';
import { allFamilyDues, entitlementAt, familyIndex } from './families.js';
import { inkindTotals, hasInkindPlan } from './inkind.js';
import { currentAssessment, dueReviews } from './need.js';
import { describeMovement, reportByMonth, reportByCampaign } from './reports.js';
import { buildStatements, isUnrestrictedFund } from './statements.js';
import { addMonths, cmp, monthLabel, monthsRange, ymOf } from './util.js';

const T = (label, type = 'text') => ({ label, type });
const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

// ---------- تقرير الحركات المخصص: آخر عدد، أو فترة، أو أنواع محددة ----------
export function movementsReport(state, { lastN = 0, from = null, to = null, kinds = null, fundId = null, includeVoided = false } = {}) {
  let list = state.movements.filter((mv) => (includeVoided || !mv.voided) && inRange(mv.date, from, to) && (!kinds || !kinds.length || kinds.includes(mv.kind)));
  if (fundId) list = list.filter((mv) => cashPostings(mv).some(([a]) => acctFund(a) === fundId));
  list.sort((a, b) => cmp(a.date, b.date) || a.seq - b.seq);
  if (lastN > 0) list = list.slice(-lastN);
  const cols = [T('التاريخ'), T('السند'), T('النوع'), T('البيان'), T('الطرف'), T('وارد', 'money'), T('منصرف', 'money'), T('الحساب'), T('ملاحظة')];
  let inflow = 0;
  let outflow = 0;
  const byKind = new Map();
  const rows = list.map((mv) => {
    const d = describeMovement(state, mv);
    let i = 0;
    let o = 0;
    if (mv.kind !== 'transfer') {
      for (const [, delta] of cashPostings(mv)) {
        if (delta > 0) i += delta;
        else o -= delta;
      }
    }
    if (!mv.voided) {
      inflow += i;
      outflow += o;
      const k = byKind.get(mv.kind) || { kind: mv.kind, count: 0, inflow: 0, outflow: 0 };
      k.count++;
      k.inflow += i;
      k.outflow += o;
      byKind.set(mv.kind, k);
    }
    const accts = [...new Set(cashPostings(mv).map(([a]) => acctLabel(state, a)))].join(' ← ');
    return [mv.date, voucherText(mv), d.kind + (mv.voided ? ' (ملغاة)' : ''), d.title, d.party, i || null, o || null, accts, mv.note || mv.reason || ''];
  });
  return { cols, rows, count: rows.length, inflow, outflow, net: inflow - outflow, byKind: [...byKind.values()].map((k) => ({ ...k, label: MOVEMENT_KINDS[k.kind] || k.kind })), first: list[0]?.date || null, last: list[list.length - 1]?.date || null };
}

// ---------- مؤشرات القرار ----------
export function insights(state, today) {
  const month = ymOf(today);
  const led = computeLedger(state);
  const cash = totalCash(led);
  let unrestricted = 0;
  for (const f of state.lists.funds.values()) if (isUnrestrictedFund(state, f.id)) unrestricted += fundCash(led, f.id);
  // متوسط آخر 3 شهور مكتملة
  const m3 = addMonths(month, -3);
  const hist = reportByMonth(state, { from: `${m3}-01`, to: `${addMonths(month, -1)}-31`, nowMonth: month });
  const avgOut = Math.round(hist.reduce((a, r) => a + r.outflow, 0) / 3);
  const avgIn = Math.round(hist.reduce((a, r) => a + r.inflow, 0) / 3);
  const runway = avgOut > 0 ? Math.round((10 * unrestricted) / avgOut) / 10 : null;
  // التحصيل: مطلوب/مسدد شهور السنة حتى الآن
  const y0 = `${month.slice(0, 4)}-01`;
  let required = 0;
  let remaining = 0;
  for (const s of state.subscribers.values()) {
    for (const m of monthsRange(y0, month)) {
      const st = monthStatus(state, s.id, m, month);
      required += st.required;
      remaining += st.remaining + st.writeoffAmount;
    }
  }
  const collectionPct = required ? Math.round((100 * (required - remaining)) / required) : null;
  const arrears = allArrears(state, month);
  const famDues = allFamilyDues(state, month);
  const arrearsTotal = arrears.reduce((a, x) => a + x.total, 0);
  const famDuesTotal = famDues.reduce((a, x) => a + x.total, 0);
  // التزام الشهر القادم نقداً وعيناً
  const next = addMonths(month, 1);
  const fams = [...state.families.values()].filter((f) => !f.archived);
  const nextCash = fams.reduce((a, f) => a + entitlementAt(state, f.id, next), 0);
  const subsMonthly = [...state.subscribers.values()].filter((s) => !s.archived).reduce((a, s) => a + monthStatus(state, s.id, month, month).required, 0);
  const inkind = inkindTotals(state, { familyIds: fams.map((f) => f.id), fromMonth: month, toMonth: next }).map((t) => {
    const stock = itemPosition(led, t.itemId).qty;
    return { ...t, name: state.lists.items.get(t.itemId)?.name || t.itemId, unit: state.lists.items.get(t.itemId)?.unit || '', stock, short: Math.max(0, t.remaining - stock) };
  });
  const pools = rollups(state, led);
  const familiesPool = pools.find((p) => p.rollup.id === 'families') || null;
  const reviews = dueReviews(state, month);
  let assetsValue = 0;
  let assetsCost = 0;
  const stale = [];
  const limit = addMonths(month, -1) + today.slice(7);
  for (const a of state.lists.assets.values()) {
    const p = assetPosition(state, led, a.id, today);
    assetsValue += p.value;
    assetsCost += p.cost;
    if (p.qty > 0 && (p.priceDate === null || p.priceDate < limit)) stale.push(a);
  }
  const negative = [...state.lists.funds.values()].filter((f) => fundCash(led, f.id) < 0);
  const amanat = [...led.cash].filter(([a, v]) => a.startsWith('earmarked#family:') && v > 0).map(([acct, balance]) => ({ acct, balance, familyId: acct.split(':')[1] }));

  const decisions = [];
  const D = (level, text, path = null) => decisions.push({ level, text, path });
  if (led.problems.length) D('bad', 'يوجد رصيد سالب في المخزن أو الأصول — راجع الحركات.', '#/ledger');
  for (const f of negative) D('bad', `رصيد «${f.name}» سالب — حوّل له أو راجع الصرف منه.`, `#/fund/${encodeURIComponent(f.id)}`);
  if (familiesPool && nextCash > 0 && familiesPool.total < nextCash) D('bad', 'رصيد الأسر لا يكفي استحقاق الشهر القادم — يلزم تحصيل أو تحويل أو توزيع بنسبة.', '#/allocation');
  else if (runway !== null && runway < 2) D('warn', 'السيولة غير المقيّدة تكفي أقل من شهرين بمعدل الصرف الحالي.', '#/reports');
  if (famDues.length) D('warn', `${famDues.length} أسرة لها استحقاق متبقٍ حتى هذا الشهر — يمكن صرفه دفعة واحدة.`, '#/batch');
  for (const t of inkind.filter((x) => x.short > 0)) D('warn', `«${t.name}»: المخزون لا يكفي التزام هذا الشهر والقادم — جهّز خطة شراء.`, '#/purchase-plan');
  if (amanat.length) D('info', `${amanat.length} أمانة باسم أسر محددة تنتظر التسليم.`, '#/funds');
  if (reviews.length) D('info', `${reviews.length} أسرة حلّ موعد مراجعة تقييمها.`, '#/reviews');
  if (collectionPct !== null && collectionPct < 70) D('warn', `نسبة تحصيل الاشتراكات هذه السنة ${collectionPct}% — راجع المتأخرات.`, '#/arrears');
  if (stale.length) D('info', `${stale.length} أصل بلا سعر سوقي محدَّث منذ أكثر من شهر.`, '#/assets');
  if (!decisions.length) D('ok', 'لا تنبيهات — الوضع مستقر.');
  return { month, cash, unrestricted, restricted: cash - unrestricted, avgIn, avgOut, runway, required, collected: required - remaining, collectionPct, arrearsTotal, arrearsCount: arrears.length, famDuesTotal, famDuesCount: famDues.length, nextCash, subsMonthly, inkind, pools, familiesPool, reviews: reviews.length, assetsValue, assetsCost, inventory: inventoryCost(led), stale: stale.length, amanat, decisions, history: hist };
}

// إحصاءات الأسر (بلا أسماء): أعداد حسب الحالة والفئة ودرجة الاحتياج.
function familyStats(state, month) {
  const fams = [...state.families.values()].filter((f) => !f.archived);
  const byStatus = { permanent: 0, occasional: 0, paused: 0 };
  const byCat = new Map();
  const byNeed = new Map();
  let members = 0;
  for (const f of fams) {
    const p = profileAt(state, f.id, month) || f.profiles[0];
    if (!p) continue;
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    members += p.members || 0;
    for (const c of p.categories || []) byCat.set(c, (byCat.get(c) || 0) + 1);
    const a = currentAssessment(state, f.id);
    if (a) byNeed.set(a.result.categoryLabel, (byNeed.get(a.result.categoryLabel) || 0) + 1);
  }
  return { count: fams.length, members, byStatus, byCat: [...byCat].map(([id, n]) => ({ name: state.lists.familyCategories.get(id)?.name || id, n })), byNeed: [...byNeed].map(([name, n]) => ({ name, n })), assessed: [...byNeed.values()].reduce((a, b) => a + b, 0) };
}

function servedInPeriod(state, from, to) {
  const served = new Set();
  let count = 0;
  let inkindCount = 0;
  for (const [id, e] of familyIndex(state)) {
    for (const mv of e.distributions) {
      if (!inRange(mv.date, from, to)) continue;
      served.add(id);
      count++;
      if (mv.items?.length) inkindCount++;
    }
  }
  return { families: served.size, count, inkindCount };
}

const AUDIENCES = Object.freeze({
  board: 'تقرير مجلس الإدارة',
  subscribers: 'تقرير للمشتركين',
  donor: 'تعريف للمتبرعين',
  evaluator: 'عرض شامل للتقييم',
});
export const BRIEF_AUDIENCES = AUDIENCES;

// تقرير جاهز لجمهور محدد عن فترة [from, to].
export function buildBrief(state, audience, { from = null, to = null, today, periodLabel = '' }) {
  const org = state.settings.orgName || 'دفتر الخير';
  const month = ymOf(today);
  const ins = insights(state, today);
  const st = buildStatements(state, { from, to });
  const act = st.activities;
  const fs = familyStats(state, month);
  const served = servedInPeriod(state, from, to);
  const led = computeLedger(state, to);
  const sections = [];
  const pct = (x) => Math.round(x * 1000) / 10;
  const of = (code) => act.revenues.find((r) => r.code === code)?.amount || act.expenses.find((r) => r.code === code)?.amount || 0;
  const income = { heading: 'الوارد في الفترة', rows: act.revenues.map((r) => [r.name, r.amount, 'money']).concat([['إجمالي الإيرادات', act.totalRevenue, 'money']]), bars: act.revenues.map((r) => ({ label: r.name, value: r.amount })) };
  const spending = { heading: 'أين صُرف', rows: act.expenses.map((r) => [r.name, r.amount, 'money']).concat([['إجمالي المصروفات', act.totalExpense, 'money'], ['نسبة ما وصل للبرامج والمساعدات', pct(act.functional.programRatio), 'pct'], ['نسبة المصروفات الإدارية', pct(act.functional.adminRatio), 'pct']]), bars: act.expenses.map((r) => ({ label: r.name, value: r.amount })) };
  const impact = {
    heading: 'الأثر',
    rows: [
      ['أسر مسجلة', fs.count, 'int'],
      ['عدد الأفراد', fs.members, 'int'],
      ['أسر وصلتها مساعدة في الفترة', served.families, 'int'],
      ['مرات الصرف والتوزيع', served.count, 'int'],
      ['مساعدات نقدية', of(5100), 'money'],
      ['مساعدات عينية (بالتكلفة)', of(5200), 'money'],
    ],
    bars: fs.byCat.map((c) => ({ label: c.name, value: c.n, type: 'int' })),
  };
  const fundsTable = {
    heading: 'الصناديق (كل صندوق بحساباته وأصوله)',
    table: {
      cols: [T('الصندوق'), T('النقد', 'money'), T('الأصول (بالقيمة الحالية)', 'money'), T('الإجمالي', 'money'), T('التصنيف')],
      rows: [...state.lists.funds.values()]
        .map((f) => ({ f, h: fundHoldings(state, led, f.id, to || today) }))
        .filter(({ f, h }) => !f.archived || h.total !== 0)
        .map(({ f, h }) => [f.name, h.cash, h.assetsValue, h.total, isUnrestrictedFund(state, f.id) ? 'غير مقيّد' : 'مقيّد']),
    },
  };
  const months = { heading: 'آخر الشهور', table: { cols: [T('الشهر'), T('وارد', 'money'), T('منصرف', 'money'), T('الصافي', 'money')], rows: reportByMonth(state, { from: `${addMonths(month, -5)}-01`, to: `${month}-31`, nowMonth: month }).map((r) => [monthLabel(r.month), r.inflow, r.outflow, r.net]) } };
  const position = {
    heading: 'المركز المالي',
    rows: [
      ['النقدية بالصناديق', st.position.cash, 'money'],
      ['منها غير مقيّد (متاح للصرف العام)', st.position.netAssets.unrestricted, 'money'],
      ['منها مقيّد (أمانات، حملات، صناديق خاصة)', st.position.netAssets.restricted, 'money'],
      ['المخزون العيني (بالتكلفة)', st.position.inventory, 'money'],
      ['الأصول والاستثمارات (بالتكلفة)', st.position.investments, 'money'],
      ['الأصول والاستثمارات (بالقيمة الحالية)', st.position.investmentsValue, 'money'],
      ['صافي الأصول', st.position.netAssets.end, 'money'],
    ],
  };
  const commitments = {
    heading: 'الالتزامات القادمة',
    rows: [
      ['استحقاق الأسر النقدي للشهر القادم', ins.nextCash, 'money'],
      ['الاشتراكات الشهرية المتوقعة', ins.subsMonthly, 'money'],
      ['استحقاقات أسر متبقية حتى الآن', ins.famDuesTotal, 'money'],
      ['متأخرات المشتركين', ins.arrearsTotal, 'money'],
      ...(ins.runway !== null ? [['السيولة غير المقيّدة تكفي (شهور)', ins.runway, 'num']] : []),
    ],
  };
  const inkind = ins.inkind.length ? { heading: 'الالتزام العيني (هذا الشهر والقادم)', table: { cols: [T('الصنف'), T('المتبقي للأسر', 'qty'), T('المخزون', 'qty'), T('العجز', 'qty')], rows: ins.inkind.map((t) => [`${t.name} (${t.unit})`, t.remaining, t.stock, t.short]) } } : null;
  const decisions = { heading: 'تنبيهات وقرارات مقترحة', notes: ins.decisions.map((d) => d.text) };
  const assets = (() => {
    const kinds = assetsByKind(state, led, to || today);
    if (!kinds.length) return null;
    return { heading: 'الأصول حسب النوع (إجمالي للمعرفة — كل صندوق بحسابه)', table: { cols: [T('النوع'), T('الصندوق'), T('الكمية'), T('المدفوع', 'money'), T('القيمة الحالية', 'money')], rows: kinds.flatMap((k) => k.funds.map((f) => [ASSET_KINDS[k.kind] || k.kind, state.lists.funds.get(f.fundId)?.name || '', f.units.map((u) => `${u.qty / 1000} ${u.unit}`).join(' + '), f.cost, f.value])) } };
  })();
  const camps = reportByCampaign(state, { from, to }).filter((c) => c.inflow || c.outflow || c.balance);
  const campaigns = camps.length ? { heading: 'الحملات والمشروعات', table: { cols: [T('الحملة'), T('وارد', 'money'), T('منصرف', 'money'), T('الرصيد', 'money')], rows: camps.map((c) => [c.campaign.name, c.inflow, c.outflow, c.balance]) } } : null;
  const needMix = fs.byNeed.length ? { heading: 'درجات الاحتياج (من التقييمات المعتمدة)', rows: fs.byNeed.map((c) => [c.name, c.n, 'int']), bars: fs.byNeed.map((c) => ({ label: c.name, value: c.n, type: 'int' })) } : null;
  const headline = { heading: 'الخلاصة', rows: [['إجمالي الوارد', act.totalRevenue, 'money'], ['إجمالي المصروف', act.totalExpense, 'money'], [act.surplus >= 0 ? 'الفائض' : 'العجز', act.surplus, 'money'], ['إجمالي السيولة الآن', ins.cash, 'money']] };

  if (audience === 'board') sections.push(headline, decisions, commitments, fundsTable, months, income, spending, impact, needMix, inkind, assets, campaigns);
  else if (audience === 'subscribers')
    sections.push({ heading: 'اشتراكاتكم', rows: [['اشتراكات الفترة المحصّلة', of(4100), 'money'], ['تبرعات إضافية', of(4200) + of(4300), 'money'], ...(ins.collectionPct !== null ? [['نسبة تحصيل اشتراكات السنة', ins.collectionPct, 'pct']] : [])] }, spending, impact, { heading: 'الرصيد', rows: [['إجمالي السيولة الآن', ins.cash, 'money'], ['استحقاق الأسر للشهر القادم', ins.nextCash, 'money']] });
  else if (audience === 'donor')
    sections.push(impact, needMix, { heading: 'أمانة الصرف', rows: [['نسبة ما وصل للبرامج والمساعدات', pct(act.functional.programRatio), 'pct'], ['نسبة المصروفات الإدارية', pct(act.functional.adminRatio), 'pct']], notes: ['كل تبرع مخصص لجهة يُحفظ في حساب أمانة مستقل ولا يُصرف إلا لها.', 'كل قبض وصرف بسند متسلسل وسجل لا يُمحى منه شيء.'] }, { heading: 'الحاجة القائمة', rows: [['استحقاق الأسر الشهري', ins.nextCash, 'money'], ['الاشتراكات الشهرية المنتظمة', ins.subsMonthly, 'money'], ['الفجوة الشهرية', Math.max(0, ins.nextCash - ins.subsMonthly), 'money']] }, campaigns);
  else if (audience === 'evaluator')
    sections.push(
      headline,
      position,
      fundsTable,
      assets,
      income,
      spending,
      impact,
      needMix,
      commitments,
      inkind,
      { heading: 'الضبط والتوثيق', rows: [['حركات مسجلة', state.movements.filter((m) => !m.voided).length, 'int'], ['حركات ملغاة (باقية في سجل التدقيق)', state.movements.filter((m) => m.voided).length, 'int'], ['سندات قبض', state.vouchers.R, 'int'], ['سندات صرف', state.vouchers.P, 'int'], ['آخر سنة مقفولة', closedThrough(state) ?? '—', 'text'], ['قيود غير متوازنة', st.totals.unbalanced, 'int'], ['أسر لها تقييم احتياج معتمد', fs.assessed, 'int']], notes: ['الأرصدة كلها محسوبة من الحركات — لا رصيد مخزَّن. ميزان المراجعة ' + (st.totals.debit === st.totals.credit ? 'متزن.' : 'غير متزن!')] },
      decisions,
    );
  return { audience, title: `${AUDIENCES[audience] || 'تقرير'} — ${org}`, subtitle: periodLabel, date: today, sections: sections.filter(Boolean).filter((s) => (s.rows && s.rows.length) || (s.table && s.table.rows.length) || (s.notes && s.notes.length)) };
}
