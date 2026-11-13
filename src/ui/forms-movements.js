// نماذج إدخال الحركات (نوافذ سفلية). كل حفظ يمر من store.run ← Book (تحقق ثم إلحاق).
// عند التعديل (initial) يُستبدل: إلغاء القديمة + حركة جديدة مرتبطة بها.
import { h, clear } from './dom.js';
import { ctx, F, RULE } from './ctx.js';
import { openSheet, field, moneyInput, qtyInput, assetQtyInput, dateInput, selectInput, textInput, textArea, checkbox, errorBox, toast, confirmDialog, pickFromList, badge, monthOptions } from './components.js';
import { acctLabel, isLockedDate, requiredAt, targetAcct } from '../core/engine.js';
import { computeLedger, acctBalance, fundCash, assetPosition, itemPosition, cashPostings } from '../core/ledger.js';
import { suggestAllocation, suggestAmount, arrearsFor, firstMonthOf } from '../core/subscriptions.js';
import { suggestFamilyAllocation, suggestFamilyAmount, familyDues, entitlementAt, familyMonthStatus } from '../core/families.js';
import { addMonths, ymOf } from '../core/util.js';
import { distributionWarnings } from '../core/need.js';
import { ASSET, mulDiv, roundToStep } from '../core/money.js';

const S = () => ctx.state;
const active = (map) => [...map.values()].filter((x) => !x.archived);

// خيارات الحسابات النقدية: الصناديق، الحملات، والأمانات ذات الرصيد.
export function acctOptions({ withBalance = true, earmarks = true } = {}) {
  const led = computeLedger(S());
  const lab = (name, bal) => (withBalance ? `${name} — ${F.money(bal)}` : name);
  const funds = active(S().lists.funds)
    .filter((f) => !['campaigns', 'earmarked'].includes(f.id) || acctBalance(led, f.id) !== 0)
    .map((f) => ({ value: f.id, label: lab(f.name, acctBalance(led, f.id)) }));
  const out = [{ group: 'الصناديق', options: funds }];
  const camps = active(S().lists.campaigns).map((c) => {
    const a = targetAcct({ type: 'campaign', id: c.id });
    return { value: a, label: lab(c.name, acctBalance(led, a)) };
  });
  if (camps.length) out.push({ group: 'الحملات والمشروعات', options: camps });
  if (earmarks) {
    const em = [...led.cash].filter(([a, v]) => a.startsWith('earmarked#') && v !== 0).map(([a, v]) => ({ value: a, label: lab(acctLabel(S(), a), v) }));
    if (em.length) out.push({ group: 'الأمانات (توصيل لجهة محددة)', options: em });
  }
  return out;
}

// خيارات جهة التخصيص لبند «مخصص».
function targetOptions({ exclude = null } = {}) {
  const enc = (type, id) => `${type}|${id}`;
  const out = [];
  void exclude;
  const cats = active(S().lists.familyCategories).map((c) => ({ value: enc('category', c.id), label: `فئة: ${c.name}` }));
  if (cats.length) out.push({ group: 'لفئة', options: cats });
  const camps = active(S().lists.campaigns).map((c) => ({ value: enc('campaign', c.id), label: `حملة: ${c.name}` }));
  if (camps.length) out.push({ group: 'لحملة / مشروع', options: camps });
  const funds = active(S().lists.funds)
    .filter((f) => !['general', 'campaigns', 'earmarked'].includes(f.id))
    .map((f) => ({ value: enc('fund', f.id), label: `صندوق: ${f.name}` }));
  if (funds.length) out.push({ group: 'لصندوق', options: funds });
  const fams = active(S().families).map((f) => ({ value: enc('family', f.id), label: `أسرة: ${f.name}` }));
  if (fams.length) out.push({ group: 'لأسرة بعينها', options: fams });
  return out;
}
const decTarget = (v) => {
  const [type, id] = String(v).split('|');
  return type && id ? { type, id } : null;
};
const encTarget = (t) => (t ? `${t.type}|${t.id}` : '');

const purposeOptions = () => active(S().lists.purposes).map((p) => ({ value: p.id, label: p.name }));
const itemOptions = () => active(S().lists.items).map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }));

function showError(err, e) {
  if (e && e.name === 'ValidationError') err.show(e.message);
  else {
    console.error(e);
    err.show('حدث خطأ غير متوقع: ' + (e?.message || e));
  }
}

// تحذير قبل جعل رصيد حساب سالباً.
async function confirmOverdraft(mv) {
  const led = computeLedger(S());
  for (const [acct, delta] of cashPostings(mv)) {
    if (delta >= 0) continue;
    const bal = acctBalance(led, acct);
    if (bal + delta < 0) {
      const ok = await confirmDialog({ title: 'الرصيد لا يكفي', message: `رصيد «${acctLabel(S(), acct)}» الحالي ${F.egp(bal)} وسيصبح ${F.egp(bal + delta)}.\nهل تريد المتابعة؟`, okText: 'متابعة', danger: true });
      if (!ok) return false;
    }
  }
  return true;
}

// حفظ حركة (جديدة أو تعديل).
async function saveMovement(mv, { initial, err, close, skipOverdraft = false, extraEvents = null, message = 'تم الحفظ' }) {
  try {
    if (!skipOverdraft && !initial && !(await confirmOverdraft(mv))) return false;
    await ctx.store.run((book) => {
      const now = new Date();
      const saved = initial ? book.replaceMovement(initial.id, mv, 'تعديل', ctx.today(), { now }) : book.addMovement(mv, { now });
      if (extraEvents) for (const [type, data] of extraEvents(saved)) book.dispatch(type, data, { now });
      return saved;
    });
    toast(initial ? 'تم التعديل' : message);
    close(true);
    return true;
  } catch (e) {
    showError(err, e);
    return false;
  }
}

