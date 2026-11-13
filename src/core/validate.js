// التحقق قبل إضافة أي حدث للسجل. يرمي ValidationError برسالة عربية واضحة.
import { ASSET_KINDS, FAMILY_STATUS, FUND_TYPES, MONEY_TYPES, MOVEMENT_KINDS } from '../config/defaults.js';
import { RULES } from '../config/rules.js';
import { LISTS, acctFund, acctSub, activeClosing, closedThrough, currentFiscalYear, firstFiscalYear, isLockedDate, isLockedMonth, precisionAt, stepsAt } from './engine.js';
import { isMultiple } from './money.js';
import { computeLedger } from './ledger.js';
import { check, isDate, isMonth, yearOf } from './util.js';

const isInt = (x) => Number.isSafeInteger(x);
const isPos = (x) => isInt(x) && x > 0;
const isNonNeg = (x) => isInt(x) && x >= 0;
const isStr = (x) => typeof x === 'string';
const nonEmpty = (x) => isStr(x) && x.trim().length > 0;

function checkAcct(state, acct, label = 'الحساب') {
  check(nonEmpty(acct), `${label}: اختر صندوقاً`);
  const fund = state.lists.funds.get(acctFund(acct));
  check(!!fund, `${label}: صندوق غير موجود`);
  const sub = acctSub(acct);
  if (sub) {
    const [type, id] = sub.split(':');
    if (type === 'campaign') check(state.lists.campaigns.has(id), `${label}: حملة غير موجودة`);
    else if (type === 'family') check(state.families.has(id), `${label}: أسرة غير موجودة`);
    else if (type === 'category') check(state.lists.familyCategories.has(id), `${label}: فئة غير موجودة`);
    else check(false, `${label}: حساب فرعي غير معروف`);
  }
}

function checkTarget(state, t) {
  check(t && isStr(t.type) && isStr(t.id), 'البند المخصص يحتاج جهة تخصيص');
  if (t.type === 'fund') check(state.lists.funds.has(t.id), 'صندوق التخصيص غير موجود');
  else if (t.type === 'campaign') check(state.lists.campaigns.has(t.id), 'الحملة غير موجودة');
  else if (t.type === 'family') check(state.families.has(t.id), 'الأسرة المخصص لها غير موجودة');
  else if (t.type === 'category') check(state.lists.familyCategories.has(t.id), 'الفئة المخصص لها غير موجودة');
  else check(false, 'نوع التخصيص غير معروف');
}

function checkStock(state, mv, skip = null) {
  const before = computeLedger(state).problems.length;
  const after = computeLedger(state, null, { extra: mv ? [mv] : null, skip }).problems;
  // عند استبدال حركة (إلغاء ثم إضافة) قد توجد مشكلة مؤقتة؛ الفحص النهائي في Book.replaceMovement
  check(after.length <= before, 'الكمية المتاحة لا تكفي (الرصيد سيصبح سالباً في تاريخ الحركة أو بعده)');
}

const MONEY_MSG = (decimals) => (decimals === 0 ? 'المبالغ أرقام صحيحة بلا كسور (يمكن تغيير عدد الخانات من الإعدادات)' : `المبلغ يتجاوز الخانات العشرية المسموحة (${decimals})`);

// الالتزام بعدد الخانات العشرية الساري في تاريخ الحركة (لكل فئة: مبالغ / عيني / أصول).
function checkPrecision(state, mv) {
  const p = precisionAt(state, mv.date);
  const st = stepsAt(state, mv.date);
  const money = (x) => check(x === undefined || x === null || isMultiple(x, st.money), MONEY_MSG(p.money));
  const qty = (x) => check(x === undefined || isMultiple(x, st.qty), p.qty === 0 ? 'الكميات العينية أرقام صحيحة بلا كسور' : `الكمية تتجاوز الخانات العشرية المسموحة (${p.qty})`);
  const aqty = (x) => check(x === undefined || isMultiple(x, st.asset), p.asset === 0 ? 'كميات الأصول أرقام صحيحة بلا كسور' : `كمية الأصل تتجاوز الخانات العشرية المسموحة (${p.asset})`);
  const isAsset = ['asset_buy', 'asset_sell', 'asset_in'].includes(mv.kind) || mv.target === 'asset';
  const isItem = mv.target === 'item';
  if (!isItem && !isAsset) money(mv.amount);
  else if (['asset_buy', 'asset_sell'].includes(mv.kind)) money(mv.amount);
  money(mv.value);
  money(mv.cost);
  if (isAsset) aqty(mv.qty);
  if (isItem) qty(mv.qty);
  for (const l of mv.lines || []) {
    money(l.amount);
    money(l.cost);
    if ('qty' in l) qty(l.qty);
  }
  for (const it of mv.items || []) {
    qty(it.qty);
    money(it.value);
  }
}

