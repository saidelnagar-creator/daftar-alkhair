// بناء جداول التقارير مرة واحدة للعرض وللتصدير إلى Excel.
// كل عمود له نوع: text | money | qty | aqty | int — القيم تبقى بوحداتها الصحيحة حتى لحظة العرض/التصدير.
import { F, ctx } from './ctx.js';
import { firstFiscalYear, activeMovements } from '../core/engine.js';
import { reportByMonth, reportBySubscriber, reportByFamily, reportByPurpose, reportByCategory, reportByCampaign, reportByFund, describeMovement } from '../core/reports.js';
import { allArrears } from '../core/subscriptions.js';
import { computeLedger, assetPosition, itemPosition } from '../core/ledger.js';
import { buildStatements } from '../core/statements.js';
import { MONEY, QTY, ASSET } from '../core/money.js';
import { collator } from './widgets.js';

// الفترة: سنة مالية (ما قبل بداية الدفاتر يُحسب ضمن أول سنة) أو الكل.
export function periodOf(S, value) {
  const first = firstFiscalYear(S);
  const nowYear = new Date().getFullYear();
  if (value === 'all') return { label: 'كل السنوات', from: null, to: null, fromMonth: `${first}-01`, toMonth: `${Math.max(nowYear, first)}-12` };
  const y = Number(value);
  return { label: `سنة ${y}`, from: y <= first ? null : `${y}-01-01`, to: `${y}-12-31`, fromMonth: `${y}-01`, toMonth: `${y}-12` };
}

const T = (label, type = 'text') => ({ label, type });
const sumCols = (cols, rows, first = 'الإجمالي') => cols.map((c, i) => (i === 0 ? first : c.type === 'text' ? '' : rows.reduce((a, r) => a + (r[i] || 0), 0)));