const noteField = (v) => textArea(v, 'ملاحظة (اختياري)');
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
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// ====================== محرر بنود التخصيص ======================
// kinds: [{value,label}] — للدفعة: month/extra/earmark، وللصرف: month/extra.
function linesEditor({ kinds, monthKind, getLines, onChange }) {
  const box = h('div', {});
  let lines = [];
  const render = () => {
    clear(box);
    const wrap = h('div', { class: 'lines' });
    lines.forEach((l, i) => {
      const kindSel = selectInput(kinds, l.ui);
      const amt = moneyInput(l.amount, '');
      const rm = h('button', { class: 'rm', type: 'button', text: '×', 'aria-label': 'حذف البند' });
      const extra = h('div', { class: 'extra' });
      const drawExtra = () => {
        clear(extra);
        if (l.ui === 'month') {
          const now = ctx.nowMonth();
          let from = addMonths(now, -36);
          if (l.month && l.month < from) from = l.month;
          const ms = selectInput(monthOptions(from, addMonths(now, 24)), l.month || now);
          l.month = ms.value;
          ms.addEventListener('change', () => {
            l.month = ms.value;
            onChange(lines, true);
          });
          extra.append(ms);
        } else if (l.ui === 'earmark') {
          const ts = selectInput(targetOptions(), encTarget(l.target), { placeholder: 'اختر جهة التخصيص…' });
          ts.addEventListener('change', () => {
            l.target = decTarget(ts.value);
            onChange(lines, true);
          });
          extra.append(ts);
        }
        if (l.ui !== 'month' || monthKind === 'entitlement') {
          const ps = selectInput(purposeOptions(), l.purposeId || '', { placeholder: 'الغرض (اختياري)' });
          ps.addEventListener('change', () => {
            l.purposeId = ps.value || undefined;
            onChange(lines, true);
          });
          extra.append(ps);
        }
      };
      kindSel.addEventListener('change', () => {
        l.ui = kindSel.value;
        drawExtra();
        onChange(lines, true);
      });
      amt.addEventListener('input', () => {
        l.amount = amt.units();
        onChange(lines, true);
      });
      rm.addEventListener('click', () => {
        lines.splice(i, 1);
        render();
        onChange(lines, true);
      });
      drawExtra();
      wrap.append(h('div', { class: 'line' }, h('div', { class: 'grid' }, kindSel, amt, rm), extra));
    });
    box.append(lines.length ? wrap : h('div', { class: 'muted small', text: 'لا توجد بنود' }));
    box.append(
      h('button', {
        class: 'btn small',
        type: 'button',
        text: '+ بند',
        onclick: () => {
          lines.push({ ui: kinds[kinds.length > 1 ? 1 : 0].value, amount: null });
          render();
          onChange(lines, true);
        },
      }),
    );
  };
  box.set = (ls) => {
    lines = ls;
    render();
  };
  box.get = () => lines;
  void getLines;
  return box;
}

// تحويل بنود الواجهة إلى بنود الدفتر (والعكس).
function receiptLinesOut(ui, date) {
  const pm = ymOf(date);
  return ui.map((l) => {
    if (l.ui === 'month') return strip({ kind: l.month > pm ? 'advance' : 'sub', month: l.month, amount: l.amount, purposeId: l.purposeId });
    if (l.ui === 'earmark') return strip({ kind: 'earmark', amount: l.amount, target: l.target, purposeId: l.purposeId });
    return strip({ kind: 'extra', month: l.month, amount: l.amount, purposeId: l.purposeId });
  });
}
const receiptLinesIn = (lines) => lines.map((l) => ({ ui: l.kind === 'sub' || l.kind === 'advance' ? 'month' : l.kind, month: l.month, amount: l.amount, target: l.target, purposeId: l.purposeId }));

function lineText(l, payMonth) {
  if (l.ui === 'month') return `${F.month(l.month)}${l.month > payMonth ? ' (مقدم)' : ''}`;
  if (l.ui === 'earmark') return l.target ? acctLabel(S(), targetAcct(l.target)) : 'مخصص';
  if (l.ui === 'entitlement') return `استحقاق ${F.month(l.month)}`;
  return 'زيادة عامة';
}

// ====================== دفعة / تبرع نقدي ======================
// subscriberId: مشترك محدد (سداد اشتراك). بدون مشترك: تبرع من متبرع آخر.
export function receiptForm({ subscriberId = null, initial = null, preset = {} } = {}) {
  return new Promise((resolve) => {
    const init = initial;
    if (init && init.payer.type === 'subscriber') subscriberId = init.payer.id;
    const isSub = !!subscriberId;
    const sub = isSub ? S().subscribers.get(subscriberId) : null;
    openSheet(
      init ? 'تعديل دفعة' : isSub ? `دفعة: ${sub.name}` : 'تبرع نقدي',
      (body, close) => {
        const err = errorBox();
        const date = dateInput(init?.date);
        const amount = moneyInput(init?.amount ?? (isSub ? suggestAmount(S(), subscriberId, date.value) : preset.amount ?? null));
        const fund = selectInput(acctOptions({ earmarks: false }), init?.acct || preset.acct || 'general');
        const name = textInput(init?.payer?.name || '', 'اسم المتبرع (اختياري)');
        const note = noteField(init?.note);
        const kinds = isSub
          ? [
              { value: 'month', label: 'اشتراك / مقدم (شهر)' },
              { value: 'extra', label: 'زيادة عامة' },
              { value: 'earmark', label: 'مخصص' },
            ]
          : [
              { value: 'extra', label: 'تبرع عام' },
              { value: 'earmark', label: 'مخصص' },
            ];
        let manual = !!init;
        const preview = h('div', { class: 'preview' });
        const summary = h('div', { class: 'line-summary' });
        const editorWrap = h('div', { style: { display: init ? '' : 'none' } });
        const drawPreview = (lines) => {
          clear(preview);
          const pm = ymOf(date.value);
          if (!lines.length) preview.append(h('div', { class: 'muted', text: 'أدخل المبلغ ليظهر التخصيص' }));
          // نعرض أول البنود فقط حتى يبقى زر الحفظ ظاهراً دون تمرير
          const shown = lines.length > 6 ? lines.slice(0, 5) : lines;
          for (const l of shown) preview.append(h('div', { class: 'pl' }, h('span', { text: lineText(l, pm) }), h('span', { class: 'num', text: F.money(l.amount ?? 0) })));
          if (shown.length < lines.length) {
            const rest = lines.slice(shown.length);
            preview.append(h('div', { class: 'pl muted' }, h('span', { text: `… و${F.num(rest.length)} بنود أخرى حتى ${lineText(rest[rest.length - 1], pm)}` }), h('span', { class: 'num', text: F.money(rest.reduce((a, l) => a + (l.amount || 0), 0)) })));
          }
          const total = lines.reduce((a, l) => a + (l.amount || 0), 0);
          const amt = amount.units() || 0;
          clear(summary);
          summary.append(h('span', { class: total === amt ? 'muted' : 'neg', text: total === amt ? `مجموع البنود ${F.money(total)}` : `مجموع البنود ${F.money(total)} ≠ المبلغ ${F.money(amt)}` }));
          summary.append(
            h('button', {
              class: 'link',
              type: 'button',
              text: manual ? 'اقتراح تلقائي' : 'تعديل التخصيص',
              onclick: () => {
                if (manual) {
                  manual = false;
                  resuggest();
                } else {
                  editorWrap.style.display = '';
                  manual = true;
                  drawPreview(editor.get());
                }
              },
            }),
          );
        };
        const editor = linesEditor({
          kinds,
          monthKind: 'sub',
          onChange: (lines, userEdit) => {
            if (userEdit) manual = true;
            drawPreview(lines);
          },
        });
        const resuggest = () => {
          const amt = amount.units();
          let lines = [];
          if (amt && amt > 0) {
            if (isSub) lines = receiptLinesIn(suggestAllocation(S(), subscriberId, amt, date.value));
            else if (preset.target) lines = [{ ui: 'earmark', amount: amt, target: preset.target }];
            else lines = [{ ui: 'extra', amount: amt }];
          }
          editor.set(lines);
          drawPreview(lines);
        };
        if (init) {
          editor.set(receiptLinesIn(init.lines));
          drawPreview(editor.get());
        } else resuggest();
        amount.addEventListener('input', () => {
          if (!manual) resuggest();
          else drawPreview(editor.get());
        });
        date.addEventListener('change', () => {
          if (!manual) resuggest();
          else drawPreview(editor.get());
        });

        const save = async () => {
          err.show('');
          const amt = amount.units();
          if (!amt || amt <= 0) return err.show(RULE.money());
          const ui = editor.get();
          if (ui.some((l) => !l.amount || l.amount <= 0)) return err.show(`كل بند يحتاج مبلغاً أكبر من صفر (${RULE.money()})`);
          if (ui.some((l) => l.ui === 'earmark' && !l.target)) return err.show('اختر جهة التخصيص للبند المخصص');
          const mv = strip({
            kind: 'receipt',
            date: date.value,
            payer: isSub ? { type: 'subscriber', id: subscriberId } : strip({ type: 'other', name: name.value.trim() || 'متبرع' }),
            amount: amt,
            acct: fund.value,
            lines: receiptLinesOut(ui, date.value),
            note: note.value.trim(),
          });
          await saveMovement(mv, { initial: init, err, close });
        };

        const quick = h('div', { class: 'chips' });
        if (isSub) {
          const due = arrearsFor(S(), subscriberId, ctx.nowMonth());
          const dueTotal = due.reduce((a, m) => a + m.remaining, 0);
          body.append(h('div', { class: 'muted small', style: { marginBottom: '8px' } }, dueTotal > 0 ? `متأخر: ${F.num(due.length)} شهر — ${F.egp(dueTotal)}` : 'لا متأخرات'));
          const setAmount = (v) => {
            amount.setUnits(v);
            manual = false;
            resuggest();
          };
          const monthly = requiredAt(S(), subscriberId, ctx.nowMonth());
          if (!init && monthly) {
            quick.append(h('button', { class: 'chip', type: 'button', text: `شهر ${F.money(monthly)}`, onclick: () => setAmount(monthly) }));
            quick.append(h('button', { class: 'chip', type: 'button', text: `٣ شهور ${F.money(monthly * 3)}`, onclick: () => setAmount(monthly * 3) }));
          }
          if (!init && due.length > 1) quick.append(h('button', { class: 'chip', type: 'button', text: `كل المتأخر ${F.money(dueTotal)}`, onclick: () => setAmount(dueTotal) }));
        }
        body.append(err, field('المبلغ (جنيه)', amount), quick.childNodes.length ? quick : null, preview, summary, saveBtn(init ? 'حفظ التعديل' : 'حفظ', save));
        body.append(h('div', { class: 'section-title' }, h('span', { text: 'تفاصيل' })));
        body.append(editorWrap);
        editorWrap.append(h('div', { class: 'label muted small', text: 'بنود التخصيص' }), editor);
        if (!isSub) body.append(field('المتبرع', name));
        body.append(h('div', { class: 'grid2' }, field('التاريخ', date), field('يدخل صندوق', fund)), field('ملاحظة', note));
      },
      { onClose: (result) => resolve(!!result) },
    );
  });
}