function moneyAt(state, month, x) {
  check(x === undefined || x === null || isMultiple(x, stepsAt(state, month).money), MONEY_MSG(precisionAt(state, month).money));
}

export function validateMovement(state, mv) {
  check(mv && nonEmpty(mv.id), 'حركة بدون معرف');
  check(!state.mvById.has(mv.id), 'معرف الحركة مكرر');
  check(mv.kind in MOVEMENT_KINDS, 'نوع حركة غير معروف');
  check(isDate(mv.date), 'التاريخ غير صالح');
  check(!isLockedDate(state, mv.date), `السنة ${yearOf(mv.date)} مقفولة — لا يمكن إضافة حركة بتاريخ داخلها`);
  if (mv.note !== undefined) check(isStr(mv.note), 'الملاحظة يجب أن تكون نصاً');
  if (mv.voucher !== undefined) check(mv.voucher && ['R', 'P', 'J'].includes(mv.voucher.s) && isPos(mv.voucher.n), 'رقم السند غير صالح');

  switch (mv.kind) {
    case 'receipt': {
      check(mv.payer && (mv.payer.type === 'subscriber' || mv.payer.type === 'other'), 'حدد صاحب الدفعة');
      if (mv.payer.type === 'subscriber') check(state.subscribers.has(mv.payer.id), 'المشترك غير موجود');
      check(isPos(mv.amount), 'المبلغ يجب أن يكون أكبر من صفر');
      checkAcct(state, mv.acct || 'general');
      check(Array.isArray(mv.lines) && mv.lines.length > 0, 'الدفعة تحتاج بند تخصيص واحد على الأقل');
      let s = 0;
      for (const l of mv.lines) {
        check(['sub', 'advance', 'extra', 'earmark'].includes(l.kind), 'نوع بند غير معروف');
        check(isPos(l.amount), 'مبلغ البند يجب أن يكون أكبر من صفر');
        if (l.kind === 'sub' || l.kind === 'advance') {
          check(mv.payer.type === 'subscriber', 'بنود الاشتراك تحتاج مشتركاً');
          check(isMonth(l.month), 'بند الاشتراك يحتاج شهراً محدداً');
        } else if (l.month !== undefined && l.month !== null) check(isMonth(l.month), 'شهر البند غير صالح');
        if (l.kind === 'earmark') checkTarget(state, l.target);
        if (l.purposeId) check(state.lists.purposes.has(l.purposeId), 'الغرض غير موجود');
        s += l.amount;
      }
      check(s === mv.amount, 'مجموع بنود التخصيص لا يساوي مبلغ الدفعة');
      break;
    }
    case 'inkind_receipt': {
      check(Array.isArray(mv.items) && mv.items.length > 0, 'أضف صنفاً واحداً على الأقل');
      for (const it of mv.items) {
        check(state.lists.items.has(it.itemId), 'الصنف غير موجود');
        check(isPos(it.qty), 'الكمية يجب أن تكون أكبر من صفر');
        check(it.value === undefined || isNonNeg(it.value), 'القيمة التقديرية غير صالحة');
      }
      if (mv.udhiyaId !== undefined) check(state.udhiya.has(mv.udhiyaId), 'الذبيحة غير موجودة');
      break;
    }
    case 'distribution': {
      if (mv.familyId) check(state.families.has(mv.familyId), 'الأسرة غير موجودة');
      check(isNonNeg(mv.amount), 'المبلغ غير صالح');
      const items = mv.items || [];
      check(mv.amount > 0 || items.length > 0, 'أدخل مبلغاً أو أصنافاً للصرف');
      let s = 0;
      for (const l of mv.lines || []) {
        check(['entitlement', 'extra'].includes(l.kind), 'نوع بند غير معروف');
        check(isPos(l.amount), 'مبلغ البند يجب أن يكون أكبر من صفر');
        if (l.kind === 'entitlement') {
          check(!!mv.familyId, 'بنود الاستحقاق تحتاج أسرة');
          check(isMonth(l.month), 'بند الاستحقاق يحتاج شهراً محدداً');
        }
        if (l.purposeId) check(state.lists.purposes.has(l.purposeId), 'الغرض غير موجود');
        s += l.amount;
      }
      check(s === mv.amount, 'مجموع بنود الصرف لا يساوي المبلغ');
      if (mv.amount > 0) checkAcct(state, mv.acct);
      for (const it of items) {
        check(state.lists.items.has(it.itemId), 'الصنف غير موجود');
        check(isPos(it.qty), 'الكمية يجب أن تكون أكبر من صفر');
      }
      for (const m of mv.inkindMonths || []) {
        check(isMonth(m), 'شهر غير صالح');
        check(!!mv.familyId, 'شهور الاستحقاق العيني تحتاج أسرة');
      }
      // بنود الالتزام العيني التي يغطيها هذا الصرف: (شهر، صنف الالتزام، الكمية المغطاة بوحدة صنف الالتزام)
      if (mv.inkindLines !== undefined) {
        check(Array.isArray(mv.inkindLines), 'بنود الالتزام العيني غير صالحة');
        for (const l of mv.inkindLines) {
          check(!!mv.familyId, 'بنود الالتزام العيني تحتاج أسرة');
          check(l && isMonth(l.month), 'بند الالتزام العيني يحتاج شهراً محدداً');
          check(state.lists.items.has(l.itemId), 'صنف الالتزام غير موجود');
          check(isPos(l.qty), 'كمية بند الالتزام يجب أن تكون أكبر من صفر');
        }
      }
      if (mv.batchId !== undefined) check(nonEmpty(mv.batchId), 'معرف الدفعة المجمّعة غير صالح');
      if (mv.udhiyaId !== undefined) check(state.udhiya.has(mv.udhiyaId), 'الذبيحة غير موجودة');
      if (items.length) checkStock(state, mv);
      break;
    }
    case 'expense':
      check(isPos(mv.amount), 'المبلغ يجب أن يكون أكبر من صفر');
      checkAcct(state, mv.acct);
      if (mv.expenseTypeId) check(state.lists.expenseTypes.has(mv.expenseTypeId), 'نوع المصروف غير موجود');
      break;
    case 'purchase': {
      check(isNonNeg(mv.amount), 'المبلغ غير صالح');
      checkAcct(state, mv.acct);
      check(Array.isArray(mv.lines) && mv.lines.length > 0, 'أضف صنفاً واحداً على الأقل');
      let s = 0;
      for (const l of mv.lines) {
        check(state.lists.items.has(l.itemId), 'الصنف غير موجود');
        check(isPos(l.qty), 'الكمية يجب أن تكون أكبر من صفر');
        check(isNonNeg(l.cost), 'تكلفة البند غير صالحة');
        s += l.cost;
      }
      check(s === mv.amount, 'مجموع تكلفة البنود لا يساوي إجمالي الفاتورة');
      break;
    }
    case 'transfer':
      check(isPos(mv.amount), 'المبلغ يجب أن يكون أكبر من صفر');
      checkAcct(state, mv.from, 'من');
      checkAcct(state, mv.to, 'إلى');
      check(mv.from !== mv.to, 'لا يمكن التحويل لنفس الحساب');
      break;
    case 'asset_buy':
    case 'asset_sell':
      check(state.lists.assets.has(mv.assetId), 'الأصل غير موجود');
      check(isPos(mv.qty), 'الكمية يجب أن تكون أكبر من صفر');
      check(isNonNeg(mv.amount), 'المبلغ غير صالح');
      checkAcct(state, mv.acct);
      if (mv.kind === 'asset_sell') checkStock(state, mv);
      break;
    case 'asset_in':
      check(state.lists.assets.has(mv.assetId), 'الأصل غير موجود');
      check(isPos(mv.qty), 'الكمية يجب أن تكون أكبر من صفر');
      check(mv.value === undefined || isNonNeg(mv.value), 'القيمة غير صالحة');
      break;
    case 'asset_income':
      check(isPos(mv.amount), 'المبلغ يجب أن يكون أكبر من صفر');
      checkAcct(state, mv.acct);
      if (mv.assetId) check(state.lists.assets.has(mv.assetId), 'الأصل غير موجود');
      break;
    case 'adjustment':
    case 'opening':
      if (mv.kind === 'adjustment') check(nonEmpty(mv.reason), 'التسوية تحتاج سبباً');
      if (mv.target === 'cash') {
        checkAcct(state, mv.acct);
        check(isInt(mv.amount) && mv.amount !== 0, 'مبلغ التسوية غير صالح');
      } else if (mv.target === 'item' || mv.target === 'asset') {
        if (mv.target === 'item') check(state.lists.items.has(mv.itemId), 'الصنف غير موجود');
        else check(state.lists.assets.has(mv.assetId), 'الأصل غير موجود');
        check(isInt(mv.qty), 'الكمية غير صالحة');
        check(mv.cost === undefined || isInt(mv.cost), 'التكلفة غير صالحة');
        check(mv.qty !== 0 || (mv.cost || 0) !== 0, 'التسوية فارغة');
        if (mv.qty < 0) checkStock(state, mv);
      } else check(false, 'هدف التسوية غير معروف');
      break;
    default:
      break;
  }
  checkPrecision(state, mv);
}

