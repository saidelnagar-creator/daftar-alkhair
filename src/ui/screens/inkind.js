// الالتزام العيني والصرف المجمّع: خطة الأسرة العينية بتاريخ سريان، صرف نقدي/عيني لعدة أسر وعدة شهور مرة واحدة،
// توزيع إضافي بكمية ثابتة، وخطة الشراء (كميات مقترحة ويبقى السعر فقط). الحساب كله في core/inkind.js.
import { h, clear } from '../dom.js';
import { ctx, F, RULE } from '../ctx.js';
import { openSheet, field, qtyInput, dateInput, selectInput, checkbox, errorBox, toast, confirmDialog, row, list, empty, sectionTitle, chips, table, kv, badge, monthOptions, stat } from '../components.js';
import { ui, collator } from '../widgets.js';
import { inkindPlanAt } from '../../core/engine.js';
import { computeLedger, itemPosition, acctBalance } from '../../core/ledger.js';
import { entitlementAt, familyDues } from '../../core/families.js';
import { hasInkindPlan, inkindMonthStatus, inkindRemaining, inkindTotals, planInkindBatch, planInkindExtra, planCashBatch, suggestPurchase, executeBatch } from '../../core/inkind.js';
import { addMonths, monthsRange, newId } from '../../core/util.js';
import { acctOptions, purchaseForm } from '../forms-movements.js';
import { effectiveMonthSelect } from '../forms-entities.js';

const S = () => ctx.state;
const itemName = (id) => S().lists.items.get(id)?.name || id;
const itemUnit = (id) => S().lists.items.get(id)?.unit || '';
const itemOpts = () => [...S().lists.items.values()].filter((i) => !i.archived).map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }));
const lineText = (l) => `${itemName(l.itemId)} ${F.qty(l.qty)} ${itemUnit(l.itemId)}${(l.alts || []).length ? ` (أو ${l.alts.map((a) => `${itemName(a.itemId)} ${F.qty(a.qty)} ${itemUnit(a.itemId)}`).join(' أو ')})` : ''}`;

// ---------- خطة الأسرة العينية (بتاريخ سريان) ----------
export function inkindPlanForm(familyId) {
  const fam = S().families.get(familyId);
  const now = ctx.nowMonth();
  openSheet(`الالتزام العيني: ${fam.name}`, (body, close) => {
    const err = errorBox();
    if (!itemOpts().length) return body.append(empty('أضف صنفاً أولاً من: المزيد ← القوائم ← الأصناف'));
    const from = effectiveMonthSelect(now);
    let lines = inkindPlanAt(S(), familyId, now).map((l) => ({ itemId: l.itemId, qty: l.qty, alt: (l.alts || [])[0] ? { ...l.alts[0] } : null }));
    const box = h('div', {});
    const draw = () => {
      clear(box);
      const wrap = h('div', { class: 'lines' });
      lines.forEach((l, i) => {
        const sel = selectInput(itemOpts(), l.itemId);
        l.itemId = sel.value;
        const qty = qtyInput(l.qty ?? null);
        qty.placeholder = 'الكمية شهرياً';
        sel.addEventListener('change', () => (l.itemId = sel.value));
        qty.addEventListener('input', () => (l.qty = qty.units()));
        const extra = h('div', { class: 'extra' });
        if (l.alt) {
          const asel = selectInput(itemOpts(), l.alt.itemId);
          l.alt.itemId = asel.value;
          const aqty = qtyInput(l.alt.qty ?? null);
          aqty.placeholder = 'كمية البديل';
          asel.addEventListener('change', () => (l.alt.itemId = asel.value));
          aqty.addEventListener('input', () => (l.alt.qty = aqty.units()));
          extra.append(h('div', { class: 'muted small', text: 'أو بديله (ما يتوفر منهما يكفي الغرض):' }), h('div', { class: 'grid' }, asel, aqty, h('button', { class: 'rm', type: 'button', text: '×', 'aria-label': 'حذف البديل', onclick: () => ((l.alt = null), draw()) })));
        } else extra.append(h('button', { class: 'link', type: 'button', text: '+ بديل لهذا الصنف', onclick: () => ((l.alt = { itemId: itemOpts().find((o) => o.value !== l.itemId)?.value || l.itemId, qty: null }), draw()) }));
        wrap.append(h('div', { class: 'line' }, h('div', { class: 'grid' }, sel, qty, h('button', { class: 'rm', type: 'button', text: '×', 'aria-label': 'حذف الصنف', onclick: () => (lines.splice(i, 1), draw()) })), extra));
      });
      box.append(lines.length ? wrap : h('div', { class: 'muted small', text: 'لا أصناف — الحفظ هكذا يوقف الالتزام العيني من الشهر المحدد.' }));
      box.append(h('button', { class: 'btn small', type: 'button', text: '+ صنف', onclick: () => (lines.push({ itemId: itemOpts().find((o) => !lines.some((x) => x.itemId === o.value))?.value || itemOpts()[0].value, qty: null, alt: null }), draw()) }));
    };
    draw();
    const save = async () => {
      if (lines.some((l) => !l.qty || l.qty <= 0 || (l.alt && (!l.alt.qty || l.alt.qty <= 0)))) return err.show(RULE.qty());
      try {
        await ctx.store.dispatch('family.inkind.set', { familyId, from: from.value, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, ...(l.alt ? { alts: [{ itemId: l.alt.itemId, qty: l.alt.qty }] } : {}) })) });
        toast('تم حفظ الالتزام العيني');
        close(true);
      } catch (e) {
        err.show(e.message);
      }
    };
    body.append(err, h('div', { class: 'muted small', style: { marginBottom: '10px' }, text: 'ما تستحقه الأسرة شهرياً من المواد العينية. التغيير (زيادة بند أو نقصه أو تغيير كمية) يسري من الشهر الذي تختاره ولا يمس ما قبله، ويبقى تاريخه مسجلاً.' }), field('يسري من شهر', from), box, h('button', { class: 'btn primary block', style: { marginTop: '12px' }, type: 'button', text: 'حفظ', onclick: save }));
  });
}