// تدفق «الدفعة المعتادة»: اختر المشترك ← (المبلغ والتخصيص مقترحان) ← حفظ.
export async function paymentFlow() {
  const now = ctx.nowMonth();
  const items = [...S().subscribers.values()]
    .filter((s) => !s.archived)
    .map((s) => {
      const due = arrearsFor(S(), s.id, now);
      const total = due.reduce((a, m) => a + m.remaining, 0);
      return { id: s.id, title: s.name, subtitle: due.length ? `متأخر ${F.num(due.length)} شهر` : firstMonthOf(S(), s.id) ? 'منتظم' : 'بلا اشتراك', value: total ? F.money(total) : '', valueClass: 'neg', due: total };
    })
    .sort((a, b) => (b.due > 0) - (a.due > 0) || a.title.localeCompare(b.title, 'ar', { numeric: true }));
  if (!items.length) {
    toast('أضف مشتركاً أولاً من تبويب المشتركين');
    return false;
  }
  const id = await pickFromList({ title: 'دفعة اشتراك — اختر المشترك', items });
  if (!id) return false;
  return receiptForm({ subscriberId: id });
}

// ====================== صرف لأسرة (نقدي و/أو عيني) ======================
export function distributionForm({ familyId = null, initial = null } = {}) {
  return new Promise((resolve) => {
    const init = initial;
    openSheet(
      init ? 'تعديل صرف' : 'صرف لأسرة',
      (body, close) => {
        const err = errorBox();
        const fams = active(S().families).sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true }));
        const family = selectInput([{ value: '', label: 'مستفيد آخر (بدون أسرة مسجلة)' }, ...fams.map((f) => ({ value: f.id, label: f.name }))], init ? init.familyId || '' : familyId || '');
        const beneficiary = textInput(init?.beneficiary || '', 'اسم المستفيد / الجهة');
        const benField = field('المستفيد', beneficiary);
        const date = dateInput(init?.date);
        const amount = moneyInput(init?.amount ?? null);
        const acct = selectInput(acctOptions(), init?.acct || 'general');
        const note = noteField(init?.note);
        const summary = h('div', { class: 'line-summary' });
        let manual = !!init;
        const editor = linesEditor({
          kinds: [
            { value: 'month', label: 'استحقاق شهر' },
            { value: 'extra', label: 'إضافة عامة' },
          ],
          monthKind: 'entitlement',
          onChange: (lines, userEdit) => {
            if (userEdit) manual = true;
            drawSummary(lines);
          },
        });
        const drawSummary = (lines) => {
          clear(summary);
          const total = lines.reduce((a, l) => a + (l.amount || 0), 0);
          const amt = amount.units() || 0;
          summary.append(h('span', { class: total === amt ? 'muted' : 'neg', text: total === amt ? `مجموع البنود ${F.money(total)}` : `مجموع البنود ${F.money(total)} ≠ المبلغ ${F.money(amt)}` }));
          if (manual) summary.append(h('button', { class: 'link', type: 'button', text: 'اقتراح تلقائي', onclick: () => ((manual = false), resuggest()) }));
        };
        const resuggest = () => {
          const amt = amount.units();
          let lines = [];
          if (amt && amt > 0) {
            lines = family.value ? suggestFamilyAllocation(S(), family.value, amt, date.value).map((l) => ({ ui: l.kind === 'entitlement' ? 'month' : 'extra', month: l.month, amount: l.amount })) : [{ ui: 'extra', amount: amt }];
          }
          editor.set(lines);
          drawSummary(lines);
        };
        const info = h('div', { class: 'muted small', style: { marginBottom: '8px' } });
        const quick = h('div', { class: 'chips' });
        const amanaInfo = h('div', { class: 'banner info', style: { display: 'none' } });
        const warnBox = h('div', {});
        // تنبيهات لا تمنع الحفظ: زكاة لمن لا تحل له، أو تجاوز العجز المعتمد في آخر تقييم
        const currentMv = () => ({ kind: 'distribution', date: date.value, familyId: family.value || null, acct: acct.value, amount: amount.units() || 0, replaces: init?.id, lines: editor.get().filter((l) => l.amount > 0).map((l) => ({ kind: l.ui === 'month' ? 'entitlement' : 'extra', amount: l.amount, purposeId: l.purposeId })) });
        const drawWarnings = () => {
          clear(warnBox);
          for (const w of distributionWarnings(S(), currentMv())) warnBox.append(h('div', { class: 'banner', role: 'alert', text: w.cap !== undefined ? `${w.text} (مصروف الشهر ${F.egp(w.spent)} — العجز المعتمد ${F.egp(w.cap)})` : w.text }));
        };
        // أمانة باسم الأسرة: تظهر كمصدر الصرف تلقائياً
        const onAmana = () => {
          amanaInfo.style.display = 'none';
          if (!family.value || init) return;
          const a = `earmarked#family:${family.value}`;
          const bal = acctBalance(computeLedger(S()), a);
          if (bal <= 0) {
            if (acct.value.startsWith('earmarked#family:')) acct.value = 'general';
            return;
          }
          if (![...acct.options].some((o) => o.value === a)) return;
          acct.value = a;
          amanaInfo.textContent = `لهذه الأسرة أمانة باسمها ${F.egp(bal)} — الصرف يُخصم منها (غيّر «يُصرف من» إن أردت مصدراً آخر).`;
          amanaInfo.style.display = '';
        };
        const onFamily = () => {
          benField.style.display = family.value ? 'none' : '';
          clear(info);
          clear(quick);
          onAmana();
          if (family.value) {
            const month = ymOf(date.value);
            const ent = entitlementAt(S(), family.value, month);
            const dues = familyDues(S(), family.value, month);
            const dueTotal = dues.reduce((a, m) => a + m.remaining, 0);
            info.textContent = ent ? `الاستحقاق الشهري ${F.egp(ent)} — المتبقي حتى الآن: ${F.num(dues.length)} شهر (${F.egp(dueTotal)})` : 'لا استحقاق شهري لهذه الأسرة — الصرف يُسجل «إضافة عامة»';
            if (ent) {
              const set = (v) => {
                amount.setUnits(v);
                manual = false;
                resuggest();
              };
              if (dueTotal) quick.append(h('button', { class: 'chip', type: 'button', text: `المتبقي ${F.money(dueTotal)}`, onclick: () => set(dueTotal) }));
              for (const n of [1, 3]) quick.append(h('button', { class: 'chip', type: 'button', text: n === 1 ? `شهر ${F.money(ent)}` : `٣ شهور ${F.money(ent * 3)}`, onclick: () => set(ent * n) }));
            }
            if (!init && amount.units() === null) {
              const sug = suggestFamilyAmount(S(), family.value, date.value);
              if (sug) amount.setUnits(sug);
            }
          }
          if (!manual) resuggest();
        };
        // الأصناف العينية
        const itemsBox = h('div', {});
        let items = (init?.items || []).map((it) => ({ ...it }));
        const led = () => computeLedger(S());
        const drawItems = () => {
          clear(itemsBox);
          const wrap = h('div', { class: 'lines' });
          items.forEach((it, i) => {
            const sel = selectInput(itemOptions(), it.itemId);
            it.itemId = sel.value;
            const qty = qtyInput(it.qty ?? null);
            const stock = h('div', { class: 'muted small' });
            const drawStock = () => (stock.textContent = `المتاح: ${F.qty(itemPosition(led(), it.itemId).qty)}`);
            sel.addEventListener('change', () => ((it.itemId = sel.value), drawStock()));
            qty.addEventListener('input', () => (it.qty = qty.units()));
            drawStock();
            wrap.append(h('div', { class: 'line' }, h('div', { class: 'grid' }, sel, qty, h('button', { class: 'rm', type: 'button', text: '×', onclick: () => (items.splice(i, 1), drawItems()) })), stock));
          });
          if (items.length) itemsBox.append(wrap);
          itemsBox.append(h('button', { class: 'btn small', type: 'button', text: '+ صنف من المخزن', onclick: () => (items.push({ itemId: itemOptions()[0]?.value, qty: null }), drawItems()) }));
          inkindField.style.display = items.length && family.value ? '' : 'none';
        };
        const inkindCount = selectInput(
          [0, 1, 2, 3, 4, 6, 12].map((n) => ({ value: String(n), label: n === 0 ? 'لا يسدد استحقاق شهور' : `يسدد استحقاق ${n} شهر (الأقدم أولاً)` })),
          String(init?.inkindMonths?.length || 0),
        );
        const inkindField = field('التوزيع العيني', inkindCount);
        const inkindMonthsFor = (n) => {
          if (!n || !family.value) return [];
          if (init?.inkindMonths?.length === n) return init.inkindMonths;
          const out = [];
          const start = ymOf(date.value);
          const first = familyDues(S(), family.value, start).map((m) => m.month);
          for (const m of first) if (out.length < n) out.push(m);
          for (let m = addMonths(start, 1), i = 0; out.length < n && i < 36; m = addMonths(m, 1), i++) {
            if (familyMonthStatus(S(), family.value, m, start).remaining > 0) out.push(m);
          }
          return out;
        };

        family.addEventListener('change', () => {
          manual = false;
          onFamily();
          drawItems();
        });
        amount.addEventListener('input', () => (manual ? drawSummary(editor.get()) : resuggest()));
        date.addEventListener('change', () => (manual ? null : resuggest()));
        body.addEventListener('input', drawWarnings);
        body.addEventListener('change', drawWarnings);

        const save = async () => {
          err.show('');
          const amt = amount.units() ?? 0;
          if (amt < 0) return err.show('المبلغ غير صالح');
          const warns = distributionWarnings(S(), currentMv());
          if (warns.length && !(await confirmDialog({ title: 'تنبيه قبل الصرف', message: warns.map((w) => '• ' + w.text).join('\n'), okText: 'صرف مع ذلك', cancelText: 'رجوع', danger: true }))) return;
          const ui = amt > 0 ? editor.get() : [];
          if (ui.some((l) => !l.amount || l.amount <= 0)) return err.show(`كل بند يحتاج مبلغاً أكبر من صفر (${RULE.money()})`);
          if (items.some((it) => !it.qty || it.qty <= 0)) return err.show(RULE.qty());
          const mv = strip({
            kind: 'distribution',
            date: date.value,
            familyId: family.value || null,
            beneficiary: family.value ? undefined : beneficiary.value.trim() || 'مستفيد',
            acct: acct.value,
            amount: amt,
            lines: ui.map((l) => (l.ui === 'month' ? strip({ kind: 'entitlement', month: l.month, amount: l.amount, purposeId: l.purposeId }) : strip({ kind: 'extra', amount: l.amount, purposeId: l.purposeId }))),
            items: items.length ? items.map((it) => ({ itemId: it.itemId, qty: it.qty })) : undefined,
            inkindMonths: items.length ? inkindMonthsFor(Number(inkindCount.value)) : undefined,
            note: note.value.trim(),
          });
          if (!mv.familyId) mv.familyId = null;
          if (!mv.lines) mv.lines = [];
          await saveMovement(mv, { initial: init, err, close });
        };

        body.append(err, field('الأسرة', family), benField, info, amanaInfo, quick, field('المبلغ النقدي (جنيه)', amount, 'اتركه فارغاً للتوزيع العيني فقط'), warnBox);
        body.append(h('div', { class: 'label muted small', text: 'أي شهور استحقاق يسددها هذا الصرف وبكم' }), editor, summary);
        body.append(h('div', { class: 'grid2' }, field('التاريخ', date), field('يُصرف من', acct)));
        body.append(h('div', { class: 'section-title' }, h('span', { text: 'أصناف عينية من المخزن' })), itemsBox, inkindField, field('ملاحظة', note), saveBtn(init ? 'حفظ التعديل' : 'حفظ الصرف', save));
        if (init) {
          editor.set(init.lines.map((l) => ({ ui: l.kind === 'entitlement' ? 'month' : 'extra', month: l.month, amount: l.amount, purposeId: l.purposeId })));
          drawSummary(editor.get());
          benField.style.display = family.value ? 'none' : '';
        } else onFamily();
        drawItems();
        drawWarnings();
      },
      { onClose: (result) => resolve(!!result) },
    );
  });
}