const validPrecision = (v) =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x, i) => isMonth(x.from) && (i === 0 || v[i - 1].from < x.from) && ['money', 'qty', 'asset'].every((k) => isInt(x[k]) && x[k] >= 0 && x[k] <= RULES.precisionMax[k]));

const SETTING_CHECKS = {
  precision: validPrecision,
  orgName: (v) => nonEmpty(v),
  digits: (v) => v === 'latn' || v === 'arab',
  firstFiscalYear: (v) => isInt(v) && v > 1990 && v < 2200,
  backupReminderDays: (v) => v === null || (isInt(v) && v >= 0),
  criteria: (v) =>
    v &&
    isNonNeg(v.perMember) &&
    Array.isArray(v.needLevels) &&
    Array.isArray(v.flags) &&
    [...v.needLevels, ...v.flags].every((x) => nonEmpty(x.id) && nonEmpty(x.name) && isInt(x.points)),
  pointValue: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isMonth(x.from) && isNonNeg(x.value)),
  rollups: (v) => Array.isArray(v) && v.every((x) => x && nonEmpty(x.id) && nonEmpty(x.name) && Array.isArray(x.funds) && x.funds.every(isStr)) && new Set(v.map((x) => x.id)).size === v.length,
};

const validNeedConfig = (c) =>
  c &&
  typeof c === 'object' &&
  isPos(c.R) &&
  isPos(c.pointsPerR) &&
  isPos(c.gold21PricePerGram) &&
  isPos(c.nisabGrams) &&
  isPos(c.dailyWage) &&
  isPos(c.imputedWorkDays) &&
  c.items &&
  Object.values(c.items).every((it) => it && isNonNeg(it.min) && isNonNeg(it.typ) && isNonNeg(it.max) && it.min <= it.typ && it.typ <= it.max) &&
  c.thresholds &&
  isNonNeg(c.thresholds.stopPct) &&
  c.thresholds.stopPct <= c.thresholds.partialBelowPct &&
  c.thresholds.partialBelowPct <= c.thresholds.severeFromPct &&
  c.weights10 &&
  isPos(c.weights10.base) &&
  c.weights10.max >= c.weights10.base &&
  ['ages', 'ration', 'incomeRates', 'imputed', 'student', 'assets', 'protection', 'empowerment', 'review', 'oneOff', 'gasLargeFamily'].every((k) => c[k] && typeof c[k] === 'object');

