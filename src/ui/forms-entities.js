// نماذج الكيانات: مشترك، اشتراك بتاريخ سريان، أسرة، ملف أسرة بتاريخ سريان، عناصر القوائم، قرار «لن يُسدد».
import { h, clear } from './dom.js';
import { ctx, F } from './ctx.js';
import { openSheet, field, moneyInput, intInput, dateInput, selectInput, textInput, textArea, checkbox, errorBox, toast, monthOptions } from './components.js';
import { ASSET_KINDS, CAMPAIGN_KINDS, FAMILY_PREFERENCES, FAMILY_STATUS, FUND_TYPES, MONEY_TYPES } from '../config/defaults.js';
import { closedThrough, profileAt, requiredAt } from '../core/engine.js';
import { computePoints, suggestedMonthly } from '../core/families.js';
import { addMonths, newId } from '../core/util.js';
import { normalizeDigits } from '../core/money.js';
import { EXPENSE_FUNCTIONS } from '../core/statements.js';

const S = () => ctx.state;
// زر الحفظ يتعطل أثناء التنفيذ حتى لا تُسجَّل الحركة مرتين بنقرة مزدوجة.
function saveBtn(text, onclick) {
  const b = h('button', { class: 'btn primary block', text, type: 'button' });
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    b.disabled = true;
    try {
      await onclick();
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

function showError(err, e) {
  if (e && e.name === 'ValidationError') err.show(e.message);
  else {
    console.error(e);
    err.show('حدث خطأ غير متوقع: ' + (e?.message || e));
  }
}

// الشهور المسموح بدء السريان منها: من أول شهر مفتوح (بعد آخر إقفال) حتى سنتين قادمتين.
export function effectiveMonthSelect(value) {
  const closed = closedThrough(S());
  const now = ctx.nowMonth();
  let from = closed !== null ? `${closed + 1}-01` : addMonths(now, -36);
  if (value && value < from && closed === null) from = value;
  return selectInput(monthOptions(from, addMonths(now, 24)), value && value >= from ? value : now);
}

const parseIntAr = (v) => {
  const s = normalizeDigits(v).trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
};

// ---------- مشترك ----------
export function subscriberForm(sub = null) {
  return new Promise((resolve) => {
    openSheet(
      sub ? 'تعديل بيانات المشترك' : 'مشترك جديد',
      (body, close) => {
        const err = errorBox();
        const name = textInput(sub?.name, 'الاسم');
        const code = textInput(sub?.code, 'كود (اختياري)');
        const phone = h('input', { type: 'tel', value: sub?.phone || '', placeholder: 'هاتف (اختياري)', autocomplete: 'off' });
        const note = textArea(sub?.note, 'ملاحظة');
        const amount = moneyInput(null);
        const from = effectiveMonthSelect(ctx.nowMonth());
        const archived = checkbox('مؤرشف (لا يظهر في القوائم)', !!sub?.archived);
        const save = async () => {
          if (!name.value.trim()) return err.show('اكتب اسم المشترك');
          const id = sub?.id || newId('s');
          try {
            await ctx.store.run((book) => {
              const now = new Date();
              book.dispatch('subscriber.upsert', { id, name: name.value.trim(), code: code.value.trim(), phone: phone.value.trim(), note: note.value.trim(), archived: archived.input.checked }, { now });
              const amt = amount.units();
              if (!sub && amt && amt > 0) book.dispatch('subscription.set', { subscriberId: id, from: from.value, amount: amt }, { now });
            });
            toast('تم الحفظ');
            close(id);
          } catch (e) {
            showError(err, e);
          }
        };
        body.append(err, field('الاسم', name), h('div', { class: 'grid2' }, field('الكود', code), field('الهاتف', phone)));
        if (!sub) body.append(h('div', { class: 'grid2' }, field('الاشتراك الشهري (جنيه)', amount, 'اتركه فارغاً لمتبرع بلا اشتراك'), field('يبدأ من شهر', from)));
        body.append(field('ملاحظة', note), sub ? archived : null, saveBtn('حفظ', save));
      },
      { onClose: (result) => resolve(result || null) },
    );
  });
}

// تغيير/بدء/إيقاف الاشتراك من شهر محدد (لا يمس الماضي).
export function subscriptionForm(subscriberId) {
  const sub = S().subscribers.get(subscriberId);
  openSheet(`اشتراك ${sub.name}`, (body, close) => {
    const err = errorBox();
    const from = effectiveMonthSelect(ctx.nowMonth());
    const cur = requiredAt(S(), subscriberId, ctx.nowMonth());
    const amount = moneyInput(cur || null);
    const save = async () => {
      const amt = amount.units() ?? 0;
      if (amt < 0) return err.show('القيمة غير صالحة');
      try {
        await ctx.store.dispatch('subscription.set', { subscriberId, from: from.value, amount: amt });
        toast(amt === 0 ? 'تم إيقاف الاشتراك من الشهر المحدد' : 'تم تغيير الاشتراك');
        close(true);
      } catch (e) {
        showError(err, e);
      }
    };
    body.append(
      err,
      h('div', { class: 'muted small', style: { marginBottom: '10px' }, text: `الاشتراك الحالي: ${cur ? F.egp(cur) : 'لا يوجد'} — التغيير يسري من الشهر الذي تختاره ولا يمس ما قبله.` }),
      field('يسري من شهر', from),
      field('قيمة الاشتراك الشهري (جنيه)', amount, 'صفر أو فارغ = إيقاف الاشتراك من هذا الشهر'),
      saveBtn('حفظ', save),
    );
  });
}

// ---------- أسرة ----------
export function familyForm(fam = null) {
  return new Promise((resolve) => {
    openSheet(
      fam ? 'تعديل بيانات الأسرة' : 'أسرة جديدة',
      (body, close) => {
        const err = errorBox();
        const name = textInput(fam?.name, 'اسم الأسرة / العائل');
        const code = textInput(fam?.code, 'كود (اختياري)');
        const phone = h('input', { type: 'tel', value: fam?.phone || '', placeholder: 'هاتف (اختياري)', autocomplete: 'off' });
        const address = textInput(fam?.address, 'العنوان (اختياري)');
        const note = textArea(fam?.note, 'ملاحظة');
        const archived = checkbox('مؤرشفة (لا تظهر في القوائم)', !!fam?.archived);
        const save = async () => {
          if (!name.value.trim()) return err.show('اكتب اسم الأسرة');
          const id = fam?.id || newId('f');
          try {
            await ctx.store.dispatch('family.upsert', { id, name: name.value.trim(), code: code.value.trim(), phone: phone.value.trim(), address: address.value.trim(), note: note.value.trim(), archived: archived.input.checked });
            toast('تم الحفظ');
            close(id);
          } catch (e) {
            showError(err, e);
          }
        };
        body.append(err, field('الاسم', name), h('div', { class: 'grid2' }, field('الكود', code), field('الهاتف', phone)), field('العنوان', address), field('ملاحظة', note), fam ? archived : null, saveBtn(fam ? 'حفظ' : 'حفظ ثم ملف الأسرة', save));
      },
      { onClose: (result) => resolve(result || null) },
    );
  });
}

// ملف الأسرة بتاريخ سريان: الأفراد، نقاط الاستحقاق، الحالة، المبلغ الشهري.
export function familyProfileForm(familyId) {
  const fam = S().families.get(familyId);
  const cur = profileAt(S(), familyId, ctx.nowMonth()) || fam.profiles[fam.profiles.length - 1] || {};
  const crit = S().settings.criteria;
  openSheet(`ملف ${fam.name}`, (body, close) => {
    const err = errorBox();
    const from = effectiveMonthSelect(ctx.nowMonth());
    const members = intInput(cur.members ?? '');
    const need = selectInput(crit.needLevels.map((l) => ({ value: l.id, label: `${l.name} (+${l.points})` })), cur.needLevel || '', { placeholder: 'غير محدد' });
    const flags = crit.flags.map((f) => Object.assign(checkbox(`${f.name} (+${f.points})`, (cur.flags || []).includes(f.id)), { fid: f.id }));
    const adjust = h('input', { type: 'text', inputMode: 'text', value: cur.pointsAdjust || '', placeholder: '0', autocomplete: 'off' });
    const status = selectInput(Object.entries(FAMILY_STATUS).map(([value, label]) => ({ value, label })), cur.status || 'permanent');
    const monthly = moneyInput(cur.monthlyAmount ?? null);
    const pref = selectInput(FAMILY_PREFERENCES.map((p) => ({ value: p, label: p })), cur.preference || '', { placeholder: 'غير محدد' });
    const cats = [...S().lists.familyCategories.values()].filter((c) => !c.archived).map((c) => Object.assign(checkbox(c.name, (cur.categories || []).includes(c.id)), { cid: c.id }));
    const points = h('div', { class: 'preview' });
    const profile = () => ({
      members: parseIntAr(members.value || '0') ?? 0,
      needLevel: need.value || null,
      flags: flags.filter((f) => f.input.checked).map((f) => f.fid),
      pointsAdjust: parseIntAr(adjust.value || '0') ?? 0,
      status: status.value,
      monthlyAmount: monthly.units(),
      preference: pref.value || null,
      categories: cats.filter((c) => c.input.checked).map((c) => c.cid),
    });
    const draw = () => {
      const p = profile();
      const pts = computePoints(crit, p);
      const sug = suggestedMonthly(S(), p, from.value);
      clear(points);
      points.append(h('div', { class: 'pl' }, h('span', { text: 'نقاط الاستحقاق' }), h('span', { class: 'num', text: F.num(pts) })));
      points.append(h('div', { class: 'pl' }, h('span', { text: 'الدعم الشهري المقترح (النقاط × قيمة النقطة)' }), h('span', { class: 'num', text: F.money(sug) })));
      monthly.placeholder = `المقترح ${F.money(sug)}`;
    };
    body.addEventListener('input', draw);
    body.addEventListener('change', draw);
    const save = async () => {
      const p = profile();
      if (parseIntAr(members.value || '0') === null) return err.show('عدد الأفراد غير صالح');
      if (monthly.value.trim() !== '' && p.monthlyAmount === null) return err.show('المبلغ الشهري غير صالح');
      try {
        await ctx.store.dispatch('family.profile.set', { familyId, from: from.value, profile: p });
        toast('تم تحديث ملف الأسرة');
        close(true);
      } catch (e) {
        showError(err, e);
      }
    };
    body.append(
      err,
      h('div', { class: 'muted small', style: { marginBottom: '10px' }, text: 'التحديث يسري من الشهر الذي تختاره ولا يمس ما قبله.' }),
      h('div', { class: 'grid2' }, field('يسري من شهر', from), field('الحالة', status)),
      h('div', { class: 'grid2' }, field('عدد الأفراد', members), field('درجة الاحتياج', need)),
      h('div', { class: 'field' }, h('div', { class: 'label', text: 'حالات تزيد النقاط' }), flags),
      field('تعديل يدوي للنقاط (+/−)', adjust),
      points,
      field('المبلغ الشهري (جنيه)', monthly, 'اتركه فارغاً لاستخدام المقترح من النقاط. يُحتسب للأسر ذات «المساعدة الدائمة» فقط.'),
      field('رغبتهم', pref),
      cats.length ? h('div', { class: 'field' }, h('div', { class: 'label', text: 'الفئات' }), cats) : null,
      saveBtn('حفظ', save),
    );
    draw();
  });
}

// ---------- عناصر القوائم (صندوق / حملة / غرض / نوع مصروف / صنف / فئة / أصل) ----------
export const LIST_INFO = {
  funds: { title: 'الصناديق', one: 'صندوق', prefix: 'fund-' },
  campaigns: { title: 'الحملات والمشروعات', one: 'حملة / مشروع', prefix: 'k-' },
  purposes: { title: 'أغراض التبرع والصرف', one: 'غرض', prefix: 'p-' },
  expenseTypes: { title: 'أنواع المصروفات', one: 'نوع مصروف', prefix: 'x-' },
  items: { title: 'أصناف المخزن', one: 'صنف', prefix: 'i-' },
  familyCategories: { title: 'فئات الأسر', one: 'فئة', prefix: 'c-' },
  assets: { title: 'الأصول', one: 'أصل', prefix: 'a-' },
};

export function listItemForm(listName, item = null, defaults = {}) {
  return new Promise((resolve) => {
    const info = LIST_INFO[listName];
    openSheet(
      item ? `تعديل ${info.one}` : `${info.one} جديد`,
      (body, close) => {
        const err = errorBox();
        const name = textInput(item?.name, 'الاسم');
        const extra = [];
        let type;
        let kind;
        let unit;
        let fund;
        if (listName === 'funds') {
          type = selectInput(Object.entries(FUND_TYPES).filter(([k]) => !['campaigns', 'earmarked'].includes(k) || item?.type === k).map(([value, label]) => ({ value, label })), item?.type || 'other');
          if (!item?.builtin) extra.push(field('نوع الصندوق', type));
        }
        if (listName === 'campaigns') {
          kind = selectInput(CAMPAIGN_KINDS.map((k) => ({ value: k, label: k })), item?.kind || CAMPAIGN_KINDS[0]);
          extra.push(field('النوع', kind));
        }
        let moneyType;
        if (listName === 'purposes' || listName === 'funds') {
          moneyType = selectInput(Object.entries(MONEY_TYPES).map(([value, label]) => ({ value, label })), item?.moneyType || '', { placeholder: listName === 'funds' ? 'مختلط / غير محدد' : 'غير محدد' });
          extra.push(field('نوع المال', moneyType, 'لتنبيه شاشة الصرف إذا صُرفت زكاة لمن لا تحل له'));
        }
        let func;
        if (listName === 'expenseTypes') {
          func = selectInput(Object.entries(EXPENSE_FUNCTIONS).map(([value, label]) => ({ value, label })), item?.function || (item?.id === 'x-admin' ? 'admin' : 'program'));
          extra.push(field('التصنيف الوظيفي', func, 'يحدد نسبة المصروفات الإدارية في «قائمة الأنشطة»'));
        }
        if (listName === 'items') {
          unit = textInput(item?.unit, 'كجم / قطعة / كرتونة…');
          extra.push(field('وحدة القياس', unit));
        }
        if (listName === 'assets') {
          kind = selectInput(Object.entries(ASSET_KINDS).map(([value, label]) => ({ value, label })), item?.kind || defaults.kind || 'gold');
          unit = textInput(item?.unit || (item ? '' : 'جرام'), 'جرام / جنيه ذهب / دولار / حصة…');
          fund = selectInput([...S().lists.funds.values()].filter((f) => !f.archived && !['campaigns', 'earmarked', 'store'].includes(f.id)).map((f) => ({ value: f.id, label: f.name })), item?.fundId || defaults.fundId || 'gold');
          kind.addEventListener('change', () => {
            if (!item) fund.value = kind.value === 'gold' ? 'gold' : 'invest';
          });
          extra.push(h('div', { class: 'grid2' }, field('النوع', kind), field('الوحدة', unit)), field('يتبع صندوق', fund));
        }
        const archived = checkbox('مؤرشف (لا يظهر في قوائم الاختيار)', !!item?.archived);
        const save = async () => {
          if (!name.value.trim()) return err.show('اكتب الاسم');
          const data = { id: item?.id || newId(info.prefix), name: name.value.trim() };
          if (type && !item?.builtin) data.type = type.value;
          if (kind) data.kind = kind.value;
          if (unit) data.unit = unit.value.trim();
          if (fund) data.fundId = fund.value;
          if (func) data.function = func.value;
          if (moneyType && (moneyType.value || item?.moneyType)) data.moneyType = moneyType.value || null;
          if (item) data.archived = archived.input.checked;
          try {
            await ctx.store.dispatch('list.upsert', { list: listName, item: data });
            toast('تم الحفظ');
            close(data.id);
          } catch (e) {
            showError(err, e);
          }
        };
        body.append(err, field('الاسم', name), extra, item && !item.builtin ? archived : null, saveBtn('حفظ', save));
      },
      { onClose: (result) => resolve(result || null) },
    );
  });
}

// ---------- قرار على متأخر: «لن يُسدد» بتاريخ وسبب، أو إرجاعه مطلوباً ----------
export function dueDecisionForm({ entity, entityId, month, current }) {
  return new Promise((resolve) => {
    const isFam = entity === 'family';
    const who = isFam ? S().families.get(entityId)?.name : S().subscribers.get(entityId)?.name;
    openSheet(
      `${who} — ${F.month(month)}`,
      (body, close) => {
        const err = errorBox();
        const send = async (decision, reason, date) => {
          try {
            await ctx.store.dispatch('due.decision', { entity, entityId, month, decision, date, reason });
            toast(decision === 'writeoff' ? (isFam ? 'سُجّل: لن يُصرف' : 'سُجّل: لن يُسدد') : 'أُعيد كمطلوب');
            close(true);
          } catch (e) {
            showError(err, e);
          }
        };
        if (current === 'writeoff') {
          body.append(err, h('p', { class: 'muted', text: isFam ? 'هذا الشهر مسجَّل «لن يُصرف».' : 'هذا الشهر مسجَّل «لن يُسدد».' }), saveBtn('إرجاعه كمطلوب', () => send('due', '', ctx.today())));
          return;
        }
        const reason = textInput('', 'السبب (مطلوب)');
        const date = dateInput();
        body.append(
          err,
          h('p', { class: 'muted', text: isFam ? 'سيخرج هذا الشهر من استحقاقات الأسرة المتبقية.' : 'سيخرج هذا الشهر من المتأخرات ولن يُطالَب به، ويبقى القرار مسجلاً بتاريخه وسببه.' }),
          field('السبب', reason),
          field('تاريخ القرار', date),
          h('button', { class: 'btn danger block', type: 'button', text: isFam ? 'تسجيل «لن يُصرف»' : 'تسجيل «لن يُسدد»', onclick: () => send('writeoff', reason.value.trim(), date.value) }),
        );
      },
      { onClose: (result) => resolve(!!result) },
    );
  });
}