// ====================== مصروف ======================
export function expenseForm({ initial = null } = {}) {
  openSheet(initial ? 'تعديل مصروف' : 'مصروف', (body, close) => {
    const err = errorBox();
    const amount = moneyInput(initial?.amount ?? null);
    const date = dateInput(initial?.date);
    const acct = selectInput(acctOptions(), initial?.acct || 'general');
    const type = selectInput(active(S().lists.expenseTypes).map((t) => ({ value: t.id, label: t.name })), initial?.expenseTypeId || '', { placeholder: 'نوع المصروف…' });
    const note = noteField(initial?.note);
    const save = () => {
      const amt = amount.units();
      if (!amt || amt <= 0) return err.show(RULE.money());
      return saveMovement(strip({ kind: 'expense', date: date.value, acct: acct.value, amount: amt, expenseTypeId: type.value, note: note.value.trim() }), { initial, err, close });
    };
    body.append(err, field('المبلغ (جنيه)', amount), field('نوع المصروف', type), h('div', { class: 'grid2' }, field('التاريخ', date), field('من حساب', acct)), field('ملاحظة', note), saveBtn('حفظ', save));
  });
}

// ====================== تحويل بين صندوقين ======================
export function transferForm({ initial = null, from = null } = {}) {
  openSheet(initial ? 'تعديل تحويل' : 'تحويل بين صندوقين', (body, close) => {
    const err = errorBox();
    const opts = acctOptions();
    const fromSel = selectInput(opts, initial?.from || from || 'general');
    const toSel = selectInput(opts, initial?.to || (from === 'reserve' ? 'general' : 'reserve'));
    const amount = moneyInput(initial?.amount ?? null);
    const date = dateInput(initial?.date);
    const note = noteField(initial?.note);
    const save = () => {
      const amt = amount.units();
      if (!amt || amt <= 0) return err.show(RULE.money());
      return saveMovement(strip({ kind: 'transfer', date: date.value, from: fromSel.value, to: toSel.value, amount: amt, note: note.value.trim() }), { initial, err, close, message: 'تم التحويل' });
    };
    body.append(err, field('من', fromSel), field('إلى', toSel), field('المبلغ (جنيه)', amount), field('التاريخ', date), field('ملاحظة', note), saveBtn('تحويل', save));
  });
}