export function validateEvent(state, ev) {
  check(ev && nonEmpty(ev.id) && nonEmpty(ev.type) && nonEmpty(ev.ts), 'حدث غير مكتمل');
  const d = ev.data || {};
  switch (ev.type) {
    case 'settings.set':
      check(d.key in SETTING_CHECKS, 'إعداد غير معروف');
      check(SETTING_CHECKS[d.key](d.value), 'قيمة الإعداد غير صالحة');
      if (d.key === 'firstFiscalYear') check(closedThrough(state) === null, 'لا يمكن تغيير بداية الدفاتر بعد إقفال سنة');
      if (d.key === 'rollups') for (const r of d.value) for (const f of r.funds) check(state.lists.funds.has(f), `مجموع «${r.name}»: صندوق غير موجود`);
      if (d.key === 'pointValue') for (const x of d.value) if (!isLockedMonth(state, x.from)) moneyAt(state, x.from, x.value);
      if (d.key === 'precision' && closedThrough(state) !== null) {
        // لا يمس الماضي: ما يسري على السنوات المقفولة يبقى كما هو
        const locked = (arr) => JSON.stringify((arr || []).filter((x) => isLockedMonth(state, x.from)).map((x) => [x.from, x.money, x.qty, x.asset]));
        check(locked(d.value) === locked(state.settings.precision), 'لا يمكن تغيير الخانات العشرية داخل سنة مقفولة — اختر شهراً في السنة المفتوحة');
      }
      break;
    case 'list.upsert': {
      check(LISTS.includes(d.list), 'قائمة غير معروفة');
      check(d.item && nonEmpty(d.item.id), 'عنصر بدون معرف');
      const old = state.lists[d.list].get(d.item.id);
      const merged = { ...(old || {}), ...d.item };
      check(nonEmpty(merged.name), 'الاسم مطلوب');
      if (d.list === 'funds') check(merged.type in FUND_TYPES, 'نوع الصندوق غير معروف');
      if (d.list === 'assets') {
        check(merged.kind in ASSET_KINDS, 'نوع الأصل غير معروف');
        check(nonEmpty(merged.unit), 'وحدة الأصل مطلوبة');
        check(state.lists.funds.has(merged.fundId), 'صندوق الأصل غير موجود');
      }
      if (d.list === 'items') check(nonEmpty(merged.unit), 'وحدة الصنف مطلوبة');
      if (d.list === 'purposes' || d.list === 'funds') check(merged.moneyType === undefined || merged.moneyType === null || merged.moneyType === '' || merged.moneyType in MONEY_TYPES, 'نوع المال غير معروف');
      break;
    }
    case 'subscriber.upsert':
      check(nonEmpty(d.id), 'مشترك بدون معرف');
      check(nonEmpty(d.name ?? state.subscribers.get(d.id)?.name), 'اسم المشترك مطلوب');
      break;
    case 'subscription.set':
      check(state.subscribers.has(d.subscriberId), 'المشترك غير موجود');
      check(isMonth(d.from), 'شهر بداية السريان غير صالح');
      check(isNonNeg(d.amount), 'قيمة الاشتراك غير صالحة');
      check(!isLockedMonth(state, d.from), 'لا يمكن تغيير اشتراك داخل سنة مقفولة — التغيير لا يمس الماضي');
      moneyAt(state, d.from, d.amount);
      break;
    case 'family.upsert':
      check(nonEmpty(d.id), 'أسرة بدون معرف');
      check(nonEmpty(d.name ?? state.families.get(d.id)?.name), 'اسم الأسرة مطلوب');
      break;
    case 'family.profile.set': {
      check(state.families.has(d.familyId), 'الأسرة غير موجودة');
      check(isMonth(d.from), 'شهر بداية السريان غير صالح');
      check(!isLockedMonth(state, d.from), 'لا يمكن تغيير ملف أسرة داخل سنة مقفولة — التغيير لا يمس الماضي');
      const p = d.profile;
      check(p && isNonNeg(p.members ?? 0), 'عدد الأفراد غير صالح');
      check(p.status in FAMILY_STATUS, 'حالة الأسرة غير معروفة');
      check(p.monthlyAmount === null || p.monthlyAmount === undefined || isNonNeg(p.monthlyAmount), 'المبلغ الشهري غير صالح');
      check(p.pointsAdjust === undefined || isInt(p.pointsAdjust), 'تعديل النقاط غير صالح');
      for (const c of p.categories || []) check(state.lists.familyCategories.has(c), 'فئة الأسرة غير موجودة');
      moneyAt(state, d.from, p.monthlyAmount);
      break;
    }
    case 'price.set':
      check(state.lists.assets.has(d.assetId), 'الأصل غير موجود');
      check(isDate(d.date), 'تاريخ السعر غير صالح');
      check(isNonNeg(d.price), 'السعر غير صالح');
      moneyAt(state, d.date, d.price);
      break;
    case 'movement.add':
      validateMovement(state, d.movement);
      break;
    case 'movement.void': {
      const mv = state.mvById.get(d.movementId);
      check(!!mv, 'الحركة غير موجودة');
      check(!mv.voided, 'الحركة ملغاة من قبل');
      check(!isLockedDate(state, mv.date), 'الحركة داخل سنة مقفولة — لا يمكن إلغاؤها (سجّل تسوية في السنة الحالية)');
      check(nonEmpty(d.reason), 'اكتب سبب الإلغاء');
      if (!d.replacedBy) checkStock(state, null, mv.id);
      break;
    }
    case 'due.decision': {
      check(d.entity === 'subscriber' || d.entity === 'family', 'نوع غير معروف');
      const exists = d.entity === 'subscriber' ? state.subscribers.has(d.entityId) : state.families.has(d.entityId);
      check(exists, d.entity === 'subscriber' ? 'المشترك غير موجود' : 'الأسرة غير موجودة');
      check(isMonth(d.month), 'الشهر غير صالح');
      check(d.decision === 'writeoff' || d.decision === 'due', 'قرار غير معروف');
      check(isDate(d.date), 'تاريخ القرار غير صالح');
      if (d.decision === 'writeoff') check(nonEmpty(d.reason), 'اكتب سبب «لن يُسدد»');
      break;
    }
    case 'year.close': {
      const next = currentFiscalYear(state);
      check(isInt(d.year) && d.year === next && d.year >= firstFiscalYear(state), `السنة التالية للإقفال هي ${next}`);
      check(!activeClosing(state, d.year), 'السنة مقفولة بالفعل');
      check(d.checkpoint && typeof d.checkpoint === 'object', 'نقطة الإقفال مفقودة');
      break;
    }
    case 'year.reopen':
      check(closedThrough(state) === d.year, 'يمكن التراجع عن آخر سنة مقفولة فقط');
      break;
    case 'family.inkind.set': {
      check(state.families.has(d.familyId), 'الأسرة غير موجودة');
      check(isMonth(d.from), 'شهر بداية السريان غير صالح');
      check(!isLockedMonth(state, d.from), 'لا يمكن تغيير التزام عيني داخل سنة مقفولة — التغيير لا يمس الماضي');
      check(Array.isArray(d.lines), 'بنود الالتزام العيني مطلوبة');
      const seen = new Set();
      const st = stepsAt(state, d.from).qty;
      for (const l of d.lines) {
        check(l && state.lists.items.has(l.itemId), 'الصنف غير موجود');
        check(!seen.has(l.itemId), 'الصنف مكرر في الالتزام — اجمعه في بند واحد');
        seen.add(l.itemId);
        check(isPos(l.qty) && isMultiple(l.qty, st), 'كمية الالتزام يجب أن تكون أكبر من صفر وبالخانات المسموحة');
        for (const a of l.alts || []) {
          check(a && state.lists.items.has(a.itemId), 'الصنف البديل غير موجود');
          check(a.itemId !== l.itemId, 'البديل لا يكون نفس الصنف');
          check(isPos(a.qty) && isMultiple(a.qty, st), 'كمية البديل يجب أن تكون أكبر من صفر وبالخانات المسموحة');
        }
      }
      break;
    }
    case 'need.config.set':
      check(isMonth(d.from), 'شهر بداية سريان الإعداد غير صالح');
      check(isPos(d.version), 'رقم نسخة الإعداد غير صالح');
      check(!(state.needConfigs || []).some((c) => c.version === d.version && c.from !== d.from), 'رقم نسخة الإعداد مستخدم من قبل');
      check(validNeedConfig(d.config), 'إعداد الحاسبة غير صالح (الأدنى ≤ المعتاد ≤ الأعلى، والعتبات مرتبة، والأرقام موجبة)');
      break;
    case 'need.assessment.save': {
      check(nonEmpty(d.id), 'تقييم بدون معرف');
      check(state.families.has(d.familyId), 'الأسرة غير موجودة');
      check(d.status === 'draft' || d.status === 'approved', 'حالة التقييم غير معروفة');
      check(isMonth(d.evalDate), 'شهر التقييم غير صالح');
      check(isDate(d.date), 'تاريخ التقييم غير صالح');
      check(d.input && typeof d.input === 'object' && Array.isArray(d.input.members), 'مدخلات التقييم غير مكتملة');
      check(d.result && isInt(d.result.N) && isInt(d.result.I) && isInt(d.result.G) && d.result.G === d.result.N - d.result.I, 'نتيجة التقييم غير صالحة');
      check(isNonNeg(d.configVersion) && nonEmpty(d.engineVersion), 'نسخة الإعداد والمحرك مطلوبة');
      const old = state.assessments.get(d.id);
      if (old) {
        check(old.familyId === d.familyId, 'لا يمكن نقل تقييم إلى أسرة أخرى');
        check(old.status !== 'approved', 'التقييم المعتمد لا يُعدَّل — أنشئ تقييماً جديداً');
      }
      const c = d.committee || {};
      check(c.estimate === undefined || c.estimate === null || isNonNeg(c.estimate), 'تقدير اللجنة غير صالح');
      check(c.monthly === undefined || c.monthly === null || isNonNeg(c.monthly), 'المبلغ المعتمد غير صالح');
      if (d.status === 'approved') check(isMonth(d.appliedFrom), 'الاعتماد يحتاج شهر بداية السريان');
      break;
    }
    case 'need.file.upsert': {
      check(nonEmpty(d.id), 'ملف بدون معرف');
      const old = state.needFiles.get(d.id);
      const merged = { ...(old || {}), ...d };
      check(merged.kind === 'debt' || merged.kind === 'oneoff', 'نوع الملف غير معروف');
      check(state.families.has(merged.familyId), 'الأسرة غير موجودة');
      check(!old || (old.kind === merged.kind && old.familyId === merged.familyId), 'لا يمكن تغيير نوع الملف أو أسرته');
      check(merged.data && typeof merged.data === 'object', 'بيانات الملف مطلوبة');
      check(['open', 'approved', 'paid', 'rejected', 'closed'].includes(merged.status), 'حالة الملف غير معروفة');
      check(isDate(merged.date), 'تاريخ الملف غير صالح');
      break;
    }
    case 'udhiya.upsert': {
      check(nonEmpty(d.id), 'ذبيحة بدون معرف');
      const u = { ...(state.udhiya.get(d.id) || {}), ...d };
      check(nonEmpty(u.name), 'اسم الذبيحة مطلوب');
      check(isDate(u.date), 'تاريخ الذبيحة غير صالح');
      for (const k of ['price', 'liveWeight', 'meatWeight', 'poorQty']) check(u[k] === undefined || u[k] === null || isNonNeg(u[k]), 'رقم غير صالح في بيانات الذبيحة');
      check((u.poorQty || 0) <= (u.meatWeight || 0) || !u.meatWeight, 'نصيب الفقراء أكبر من وزن اللحم الصافي');
      check(u.totalParts === undefined || u.totalParts === null || isPos(u.totalParts), 'عدد الأسهم الكلي غير صالح');
      for (const c of u.costs || []) check(c && nonEmpty(c.name) && isNonNeg(c.amount), 'بند تكلفة غير صالح');
      let parts = 0;
      const ids = new Set();
      for (const sh of u.shares || []) {
        check(sh && nonEmpty(sh.id) && nonEmpty(sh.name), 'مشترك في الذبيحة بلا اسم');
        check(!ids.has(sh.id), 'مشترك مكرر في الذبيحة');
        ids.add(sh.id);
        check(isPos(sh.parts), 'عدد أسهم المشترك يجب أن يكون أكبر من صفر');
        check(sh.paid === undefined || isNonNeg(sh.paid), 'المدفوع غير صالح');
        parts += sh.parts;
      }
      if (u.totalParts) check(parts <= u.totalParts, 'مجموع أسهم المشتركين أكبر من عدد الأسهم الكلي');
      if (u.itemId) check(state.lists.items.has(u.itemId), 'صنف اللحم غير موجود');
      break;
    }
    default:
      check(false, 'نوع حدث غير معروف');
  }
}