// بطاقة الالتزام العيني في ملف الأسرة: الخطة الحالية، حالة الشهور، وتاريخ التغييرات.
export function familyInkindSection(familyId) {
  const fam = S().families.get(familyId);
  const now = ctx.nowMonth();
  const out = [sectionTitle('الالتزام العيني الشهري', h('button', { text: hasInkindPlan(S(), familyId) ? 'تعديل' : '+ تحديد', onclick: () => inkindPlanForm(familyId) }))];
  const plan = inkindPlanAt(S(), familyId, now);
  if (!hasInkindPlan(S(), familyId)) {
    out.push(empty('لم يُحدَّد التزام عيني — حدّد الأنواع والكمية من كل نوع شهرياً.'));
    return out;
  }
  out.push(plan.length ? list(plan.map((l) => row({ title: itemName(l.itemId), subtitle: (l.alts || []).length ? `أو ${l.alts.map((a) => `${itemName(a.itemId)} ${F.qty(a.qty)} ${itemUnit(a.itemId)}`).join(' أو ')}` : '', value: `${F.qty(l.qty)} ${itemUnit(l.itemId)}`, pk: 'families|inkind' }))) : empty('لا التزام عيني سارٍ هذا الشهر'));
  // حالة آخر 3 شهور والقادمة 2
  const months = monthsRange(addMonths(now, -3), addMonths(now, 2));
  const rows = [];
  for (const m of months) {
    const st = inkindMonthStatus(S(), familyId, m);
    if (!st.length) continue;
    const left = st.filter((x) => x.remaining > 0);
    rows.push(row({ title: F.month(m), subtitle: left.length ? `متبقٍ: ${left.map((x) => `${itemName(x.itemId)} ${F.qty(x.remaining)}`).join('، ')}` : 'وصل كاملاً', badge: left.length ? badge(m > now ? 'لم يحن' : 'متبقٍ', m > now ? '' : 'warn') : badge('وصل', 'ok') }));
  }
  if (rows.length) out.push(list(rows));
  out.push(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'توزيع عيني لهذه الأسرة', onclick: () => openBatch({ mode: 'inkind', families: [familyId] }) })));
  const versions = fam.inkind || [];
  if (versions.length > 1) {
    out.push(h('div', { class: 'muted small', style: { margin: '8px 4px 4px' }, text: 'تاريخ تغيير الالتزام' }));
    out.push(list([...versions].reverse().map((v) => row({ title: `من ${F.month(v.from)}`, subtitle: v.lines.length ? v.lines.map(lineText).join(' · ') : 'إيقاف الالتزام العيني' }))));
  }
  return out;
}