// ====================== المخزن: شراء / تبرع عيني ======================
function itemLinesEditor(initialLines, { withCost, costLabel }) {
  const box = h('div', {});
  let lines = initialLines.length ? initialLines.map((l) => ({ ...l })) : [{ itemId: itemOptions()[0]?.value, qty: null, cost: null }];
  const total = h('div', { class: 'line-summary' });
  const drawTotal = () => {
    if (withCost) total.textContent = `${costLabel}: ${F.egp(lines.reduce((a, l) => a + (l.cost || 0), 0))}`;
  };
  const render = () => {
    clear(box);
    const wrap = h('div', { class: 'lines' });
    lines.forEach((l, i) => {
      const sel = selectInput(itemOptions(), l.itemId);
      l.itemId = sel.value;
      const qty = qtyInput(l.qty ?? null);
      qty.placeholder = 'الكمية';
      const cost = moneyInput(l.cost ?? null, '');
      cost.placeholder = costLabel;
      sel.addEventListener('change', () => (l.itemId = sel.value));
      qty.addEventListener('input', () => (l.qty = qty.units()));
      cost.addEventListener('input', () => ((l.cost = cost.units()), drawTotal()));
      wrap.append(h('div', { class: 'line' }, h('div', { class: 'grid' }, sel, qty, h('button', { class: 'rm', type: 'button', text: '×', onclick: () => (lines.splice(i, 1), render()) })), withCost ? h('div', { class: 'extra' }, cost) : null));
    });
    box.append(wrap, h('button', { class: 'btn small', type: 'button', text: '+ صنف', onclick: () => (lines.push({ itemId: itemOptions()[0]?.value, qty: null, cost: null }), render()) }), total);
    drawTotal();
  };
  render();
  box.get = () => lines;
  return box;
}

// preset.lines: [{itemId, qty}] كميات مقترحة من خطة الشراء — يبقى إدخال الأسعار فقط.
export function purchaseForm({ initial = null, preset = null } = {}) {
  openSheet(initial ? 'تعديل شراء' : preset ? 'شراء حسب الخطة — أدخل الأسعار' : 'شراء أصناف', (body, close) => {
    const err = errorBox();
    if (!itemOptions().length) return body.append(h('div', { class: 'empty', text: 'أضف صنفاً أولاً من: المزيد ← القوائم ← الأصناف' }));
    const date = dateInput(initial?.date);
    const acct = selectInput(acctOptions(), initial?.acct || 'general');
    const direct = checkbox('وُزّع مباشرة (لا يدخل المخزن)', !!initial?.direct);
    const editor = itemLinesEditor(initial?.lines || preset?.lines?.map((l) => ({ itemId: l.itemId, qty: l.qty, cost: null })) || [], { withCost: true, costLabel: 'إجمالي التكلفة' });
    const note = noteField(initial?.note ?? preset?.note);
    const save = () => {
      const lines = editor.get();
      if (!lines.length) return err.show('أضف صنفاً واحداً على الأقل');
      if (lines.some((l) => !l.qty || l.qty <= 0)) return err.show(RULE.qty());
      if (lines.some((l) => l.cost === null || l.cost === undefined || l.cost < 0)) return err.show('أدخل إجمالي تكلفة كل صنف (صفر إن كان مجاناً)');
      const mv = strip({ kind: 'purchase', date: date.value, acct: acct.value, amount: lines.reduce((a, l) => a + l.cost, 0), direct: direct.input.checked, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, cost: l.cost })), note: note.value.trim() });
      return saveMovement(mv, { initial, err, close });
    };
    body.append(err, h('div', { class: 'label muted small', text: 'الصنف — الكمية — إجمالي ما دُفع فيه (أسعار مختلفة لكل شراء)' }), editor, h('div', { class: 'grid2' }, field('التاريخ', date), field('يُدفع من', acct)), direct, field('ملاحظة', note), saveBtn('حفظ', save));
  });
}