export function buildReports(S, period) {
  const nowMonth = ctx.nowMonth();
  const range = { from: period.from, to: period.to, fromMonth: period.fromMonth, toMonth: period.toMonth, nowMonth };
  const out = {};

  {
    const cols = [T('الشهر'), T('الوارد', 'money'), T('المنصرف', 'money'), T('الصافي', 'money'), T('اشتراكات مطلوبة', 'money'), T('مسدد لشهره', 'money'), T('متبقي', 'money')];
    // أول سنة تشمل ما سُجّل قبل بداية الدفاتر
    let mFrom = period.from || `${period.fromMonth}-01`;
    if (!period.from) for (const mv of activeMovements(S)) if (mv.date < mFrom) mFrom = mv.date;
    const data = reportByMonth(S, { from: mFrom, to: period.to || `${period.toMonth}-31`, nowMonth });
    const rows = data.map((r) => [F.month(r.month), r.inflow, r.outflow, r.net, r.required, r.paidForMonth, r.month <= nowMonth ? r.remaining : 0]);
    out.month = { title: 'بالشهر', cols, rows, total: sumCols(cols, rows) };
  }
  {
    const cols = [T('المشترك'), T('المطلوب', 'money'), T('المسدد', 'money'), T('المتبقي', 'money'), T('لن يُسدد', 'money'), T('دفع في الفترة', 'money'), T('منها زيادة/مخصص', 'money'), T('شهور مسددة', 'int'), T('شهور متأخرة', 'int')];
    const rows = reportBySubscriber(S, range)
      .filter((r) => r.required || r.cash || r.remaining)
      .sort((a, b) => collator.compare(a.subscriber.name, b.subscriber.name))
      .map((r) => [r.subscriber.name, r.required, r.paid, r.remaining, r.writeoff, r.cash, r.extra, r.paidMonths, r.dueMonths]);
    out.subscriber = { title: 'بالمشترك', cols, rows, total: sumCols(cols, rows) };
  }
  {
    const cols = [T('الأسرة'), T('صُرف نقداً', 'money'), T('قيمة العيني', 'money'), T('مرات الصرف', 'int'), T('استحقاق الفترة', 'money'), T('وصل منه', 'money'), T('متبقي', 'money'), T('شهور وصلت', 'int'), T('شهور متبقية', 'int')];
    const rows = reportByFamily(S, range)
      .filter((r) => r.cash || r.itemsCost || r.entitled || r.count)
      .sort((a, b) => collator.compare(a.family.name, b.family.name))
      .map((r) => [r.family.name, r.cash, r.itemsCost, r.count, r.entitled, r.received, r.remaining, r.deliveredMonths, r.dueMonths]);
    out.family = { title: 'بالأسرة', cols, rows, total: sumCols(cols, rows) };
  }
  {
    const cols = [T('القسم'), T('الغرض / النوع'), T('المبلغ', 'money')];
    const p = reportByPurpose(S, range);
    const rows = [...p.receipts.map((r) => ['وارد', r.name, r.amount]), ...p.distributions.map((r) => ['صرف للأسر', r.name, r.amount]), ...p.expenses.map((r) => ['مصروفات ومشتريات', r.name, r.amount])];
    out.purpose = { title: 'بالغرض', cols, rows, total: null };
  }
  {
    const cols = [T('الفئة'), T('عدد الأسر', 'int'), T('وارد مخصص للفئة', 'money'), T('صُرف لأسر الفئة', 'money'), T('رصيد أمانة الفئة', 'money')];
    const rows = reportByCategory(S, range).map((r) => [r.category.name, r.families, r.earmarkedIn, r.distributed, r.balance]);
    out.category = { title: 'بالفئة', cols, rows, total: null };
  }
  {
    const cols = [T('الحملة / المشروع'), T('الوارد', 'money'), T('المنصرف', 'money'), T('الرصيد الحالي', 'money')];
    const rows = reportByCampaign(S, range).map((r) => [r.campaign.name, r.inflow, r.outflow, r.balance]);
    out.campaign = { title: 'بالحملة', cols, rows, total: sumCols(cols, rows) };
  }
  {
    const cols = [T('الصندوق'), T('أول الفترة', 'money'), T('وارد', 'money'), T('منصرف', 'money'), T('تحويل داخل', 'money'), T('تحويل خارج', 'money'), T('آخر الفترة', 'money'), T('أصول (المدفوع)', 'money'), T('أصول (الحالي)', 'money')];
    const rows = reportByFund(S, range)
      .filter((r) => !r.fund.archived || r.closing || r.inflow || r.outflow)
      .map((r) => [r.fund.name, r.opening, r.inflow, r.outflow, r.transferIn, r.transferOut, r.closing, r.assets.cost, r.assets.value]);
    out.fund = { title: 'بالصندوق', cols, rows, total: sumCols(cols, rows) };
  }
  // ---- القوائم المالية (قيد مزدوج مشتق من الحركات) ----
  const st = buildStatements(S, { from: period.from, to: period.to });
  const pct = (x) => `${F.num((Math.round(x * 1000) / 10).toString())}%`;
  {
    const cols = [T('البند'), T('المبلغ', 'money'), T('بيان')];
    const a = st.activities;
    const rows = [['— الإيرادات —', null, '']];
    for (const r of a.revenues) rows.push([r.name, r.amount, '']);
    rows.push(['إجمالي الإيرادات', a.totalRevenue, ''], ['— المصروفات —', null, '']);
    for (const r of a.expenses) rows.push([r.name, r.amount, '']);
    rows.push(['إجمالي المصروفات', a.totalExpense, ''], [a.surplus >= 0 ? 'الفائض' : 'العجز', a.surplus, 'يُضاف لصافي الأصول']);
    rows.push(['نسبة ما صُرف على البرامج والمساعدات', null, pct(a.functional.programRatio)], ['نسبة المصروفات الإدارية', null, pct(a.functional.adminRatio)]);
    out.activities = { title: 'قائمة الأنشطة', cols, rows, total: null };
  }
  {
    const cols = [T('البند'), T('المبلغ', 'money'), T('بيان')];
    const p = st.position;
    const rows = [['— الأصول —', null, '']];
    for (const f of p.funds) rows.push([`نقدية: ${f.fund.name}`, f.cash, f.unrestricted ? 'غير مقيّد' : 'مقيّد']);
    rows.push(['المخزون العيني (بالتكلفة)', p.inventory, ''], ['الأصول والاستثمارات (بالتكلفة)', p.investments, `القيمة الحالية ${F.money(p.investmentsValue)}`], ['إجمالي الأصول', p.totalAssets, '']);
    rows.push(['— صافي الأصول —', null, ''], ['أول الفترة', p.netAssets.start, ''], ['فائض (عجز) الفترة', p.netAssets.surplus, ''], ['آخر الفترة', p.netAssets.end, p.netAssets.end === p.totalAssets ? 'متزن مع الأصول ✓' : 'غير متزن!']);
    rows.push(['منها: نقد غير مقيّد (متاح للصرف العام)', p.netAssets.unrestricted, ''], ['منها: نقد مقيّد (مخصص، حملات، صناديق خاصة)', p.netAssets.restricted, ''], ['منها: مستثمر في مخزون وأصول', p.netAssets.invested, '']);
    out.position = { title: 'المركز المالي', cols, rows, total: null };
  }
  {
    const cols = [T('رقم'), T('الحساب'), T('مدين', 'money'), T('دائن', 'money')];
    const rows = st.trial.map((r) => [String(r.code), r.name, r.debit, r.credit]);
    out.trial = { title: 'ميزان المراجعة', cols, rows, total: ['', st.totals.debit === st.totals.credit ? 'الإجمالي (متزن ✓)' : 'الإجمالي (غير متزن!)', st.totals.debit, st.totals.credit] };
  }
  return out;
}