// ---------- أدوات الاختيار المشتركة ----------
const COUNTS = [1, 2, 3, 6, 12];

function batchState() {
  return ui('batch', { mode: 'cash', picked: null, from: ctx.nowMonth(), count: 1, items: null, choices: {}, acct: 'general', useAmana: true, deductStock: true, extra: [], deduct: true, udhiyaId: null, note: '' });
}

// يفتح شاشة الصرف المجمّع باختيارات مسبقة (من ملف أسرة، أضحية، لوحة القرار…).
export function openBatch({ mode = 'cash', families = null, extra = null, udhiyaId = null, path = '#/batch' } = {}) {
  const st = batchState();
  Object.assign(st, { mode, picked: families ? new Set(families) : null, udhiyaId });
  if (extra) st.extra = extra;
  if (location.hash === path) ctx.refresh();
  else ctx.nav(path);
}

function activeFamilies() {
  return [...S().families.values()].filter((f) => !f.archived).sort((a, b) => collator.compare(a.name, b.name));
}

// قائمة اختيار الأسر: كل أسرة بسطر فيه ما يخصها، مع «الكل / لا شيء».
function familyPicker(st, rows) {
  const ids = rows.map((r) => r.id);
  if (!st.picked) st.picked = new Set(rows.filter((r) => r.on !== false).map((r) => r.id));
  const wrap = h('div', { class: 'pick-list' });
  const count = h('span', { class: 'muted small' });
  const sync = () => (count.textContent = `${F.num(ids.filter((id) => st.picked.has(id)).length)} من ${F.num(ids.length)} أسرة`);
  sync();
  const head = sectionTitle('الأسر', h('span', {}, h('button', { text: 'الكل', onclick: () => ((st.picked = new Set(ids)), ctx.refresh()) }), ' ', h('button', { text: 'لا شيء', onclick: () => ((st.picked = new Set()), ctx.refresh()) })));
  if (!rows.length) return [head, empty('لا أسر مطابقة')];
  wrap.append(
    list(
      rows.map((r) => {
        const cb = h('input', { type: 'checkbox', checked: st.picked.has(r.id), 'aria-label': r.name });
        cb.addEventListener('change', () => {
          if (cb.checked) st.picked.add(r.id);
          else st.picked.delete(r.id);
          ctx.refresh();
        });
        return h('label', { class: 'row' }, cb, h('div', { class: 'main' }, h('div', { class: 'title', text: r.name }), r.subtitle ? h('div', { class: 'subtitle', text: r.subtitle }) : null), h('div', { class: 'end' }, r.value ? h('div', { class: 'value num', text: r.value }) : null));
      }),
    ),
  );
  return [head, count, wrap];
}

function periodControls(st, { label = 'من شهر' } = {}) {
  const now = ctx.nowMonth();
  const from = selectInput(monthOptions(addMonths(now, -12), addMonths(now, 12)), st.from);
  from.addEventListener('change', () => ((st.from = from.value), ctx.refresh()));
  const count = selectInput(COUNTS.map((n) => ({ value: String(n), label: n === 1 ? 'شهر واحد' : n === 2 ? 'شهران' : n === 12 ? 'سنة (12 شهراً)' : `${n} شهور` })), String(st.count));
  count.addEventListener('change', () => ((st.count = Number(count.value)), ctx.refresh()));
  return h('div', { class: 'grid2' }, field(label, from), field('المدة', count));
}
const toMonthOf = (st) => addMonths(st.from, st.count - 1);