export function inkindReceiptForm({ initial = null } = {}) {
  openSheet(initial ? 'تعديل تبرع عيني' : 'تبرع عيني', (body, close) => {
    const err = errorBox();
    if (!itemOptions().length) return body.append(h('div', { class: 'empty', text: 'أضف صنفاً أولاً من: المزيد ← القوائم ← الأصناف' }));
    const subs = active(S().subscribers).map((s) => ({ value: s.id, label: s.name }));
    const payer = selectInput([{ value: '', label: 'متبرع آخر' }, ...subs], initial?.payer?.type === 'subscriber' ? initial.payer.id : '');
    const name = textInput(initial?.payer?.name || '', 'اسم المتبرع (اختياري)');
    const date = dateInput(initial?.date);
    const direct = checkbox('وُزّع مباشرة (لا يدخل المخزن)', !!initial?.direct);
    const editor = itemLinesEditor((initial?.items || []).map((it) => ({ itemId: it.itemId, qty: it.qty, cost: it.value })), { withCost: true, costLabel: 'القيمة التقديرية' });
    const note = noteField(initial?.note);
    const save = () => {
      const lines = editor.get();
      if (!lines.length) return err.show('أضف صنفاً واحداً على الأقل');
      if (lines.some((l) => !l.qty || l.qty <= 0)) return err.show(RULE.qty());
      const mv = strip({ kind: 'inkind_receipt', date: date.value, payer: payer.value ? { type: 'subscriber', id: payer.value } : strip({ type: 'other', name: name.value.trim() || 'متبرع' }), direct: direct.input.checked, items: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, value: l.cost || 0 })), note: note.value.trim() });
      return saveMovement(mv, { initial, err, close, skipOverdraft: true });
    };
    body.append(err, h('div', { class: 'grid2' }, field('المتبرع', payer), field('الاسم', name)), h('div', { class: 'label muted small', text: 'الصنف — الكمية — القيمة التقديرية (اختياري)' }), editor, field('التاريخ', date), direct, field('ملاحظة', note), saveBtn('حفظ', save));
  });
}

// ====================== الأصول: شراء / بيع / وارد / عائد / سعر ======================
const assetOptions = () => active(S().lists.assets).map((a) => ({ value: a.id, label: `${a.name} (${a.unit})` }));

export function assetTradeForm({ kind, assetId = null, initial = null }) {
  const buy = kind === 'asset_buy';
  openSheet(initial ? 'تعديل' : buy ? 'شراء أصل (ذهب / عملة / استثمار)' : 'بيع أصل', (body, close) => {
    const err = errorBox();
    if (!assetOptions().length) return body.append(h('div', { class: 'empty', text: 'أضف أصلاً أولاً بزر «أصل جديد»' }));
    const asset = selectInput(assetOptions(), initial?.assetId || assetId || '');
    const date = dateInput(initial?.date);
    const qty = assetQtyInput(initial?.qty ?? null);
    const amount = moneyInput(initial?.amount ?? null);
    const a0 = S().lists.assets.get(asset.value);
    const acct = selectInput(acctOptions(), initial?.acct || a0?.fundId || 'general');
    const setPrice = checkbox('سجّل سعر الوحدة كسعر حالي بهذا التاريخ', !initial);
    const note = noteField(initial?.note);
    const info = h('div', { class: 'preview' });
    const draw = () => {
      const a = S().lists.assets.get(asset.value);
      const pos = assetPosition(S(), computeLedger(S()), asset.value);
      clear(info);
      info.append(h('div', { class: 'pl' }, h('span', { text: `الموجود (${a.unit})` }), h('span', { class: 'num', text: F.aqty(pos.qty) })));
      info.append(h('div', { class: 'pl' }, h('span', { text: 'المدفوع فيه (التكلفة)' }), h('span', { class: 'num', text: F.money(pos.cost) })));
      const q = qty.units();
      const amt = amount.units();
      if (q > 0 && amt >= 0 && amt !== null) {
        info.append(h('div', { class: 'pl' }, h('span', { text: 'سعر الوحدة' }), h('span', { class: 'num', text: F.money(mulDiv(amt, ASSET, q)) })));
        if (!buy && q <= pos.qty) {
          const cost = q >= pos.qty ? pos.cost : mulDiv(pos.cost, q, pos.qty);
          const pl = amt - cost;
          info.append(h('div', { class: 'pl' }, h('span', { text: pl >= 0 ? 'ربح هذا البيع' : 'خسارة هذا البيع' }), h('span', { class: `num ${pl >= 0 ? 'pos' : 'neg'}`, text: F.money(pl, { sign: true }) })));
        }
      }
    };
    [asset, qty, amount].forEach((el) => el.addEventListener('input', draw));
    asset.addEventListener('change', draw);
    draw();
    const save = () => {
      const q = qty.units();
      const amt = amount.units();
      if (!q || q <= 0) return err.show(RULE.asset());
      if (amt === null || amt < 0) return err.show('أدخل المبلغ');
      const mv = strip({ kind, date: date.value, assetId: asset.value, qty: q, amount: amt, acct: acct.value, note: note.value.trim() });
      return saveMovement(mv, {
        initial,
        err,
        close,
        skipOverdraft: !buy,
        extraEvents: setPrice.input.checked && amt > 0 ? () => [['price.set', { assetId: asset.value, date: date.value, price: roundToStep(mulDiv(amt, ASSET, q), ctx.steps(date.value).money) }]] : null,
      });
    };
    body.append(err, field('الأصل', asset), info, h('div', { class: 'grid2' }, field(buy ? 'الكمية المشتراة' : 'الكمية المباعة', qty), field(buy ? 'إجمالي المدفوع' : 'إجمالي المتحصل', amount)), h('div', { class: 'grid2' }, field('التاريخ', date), field(buy ? 'يُدفع من' : 'يدخل إلى', acct)), setPrice, field('ملاحظة', note), saveBtn(buy ? 'حفظ الشراء' : 'حفظ البيع', save));
  });
}

export function assetInForm({ assetId = null, initial = null } = {}) {
  openSheet('أصل وارد بدون شراء (تبرع بذهب مثلاً)', (body, close) => {
    const err = errorBox();
    if (!assetOptions().length) return body.append(h('div', { class: 'empty', text: 'أضف أصلاً أولاً بزر «أصل جديد»' }));
    const asset = selectInput(assetOptions(), initial?.assetId || assetId || '');
    const date = dateInput(initial?.date);
    const qty = assetQtyInput(initial?.qty ?? null);
    const value = moneyInput(initial?.value ?? null, '');
    const note = noteField(initial?.note);
    const save = () => {
      const q = qty.units();
      if (!q || q <= 0) return err.show('أدخل كمية صحيحة');
      return saveMovement(strip({ kind: 'asset_in', date: date.value, assetId: asset.value, qty: q, value: value.units() || 0, note: note.value.trim() }), { initial, err, close, skipOverdraft: true });
    };
    body.append(err, field('الأصل', asset), h('div', { class: 'grid2' }, field('الكمية', qty), field('القيمة عند الاستلام', value, 'تُحسب كتكلفة')), field('التاريخ', date), field('ملاحظة', note), saveBtn('حفظ', save));
  });
}