// جداول إضافية للتصدير فقط.
export function buildExtraSheets(S, period) {
  const nowMonth = ctx.nowMonth();
  const led = computeLedger(S, period.to || null);
  const sheets = [];
  {
    const cols = [T('المشترك'), T('الشهر'), T('المطلوب', 'money'), T('المسدد', 'money'), T('المتبقي', 'money')];
    const asOf = period.toMonth < nowMonth ? period.toMonth : nowMonth;
    const rows = [];
    for (const a of allArrears(S, asOf)) for (const m of a.months) rows.push([a.subscriber.name, m.month, m.required, m.paid, m.remaining]);
    sheets.push({ title: 'المتأخرات', cols, rows });
  }
  {
    const cols = [T('الصنف'), T('الوحدة'), T('الرصيد', 'qty'), T('قيمته', 'money'), T('وارد شراء', 'qty'), T('تكلفة الشراء', 'money'), T('وارد تبرع', 'qty'), T('صادر', 'qty')];
    const rows = [...S.lists.items.values()].map((it) => {
      const p = itemPosition(led, it.id);
      return [it.name, it.unit, p.qty, p.cost, p.purchasedQty, p.purchasedCost, p.donatedQty, p.distributedQty];
    });
    sheets.push({ title: 'المخزن', cols, rows });
  }
  {
    const cols = [T('الأصل'), T('الصندوق'), T('الكمية', 'aqty'), T('المدفوع', 'money'), T('القيمة الحالية', 'money'), T('ربح/خسارة غير محققة', 'money'), T('محقق', 'money'), T('عوائد', 'money')];
    const rows = [...S.lists.assets.values()].map((a) => {
      const p = assetPosition(S, led, a.id, period.to || ctx.today());
      return [a.name, S.lists.funds.get(a.fundId)?.name || '', p.qty, p.cost, p.value, p.unrealized, p.realized, p.income];
    });
    sheets.push({ title: 'الأصول', cols, rows });
  }
  {
    const cols = [T('التاريخ'), T('النوع'), T('البيان'), T('الطرف'), T('المبلغ', 'money'), T('ملاحظة')];
    const rows = [];
    for (const mv of activeMovements(S)) {
      if ((period.from && mv.date < period.from) || (period.to && mv.date > period.to)) continue;
      const d = describeMovement(S, mv);
      rows.push([mv.date, d.kind, d.title, d.party, d.sign < 0 ? -d.amount : d.amount, mv.note || mv.reason || '']);
    }
    sheets.push({ title: 'الحركات', cols, rows });
  }
  return sheets;
}

const SCALE = { money: MONEY, qty: QTY, aqty: ASSET };
export const displayCell = (v, type) => (v === null || v === undefined ? '' : type === 'money' ? F.money(v) : type === 'qty' ? F.qty(v) : type === 'aqty' ? F.aqty(v) : type === 'int' ? F.num(v) : String(v ?? ''));
export const exportCell = (v, type) => (v === null || v === undefined ? '' : type in SCALE ? (v || 0) / SCALE[type] : type === 'int' ? v || 0 : v ?? '');

export function toXlsxSheets(reports, extras) {
  const sheet = (r) => ({ name: r.title, rows: [r.cols.map((c) => c.label), ...r.rows.map((row) => row.map((v, i) => exportCell(v, r.cols[i].type))), ...(r.total ? [r.total.map((v, i) => (typeof v === 'string' ? v : exportCell(v, r.cols[i].type)))] : [])] });
  return [...Object.values(reports).map(sheet), ...extras.map(sheet)];
}