// اختيار الأصناف + البديل ونسبة الاستبدال لكل صنف.
function itemControls(st, familyIds) {
  const totals = inkindTotals(S(), { familyIds, fromMonth: st.from, toMonth: toMonthOf(st) }).filter((t) => t.remaining > 0);
  const all = totals.map((t) => t.itemId);
  if (!st.items) st.items = new Set(all);
  const out = [sectionTitle('الأصناف', h('span', {}, h('button', { text: 'الكل', onclick: () => ((st.items = new Set(all)), ctx.refresh()) }), ' ', h('button', { text: 'لا شيء', onclick: () => ((st.items = new Set()), ctx.refresh()) })))];
  if (!totals.length) {
    out.push(empty('لا التزام عيني متبقٍ للأسر المختارة في هذه المدة'));
    return out;
  }
  // البدائل المعرَّفة لأي أسرة مختارة
  const alts = new Map();
  for (const id of familyIds) for (const m of monthsRange(st.from, toMonthOf(st))) for (const l of inkindPlanAt(S(), id, m)) for (const a of l.alts || []) alts.set(l.itemId, new Set([...(alts.get(l.itemId) || []), a.itemId]));
  for (const t of totals) {
    const on = st.items.has(t.itemId);
    const ch = (st.choices[t.itemId] = st.choices[t.itemId] || { give: t.itemId, pct: 100 });
    const cb = checkbox(`${itemName(t.itemId)} — المتبقي ${F.qty(t.remaining)} ${itemUnit(t.itemId)} لـ ${F.num(t.families)} أسرة`, on);
    cb.input.addEventListener('change', () => {
      if (cb.input.checked) st.items.add(t.itemId);
      else st.items.delete(t.itemId);
      ctx.refresh();
    });
    const card = h('div', { class: 'card' }, cb);
    if (on) {
      const give = selectInput([{ value: t.itemId, label: `يُعطى: ${itemName(t.itemId)}` }, ...[...(alts.get(t.itemId) || [])].map((a) => ({ value: a, label: `البديل: ${itemName(a)}` }))], ch.give);
      give.addEventListener('change', () => ((ch.give = give.value), ctx.refresh()));
      const pct = selectInput([100, 90, 80, 75, 70, 60, 50].map((p) => ({ value: String(p), label: p === 100 ? 'الكمية كاملة' : `${p}% تقضي الغرض` })), String(ch.pct));
      pct.addEventListener('change', () => ((ch.pct = Number(pct.value)), ctx.refresh()));
      card.append(h('div', { class: 'grid2' }, field('الصنف المتاح', give), field('نسبة هذه المرة', pct, 'إن قلّت الإمكانات: كمية أقل تستوفي البند')));
    }
    out.push(card);
  }
  return out;
}

function totalsTable(totals) {
  return table(
    [{ label: 'الصنف' }, { label: 'المطلوب', num: true }, { label: 'المخزون', num: true }, { label: 'العجز', num: true }],
    totals.map((t) => [`${itemName(t.itemId)} (${itemUnit(t.itemId)})`, F.qty(t.qty), F.qty(t.stock), t.short ? F.qty(t.short) : '—']),
    { pg: 'assets' },
  );
}

async function runBatch(plan, { title, message }) {
  if (!plan.movements.length) return toast('لا شيء للصرف في هذا الاختيار', 'bad');
  if (!(await confirmDialog({ title, message, okText: 'تنفيذ' }))) return false;
  try {
    await ctx.store.run((book) => executeBatch(book, plan.movements, { now: new Date() }));
    toast(`تم — ${F.num(plan.movements.length)} حركة`);
    return true;
  } catch (e) {
    toast(e.message || 'تعذّر التنفيذ', 'bad');
    return false;
  }
}