export function assetIncomeForm({ assetId = null, initial = null } = {}) {
  openSheet('عائد استثمار / أرباح', (body, close) => {
    const err = errorBox();
    const asset = selectInput(assetOptions(), initial?.assetId || assetId || '', { placeholder: 'بدون أصل محدد' });
    const a0 = S().lists.assets.get(asset.value);
    const acct = selectInput(acctOptions(), initial?.acct || a0?.fundId || 'invest');
    const amount = moneyInput(initial?.amount ?? null);
    const date = dateInput(initial?.date);
    const note = noteField(initial?.note);
    const save = () => {
      const amt = amount.units();
      if (!amt || amt <= 0) return err.show(RULE.money());
      return saveMovement(strip({ kind: 'asset_income', date: date.value, assetId: asset.value, acct: acct.value, amount: amt, note: note.value.trim() }), { initial, err, close, skipOverdraft: true });
    };
    body.append(err, field('المبلغ (جنيه)', amount), field('من أصل / مشروع', asset), h('div', { class: 'grid2' }, field('التاريخ', date), field('يدخل إلى', acct)), field('ملاحظة', note), saveBtn('حفظ', save));
  });
}

export function priceForm(assetId) {
  const a = S().lists.assets.get(assetId);
  openSheet(`سعر ${a.name} الحالي`, (body, close) => {
    const err = errorBox();
    const price = moneyInput(null);
    const date = dateInput();
    const save = async () => {
      const p = price.units();
      if (p === null || p < 0) return err.show('أدخل السعر');
      try {
        await ctx.store.dispatch('price.set', { assetId, date: date.value, price: p });
        toast('تم تحديث السعر');
        close(true);
      } catch (e) {
        showError(err, e);
      }
    };
    body.append(err, field(`سعر ال${a.unit} الواحد (جنيه)`, price), field('بتاريخ', date), saveBtn('حفظ السعر', save));
  });
}

// ====================== تسوية / رصيد افتتاحي ======================
export function adjustmentForm({ opening = false, initial = null, target = 'cash' } = {}) {
  openSheet(opening ? 'رصيد افتتاحي' : 'تسوية', (body, close) => {
    const err = errorBox();
    const tgt = selectInput(
      [
        { value: 'cash', label: 'نقد في صندوق' },
        { value: 'item', label: 'صنف في المخزن' },
        { value: 'asset', label: 'أصل (ذهب / عملة / استثمار)' },
      ],
      initial?.target || target,
    );
    const dir = selectInput(
      [
        { value: '1', label: 'زيادة (+)' },
        { value: '-1', label: 'نقص (−)' },
      ],
      initial && (initial.amount < 0 || initial.qty < 0) ? '-1' : '1',
    );
    const acct = selectInput(acctOptions(), initial?.acct || 'general');
    const item = selectInput(itemOptions(), initial?.itemId || '');
    const asset = selectInput(assetOptions(), initial?.assetId || '');
    const amount = moneyInput(initial?.amount !== undefined ? Math.abs(initial.amount) : null);
    const qtyI = qtyInput(initial?.target === 'item' ? Math.abs(initial.qty) : null);
    const qtyA = assetQtyInput(initial?.target === 'asset' ? Math.abs(initial.qty) : null);
    const cost = moneyInput(initial?.cost !== undefined ? Math.abs(initial.cost) : null, '');
    const date = dateInput(initial?.date || (opening ? `${ctx.fiscalYear()}-01-01` : undefined));
    const reason = textInput(initial?.reason || initial?.note || '', opening ? 'بيان (اختياري)' : 'سبب التسوية (مطلوب)');
    const fAcct = field('الصندوق', acct);
    const fItem = field('الصنف', item);
    const fAsset = field('الأصل', asset);
    const fAmount = field('المبلغ (جنيه)', amount);
    const fQtyI = field('الكمية', qtyI);
    const fQtyA = field('الكمية', qtyA);
    const fCost = field('التكلفة / القيمة (جنيه)', cost, 'عند النقص: تُحسب بمتوسط التكلفة إن تُركت فارغة');
    const fDir = field('الاتجاه', dir);
    const draw = () => {
      const t = tgt.value;
      fAcct.style.display = fAmount.style.display = t === 'cash' ? '' : 'none';
      fItem.style.display = fQtyI.style.display = t === 'item' ? '' : 'none';
      fAsset.style.display = fQtyA.style.display = t === 'asset' ? '' : 'none';
      fCost.style.display = t === 'cash' ? 'none' : '';
      fDir.style.display = opening ? 'none' : '';
    };
    tgt.addEventListener('change', draw);
    draw();
    const save = () => {
      const sign = opening ? 1 : Number(dir.value);
      const t = tgt.value;
      const base = { kind: opening ? 'opening' : 'adjustment', date: date.value, target: t, reason: reason.value.trim() || undefined };
      let mv;
      if (t === 'cash') {
        const amt = amount.units();
        if (!amt || amt <= 0) return err.show(RULE.money());
        mv = { ...base, acct: acct.value, amount: sign * amt };
      } else {
        const q = t === 'item' ? qtyI.units() : qtyA.units();
        if (!q || q <= 0) return err.show('أدخل كمية صحيحة');
        const c = cost.units();
        mv = { ...base, ...(t === 'item' ? { itemId: item.value } : { assetId: asset.value }), qty: sign * q };
        if (c !== null) mv.cost = sign * c;
        else if (sign > 0) mv.cost = 0;
      }
      if (opening && !mv.reason) mv.note = 'رصيد افتتاحي';
      return saveMovement(strip(mv), { initial, err, close, skipOverdraft: true });
    };
    body.append(err, field('على ماذا؟', tgt), fAcct, fItem, fAsset, fDir, fAmount, fQtyI, fQtyA, fCost, field('التاريخ', date), field(opening ? 'بيان' : 'السبب', reason), saveBtn('حفظ', save));
  });
}

// ====================== جرد ومطابقة نقدية ======================
// عدّ النقد الفعلي لحساب ومقارنته بالرصيد الدفتري؛ الفرق (إن وُجد) يُسجَّل تسوية بسببه.
export function cashCountForm(acct) {
  openSheet('جرد ومطابقة', (body, close) => {
    const err = errorBox();
    const bookBal = acctBalance(computeLedger(S()), acct);
    const actual = moneyInput(null);
    const date = dateInput();
    const diffBox = h('div', { class: 'preview' });
    const draw = () => {
      clear(diffBox);
      const a = actual.units();
      diffBox.append(h('div', { class: 'pl' }, h('span', { text: 'الرصيد الدفتري' }), h('span', { class: 'num', text: F.money(bookBal) })));
      if (a !== null) {
        const diff = a - bookBal;
        diffBox.append(h('div', { class: 'pl' }, h('span', { text: diff === 0 ? 'مطابق — لا فرق' : diff > 0 ? 'زيادة فعلية' : 'عجز فعلي' }), h('span', { class: `num ${diff === 0 ? 'pos' : 'neg'}`, text: F.money(diff, { sign: true }) })));
      }
    };
    actual.addEventListener('input', draw);
    draw();
    const save = () => {
      const a = actual.units();
      if (a === null) return err.show(RULE.money());
      const diff = a - bookBal;
      if (diff === 0) {
        toast('الرصيد مطابق — لا تسوية');
        return close(true);
      }
      return saveMovement({ kind: 'adjustment', date: date.value, target: 'cash', acct, amount: diff, reason: `جرد ومطابقة: الفعلي ${F.money(a)} والدفتري ${F.money(bookBal)}` }, { err, close, skipOverdraft: true, message: 'سُجّلت تسوية الجرد' });
    };
    body.append(err, h('p', { class: 'muted', text: `عدّ النقد الموجود فعلاً في «${acctLabel(S(), acct)}» واكتبه. إن اختلف عن الدفتر تُسجَّل تسوية بالفرق وتظهر في التقارير.` }), field('الرصيد الفعلي بعد العدّ (جنيه)', actual), diffBox, field('تاريخ الجرد', date), saveBtn('اعتماد الجرد', save));
  });
}

