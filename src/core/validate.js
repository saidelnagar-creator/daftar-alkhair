// التحقق قبل إضافة أي حدث للسجل. يرمي ValidationError برسالة عربية واضحة.
import { ASSET_KINDS, FAMILY_STATUS, FUND_TYPES, MOVEMENT_KINDS } from '../config/defaults.js';
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
};

export function validateEvent(state, ev) {
  check(ev && nonEmpty(ev.id) && nonEmpty(ev.type) && nonEmpty(ev.ts), 'حدث غير مكتمل');
  const d = ev.data || {};
  switch (ev.type) {
    case 'settings.set':
      check(d.key in SETTING_CHECKS, 'إعداد غير معروف');
      check(SETTING_CHECKS[d.key](d.value), 'قيمة الإعداد غير صالحة');
      if (d.key === 'firstFiscalYear') check(closedThrough(state) === null, 'لا يمكن تغيير بداية الدفاتر بعد إقفال سنة');
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
    default:
      check(false, 'نوع حدث غير معروف');
  }
}