// ---------- شاشة الصرف المجمّع ----------
export function batchScreen() {
  const st = batchState();
  const body = h('div', {});
  body.append(
    chips(
      [
        { value: 'cash', label: 'نقدي: مستحقات الأسر' },
        { value: 'inkind', label: 'عيني: الالتزام الشهري' },
        { value: 'extra', label: 'عيني إضافي (كمية ثابتة)' },
      ],
      st.mode,
      (v) => {
        Object.assign(st, { mode: v, picked: null, items: null });
        ctx.refresh();
      },
    ),
  );
  const date = dateInput(st.date);
  date.addEventListener('change', () => ((st.date = date.value), ctx.refresh()));
  const dateVal = st.date || ctx.today();
  const batchId = newId('b-');
  const fams = activeFamilies();

  if (st.mode === 'cash') {
    const to = toMonthOf({ from: ctx.nowMonth(), count: st.count });
    const count = selectInput(COUNTS.map((n) => ({ value: String(n), label: n === 1 ? `المتبقي حتى ${F.month(ctx.nowMonth())}` : `حتى ${F.month(addMonths(ctx.nowMonth(), n - 1))} (${n} شهور)` })), String(st.count));
    count.addEventListener('change', () => ((st.count = Number(count.value)), (st.picked = null), ctx.refresh()));
    const acct = selectInput(acctOptions({ earmarks: false }), st.acct);
    acct.addEventListener('change', () => ((st.acct = acct.value), ctx.refresh()));
    const amana = checkbox('أمانة الأسرة أولاً إن وُجدت باسمها', st.useAmana);
    amana.input.addEventListener('change', () => ((st.useAmana = amana.input.checked), ctx.refresh()));
    const rows = fams
      .map((f) => {
        const p = planCashBatch(S(), { familyIds: [f.id], toMonth: to, date: dateVal, acct: st.acct });
        return { id: f.id, name: f.name, total: p.total, subtitle: p.families[0] ? `${F.num(p.families[0].months.length)} شهر${entitlementAt(S(), f.id, ctx.nowMonth()) ? ` · ${F.money(entitlementAt(S(), f.id, ctx.nowMonth()))} شهرياً` : ''}` : '', value: F.money(p.total) };
      })
      .filter((r) => r.total > 0);
    const picker = familyPicker(st, rows);
    const plan = planCashBatch(S(), { familyIds: rows.map((r) => r.id).filter((id) => st.picked.has(id)), toMonth: to, date: dateVal, acct: st.acct, useAmana: st.useAmana, batchId, note: 'صرف مجمّع' });
    body.append(h('p', { class: 'muted', text: 'ادفع المبالغ المستحقة لعدد من الأسر لعدد من الشهور مرة واحدة: حركة صرف لكل أسرة ببنود شهورها.' }), field('المدة', count), h('div', { class: 'grid2' }, field('يُصرف من', acct), field('التاريخ', date)), amana, picker);
    body.append(
      h('div', { class: 'stats' }, stat('إجمالي الصرف', F.money(plan.total), { cls: 'primary wide', hint: `${F.num(plan.families.length)} أسرة · ${F.num(plan.movements.length)} حركة`, pk: 'families|batch-total' })),
      plan.accounts.length ? h('div', { class: 'card' }, plan.accounts.map((a) => kv(`من: ${S().lists.funds.get(a.acct)?.name || (a.acct.startsWith('earmarked#family:') ? 'أمانة الأسرة' : a.acct)}`, `${F.egp(a.amount)}${a.short ? ` — ينقص ${F.egp(a.short)}` : ''}`, a.short ? 'neg' : '')), ) : null,
      h('button', {
        class: 'btn primary block',
        text: `صرف ${F.money(plan.total)} ج لـ ${F.num(plan.families.length)} أسرة`,
        disabled: !plan.movements.length,
        onclick: async () => {
          const short = plan.accounts.filter((a) => a.short > 0);
          const ok = await runBatch(plan, { title: 'تأكيد الصرف المجمّع', message: `سيُصرف ${F.egp(plan.total)} لـ ${F.num(plan.families.length)} أسرة.${short.length ? '\nتنبيه: الرصيد لا يكفي وسيصبح سالباً.' : ''}` });
          if (ok) st.picked = null;
        },
      }),
    );
    void familyDues;
    void acctBalance;
  } else if (st.mode === 'inkind') {
    const to = toMonthOf(st);
    const rows = fams
      .filter((f) => hasInkindPlan(S(), f.id))
      .map((f) => {
        const left = inkindRemaining(S(), f.id, st.from, to);
        return { id: f.id, name: f.name, n: left.length, subtitle: left.length ? [...new Set(left.map((l) => itemName(l.itemId)))].join('، ') : 'مستوفى' };
      })
      .filter((r) => r.n > 0);
    const picker = familyPicker(st, rows);
    const ids = rows.map((r) => r.id).filter((id) => st.picked.has(id));
    const items = itemControls(st, ids);
    const plan = planInkindBatch(S(), { familyIds: ids, fromMonth: st.from, toMonth: to, itemIds: st.items ? [...st.items] : null, choices: st.choices, date: dateVal, batchId, note: 'توزيع عيني مجمّع' });
    const short = plan.totals.filter((t) => t.short > 0);
    body.append(h('p', { class: 'muted', text: 'وزّع الالتزام العيني لعدة أسر ولعدة شهور مرة واحدة: كل أسرة يصلها مقدارها المحدد، وترى الإجمالي من كل نوع قبل التنفيذ.' }), periodControls(st), field('تاريخ التوزيع', date), picker, items);
    if (plan.totals.length) body.append(sectionTitle('الإجمالي من كل نوع'), totalsTable(plan.totals));
    if (short.length) body.append(h('div', { class: 'banner' }, h('span', { class: 'grow', text: 'المخزون لا يكفي — اشترِ العجز أو قلّل النسبة أو الأصناف.' }), h('button', { class: 'btn small', text: 'خطة شراء', onclick: () => ctx.nav('#/purchase-plan') })));
    body.append(
      h('button', {
        class: 'btn primary block',
        text: `توزيع على ${F.num(plan.movements.length)} أسرة`,
        disabled: !plan.movements.length || short.length > 0,
        onclick: async () => {
          const ok = await runBatch(plan, { title: 'تأكيد التوزيع العيني', message: `${F.num(plan.movements.length)} أسرة — ${F.month(st.from)}${st.count > 1 ? ` إلى ${F.month(to)}` : ''}.\n${plan.totals.map((t) => `${itemName(t.itemId)}: ${F.qty(t.qty)} ${itemUnit(t.itemId)}`).join('، ')}` });
          if (ok) Object.assign(st, { picked: null, items: null });
        },
      }),
    );
  } else {
    if (!st.extra.length) st.extra = [{ itemId: itemOpts()[0]?.value, qty: null }];
    const rows = fams.map((f) => ({ id: f.id, name: f.name, on: false }));
    const picker = familyPicker(st, rows);
    const ids = rows.map((r) => r.id).filter((id) => st.picked.has(id));
    const box = h('div', { class: 'lines' });
    st.extra.forEach((it, i) => {
      const sel = selectInput(itemOpts(), it.itemId);
      it.itemId = sel.value;
      const qty = qtyInput(it.qty ?? null);
      qty.placeholder = 'لكل أسرة';
      sel.addEventListener('change', () => ((it.itemId = sel.value), ctx.refresh()));
      qty.addEventListener('change', () => ((it.qty = qty.units()), ctx.refresh()));
      box.append(h('div', { class: 'line' }, h('div', { class: 'grid' }, sel, qty, h('button', { class: 'rm', type: 'button', text: '×', 'aria-label': 'حذف', onclick: () => (st.extra.splice(i, 1), ctx.refresh()) }))));
    });
    const deduct = checkbox('يُخصم من الالتزام العيني للأسرة (نفس الصنف أو ما هو بديل له)', st.deduct);
    deduct.input.addEventListener('change', () => ((st.deduct = deduct.input.checked), ctx.refresh()));
    const valid = st.extra.filter((it) => it.itemId && it.qty > 0);
    const plan = planInkindExtra(S(), { familyIds: valid.length ? ids : [], items: valid, date: dateVal, deduct: st.deduct, fromMonth: st.from, toMonth: toMonthOf(st), batchId, udhiyaId: st.udhiyaId, note: st.udhiyaId ? `لحم أضحية: ${S().udhiya.get(st.udhiyaId)?.name || ''}` : 'توزيع عيني إضافي' });
    const short = plan.totals.filter((t) => t.short > 0);
    const covered = plan.movements.filter((m) => m.inkindLines).length;
    body.append(
      h('p', { class: 'muted', text: 'كمية ثابتة لكل أسرة (مثل لحم الأضاحي أو كرتونة رمضان). إن كانت تقلل المستحق العيني للأسرة فعّل الخصم.' }),
      st.udhiyaId ? h('div', { class: 'banner info', text: `من نصيب الفقراء في: ${S().udhiya.get(st.udhiyaId)?.name || ''}` }) : null,
      h('div', { class: 'label muted small', text: 'الصنف — الكمية لكل أسرة' }),
      box,
      h('button', { class: 'btn small', type: 'button', text: '+ صنف', onclick: () => (st.extra.push({ itemId: itemOpts()[0]?.value, qty: null }), ctx.refresh()) }),
      field('تاريخ التوزيع', date),
      deduct,
      st.deduct ? periodControls(st, { label: 'يُخصم من التزام شهر' }) : null,
      picker,
    );
    if (plan.totals.length) body.append(sectionTitle('الإجمالي من كل نوع'), totalsTable(plan.totals), st.deduct ? h('div', { class: 'muted small', style: { margin: '6px 4px' }, text: `${F.num(covered)} أسرة سيُخصم من التزامها العيني.` }) : null);
    if (short.length) body.append(h('div', { class: 'banner', text: 'المخزون لا يكفي هذه الكمية.' }));
    body.append(
      h('button', {
        class: 'btn primary block',
        text: `توزيع على ${F.num(plan.movements.length)} أسرة`,
        disabled: !plan.movements.length || short.length > 0,
        onclick: async () => {
          const ok = await runBatch(plan, { title: 'تأكيد التوزيع', message: `${F.num(plan.movements.length)} أسرة.\n${plan.totals.map((t) => `${itemName(t.itemId)}: ${F.qty(t.qty)} ${itemUnit(t.itemId)}`).join('، ')}` });
          if (ok) Object.assign(st, { picked: null, extra: [], udhiyaId: null });
        },
      }),
    );
  }
  return { title: 'صرف مجمّع', subtitle: 'عدة أسر وعدة شهور مرة واحدة', body };
}