// ====================== الأمانات: تسليم لصاحبتها أو تغيير التخصيص ======================
const amanaFamilyId = (acct) => (acct.startsWith('earmarked#family:') ? acct.split(':')[1] : null);

// تسليم أمانة أسرة: كلها أو جزء منها، والباقي يبقى منتظراً في حسابه.
export function amanaDeliverForm(acct) {
  const familyId = amanaFamilyId(acct);
  const fam = S().families.get(familyId);
  if (!fam) return toast('هذه الأمانة ليست باسم أسرة', 'bad');
  const bal = acctBalance(computeLedger(S()), acct);
  openSheet(`تسليم أمانة: ${fam.name}`, (body, close) => {
    const err = errorBox();
    const amount = moneyInput(bal > 0 ? bal : null);
    const date = dateInput();
    const asEnt = checkbox('يُحسب من استحقاقها الشهري (الأقدم أولاً)', false);
    const note = noteField('');
    const left = h('div', { class: 'preview' });
    const draw = () => {
      clear(left);
      const a = amount.units() || 0;
      left.append(h('div', { class: 'pl' }, h('span', { text: 'رصيد الأمانة' }), h('span', { class: 'num', text: F.money(bal) })));
      left.append(h('div', { class: 'pl' }, h('span', { text: 'يبقى منتظراً بعد التسليم' }), h('span', { class: `num ${bal - a < 0 ? 'neg' : ''}`, text: F.money(bal - a) })));
    };
    amount.addEventListener('input', draw);
    draw();
    const save = () => {
      const amt = amount.units();
      if (!amt || amt <= 0) return err.show(RULE.money());
      if (amt > bal) return err.show('المبلغ أكبر من رصيد الأمانة');
      const lines = asEnt.input.checked ? suggestFamilyAllocation(S(), familyId, amt, date.value) : [{ kind: 'extra', amount: amt }];
      return saveMovement(strip({ kind: 'distribution', date: date.value, familyId, acct, amount: amt, lines, note: note.value.trim() || 'تسليم أمانة مخصصة للأسرة' }), { err, close, skipOverdraft: true, message: 'تم تسليم الأمانة' });
    };
    body.append(err, field('المبلغ المسلَّم (جنيه)', amount, 'الافتراضي كل الرصيد — اكتب جزءاً منه والباقي ينتظر'), left, asEnt, field('التاريخ', date), field('ملاحظة', note), saveBtn('تسليم للأسرة', save));
  });
}

// تغيير تخصيص أمانة: إلى الصندوق العام أو لأسرة/فئة/حملة/صندوق آخر (كلها أو جزء منها).
export function amanaRedirectForm(acct) {
  const bal = acctBalance(computeLedger(S()), acct);
  openSheet('تغيير تخصيص الأمانة', (body, close) => {
    const err = errorBox();
    const amount = moneyInput(bal > 0 ? bal : null);
    const target = selectInput([{ value: 'fund|general', label: 'عام: الصندوق العام' }, ...targetOptions()], 'fund|general');
    const date = dateInput();
    const reason = textInput('', 'سبب التغيير (مثلاً: بإذن المتبرع)');
    const save = () => {
      const amt = amount.units();
      if (!amt || amt <= 0) return err.show(RULE.money());
      if (amt > bal) return err.show('المبلغ أكبر من رصيد الأمانة');
      const to = targetAcct(decTarget(target.value));
      if (to === acct) return err.show('اختر جهة مختلفة');
      return saveMovement(strip({ kind: 'transfer', date: date.value, from: acct, to, amount: amt, note: `تغيير تخصيص${reason.value.trim() ? ': ' + reason.value.trim() : ''}` }), { err, close, skipOverdraft: true, message: 'تم تغيير التخصيص' });
    };
    body.append(err, h('p', { class: 'muted', text: `من «${acctLabel(S(), acct)}» — الرصيد ${F.egp(bal)}. ما لا تحوّله يبقى منتظراً كما هو.` }), field('المبلغ (جنيه)', amount), field('يتحول إلى', target), field('التاريخ', date), field('السبب', reason), saveBtn('تغيير التخصيص', save));
  });
}

// ====================== إلغاء وتعديل حركة ======================
export async function voidMovementFlow(mv) {
  if (isLockedDate(S(), mv.date)) {
    toast('الحركة داخل سنة مقفولة — لا يمكن إلغاؤها', 'bad');
    return false;
  }
  const reason = await confirmDialog({ title: 'إلغاء الحركة', message: 'ستُسجَّل حركة عكسية وتبقى الحركة الأصلية في سجل التدقيق.', okText: 'إلغاء الحركة', danger: true, input: { label: 'سبب الإلغاء', required: true, requiredMessage: 'اكتب سبب الإلغاء' } });
  if (!reason) return false;
  try {
    await ctx.store.dispatch('movement.void', { movementId: mv.id, reason, date: ctx.today() });
    toast('تم الإلغاء');
    return true;
  } catch (e) {
    toast(e.message, 'bad');
    return false;
  }
}

export function editMovementFlow(mv) {
  if (isLockedDate(S(), mv.date)) return toast('الحركة داخل سنة مقفولة — لا يمكن تعديلها', 'bad');
  switch (mv.kind) {
    case 'receipt':
      return receiptForm({ initial: mv });
    case 'distribution':
      return distributionForm({ initial: mv });
    case 'expense':
      return expenseForm({ initial: mv });
    case 'transfer':
      return transferForm({ initial: mv });
    case 'purchase':
      return purchaseForm({ initial: mv });
    case 'inkind_receipt':
      return inkindReceiptForm({ initial: mv });
    case 'asset_buy':
    case 'asset_sell':
      return assetTradeForm({ kind: mv.kind, initial: mv });
    case 'asset_in':
      return assetInForm({ initial: mv });
    case 'asset_income':
      return assetIncomeForm({ initial: mv });
    case 'adjustment':
    case 'opening':
      return adjustmentForm({ opening: mv.kind === 'opening', initial: mv });
    default:
      return toast('هذا النوع لا يُعدَّل — ألغه وأدخله من جديد');
  }
}

export { fundCash, badge };