// ---------- خطة الشراء ----------
export function purchasePlanScreen() {
  const st = ui('purchasePlan', { picked: null, from: ctx.nowMonth(), count: 1, items: null, choices: {}, deductStock: true });
  const body = h('div', {});
  const to = toMonthOf(st);
  const rows = activeFamilies()
    .filter((f) => hasInkindPlan(S(), f.id))
    .map((f) => {
      const left = inkindRemaining(S(), f.id, st.from, to);
      return { id: f.id, name: f.name, n: left.length, subtitle: left.length ? [...new Set(left.map((l) => itemName(l.itemId)))].join('، ') : 'مستوفى' };
    })
    .filter((r) => r.n > 0);
  const picker = familyPicker(st, rows);
  const ids = rows.map((r) => r.id).filter((id) => st.picked.has(id));
  const items = itemControls(st, ids);
  const stock = checkbox('اطرح الموجود في المخزن', st.deductStock);
  stock.input.addEventListener('change', () => ((st.deductStock = stock.input.checked), ctx.refresh()));
  const sug = suggestPurchase(S(), { familyIds: ids, fromMonth: st.from, toMonth: to, itemIds: st.items ? [...st.items] : null, choices: st.choices, date: ctx.today(), deductStock: st.deductStock });
  const buy = sug.filter((x) => x.buy > 0);
  body.append(h('p', { class: 'muted', text: 'حدّد كم شهراً، ومن أي الأنواع، ولكم أسرة — تُقترح الكميات، ويبقى عليك إدخال الأسعار فقط.' }), periodControls(st, { label: 'يكفي من شهر' }), picker, items, stock);
  if (sug.length) {
    body.append(
      sectionTitle('الكميات المقترحة'),
      table(
        [{ label: 'الصنف' }, { label: 'الحاجة', num: true }, { label: 'في المخزن', num: true }, { label: 'يُشترى', num: true }, { label: 'أسر', num: true }],
        sug.map((x) => [`${itemName(x.itemId)} (${itemUnit(x.itemId)})`, F.qty(x.need), F.qty(x.stock), F.qty(x.buy), F.num(x.families)]),
        { pg: 'assets' },
      ),
    );
  }
  body.append(
    h('button', {
      class: 'btn primary block',
      text: buy.length ? `فتح فاتورة الشراء (${F.num(buy.length)} صنف) — أدخل الأسعار` : 'لا حاجة للشراء في هذا الاختيار',
      disabled: !buy.length,
      onclick: () => purchaseForm({ preset: { lines: buy.map((x) => ({ itemId: x.itemId, qty: x.buy })), note: `خطة شراء: ${F.num(ids.length)} أسرة × ${F.num(st.count)} شهر من ${F.month(st.from)}` } }),
    }),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'بعد الشراء: توزيع عيني مجمّع', onclick: () => openBatch({ mode: 'inkind', families: ids }) })),
  );
  void computeLedger;
  void itemPosition;
  return { title: 'خطة الشراء', subtitle: 'كميات مقترحة حسب الالتزام العيني', body };
}
