// صندوق الأضحية — جزء منفصل: ذبائح باشتراكات ونِسب مختلفة وتكاليف ذبح ونقل.
// لا يدخل حسابات المشروع الخيري إلا نصيب الفقراء (يُرحَّل للمخزن بكميته وقيمته ثم يُوزَّع ويُعرف لمن ذهب).
import { h, clear } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { openSheet, field, moneyInput, qtyInput, dateInput, selectInput, textInput, intInput, errorBox, toast, confirmDialog, row, list, empty, sectionTitle, kv, badge, stat, table } from '../components.js';
import { udhiyaSummary, udhiyaPostMovement, udhiyaSeasons } from '../../core/udhiya.js';
import { UDHIYA_KINDS } from '../../config/defaults.js';
import { normalizeDigits } from '../../core/money.js';
import { newId } from '../../core/util.js';
import { openBatch } from './inkind.js';

const S = () => ctx.state;
const sumOf = (u) => udhiyaSummary(S(), u, { step: ctx.steps(u.date).money });
const int = (v) => {
  const s = normalizeDigits(v ?? '').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
};
const itemOpts = () => [...S().lists.items.values()].filter((i) => !i.archived).map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }));
const save = async (data, msg = 'تم الحفظ') => {
  await ctx.store.dispatch('udhiya.upsert', data);
  toast(msg);
};

export function udhiyaListScreen() {
  const body = h('div', {});
  const seasons = udhiyaSeasons(S());
  body.append(h('div', { class: 'banner info', text: 'اشتراكات الأضاحي مال أصحابها: تُدار هنا منفصلة ولا تدخل أرصدة الصناديق. يدخل حسابات المشروع فقط ما تُبرِّع به للفقراء.' }));
  if (!seasons.length) body.append(empty('لا ذبائح بعد — أضف عجلاً أو بقرة أو جاموساً أو خروفاً وسجّل المشتركين بأسهمهم.'));
  for (const { season, list: arr } of seasons) {
    let total = 0;
    let poor = 0;
    let out = 0;
    const rows = arr
      .filter((u) => !u.archived)
      .map((u) => {
        const s = sumOf(u);
        total += s.total;
        poor += s.poorValue;
        out += s.outstanding;
        return row({ title: u.name, subtitle: [u.kind, `${F.num(s.sold)}/${F.num(s.totalParts)} سهم`, s.poorQty ? `للفقراء ${F.qty(s.poorQty)} كجم` : ''].filter(Boolean).join(' · '), value: F.money(s.total), badge: s.outstanding ? badge(`باقٍ ${F.money(s.outstanding)}`, 'warn') : s.postedQty >= s.poorQty && s.poorQty ? badge('رُحّل', 'ok') : null, onclick: () => ctx.nav(`#/udhiya/${u.id}`) });
      });
    body.append(sectionTitle(`موسم ${F.num(season)}`), h('div', { class: 'stats' }, stat('تكلفة الذبائح', F.money(total), { pk: `other|udhiya-total-${season}` }), stat('قيمة نصيب الفقراء', F.money(poor), { pk: `other|udhiya-poor-${season}`, hint: out ? `باقٍ على المشتركين ${F.money(out)}` : '' })), list(rows));
  }
  return { title: 'صندوق الأضحية', subtitle: 'اشتراكات ونِسب — منفصل عن حسابات المشروع', body, fab: { label: 'ذبيحة جديدة', onclick: () => udhiyaForm() } };
}

function udhiyaForm(u = null) {
  openSheet(u ? 'تعديل الذبيحة' : 'ذبيحة جديدة', (body, close) => {
    const err = errorBox();
    const name = textInput(u?.name, 'مثلاً: عجل 1');
    const kind = selectInput(UDHIYA_KINDS.map((k) => ({ value: k, label: k })), u?.kind || UDHIYA_KINDS[0]);
    const date = dateInput(u?.date);
    const parts = intInput(u?.totalParts ?? 7);
    const price = moneyInput(u?.price ?? null);
    const live = qtyInput(u?.liveWeight ?? null);
    const meat = qtyInput(u?.meatWeight ?? null);
    const poor = qtyInput(u?.poorQty ?? null);
    const item = selectInput(itemOpts(), u?.itemId || 'i-meat');
    kind.addEventListener('change', () => {
      if (!u) parts.value = ['خروف', 'ماعز'].includes(kind.value) ? 1 : 7;
    });
    const onSave = async () => {
      if (!name.value.trim()) return err.show('اكتب اسم الذبيحة');
      const tp = int(parts.value);
      if (!tp) return err.show('عدد الأسهم غير صالح');
      try {
        const id = u?.id || newId('u-');
        await save({ id, name: name.value.trim(), kind: kind.value, season: Number(date.value.slice(0, 4)), date: date.value, totalParts: tp, price: price.units() || 0, liveWeight: live.units() || 0, meatWeight: meat.units() || 0, poorQty: poor.units() || 0, itemId: item.value, costs: u?.costs || [], shares: u?.shares || [] });
        close(true);
        if (!u) ctx.nav(`#/udhiya/${id}`);
      } catch (e) {
        err.show(e.message);
      }
    };
    body.append(
      err,
      field('الاسم', name),
      h('div', { class: 'grid2' }, field('النوع', kind), field('عدد الأسهم الكلي', parts, 'البقر والجاموس والإبل 7')),
      h('div', { class: 'grid2' }, field('ثمن الشراء (جنيه)', price), field('التاريخ', date)),
      h('div', { class: 'grid2' }, field('الوزن القائم (كجم)', live), field('وزن اللحم الصافي (كجم)', meat)),
      h('div', { class: 'grid2' }, field('نصيب الفقراء (كجم)', poor, 'هذا فقط ما يدخل حسابات المشروع'), field('صنف اللحم في المخزن', item)),
      h('button', { class: 'btn primary block', type: 'button', text: 'حفظ', onclick: onSave }),
    );
  });
}

function shareForm(u, share = null) {
  openSheet(share ? 'تعديل مشترك' : 'مشترك في الذبيحة', (body, close) => {
    const err = errorBox();
    const name = textInput(share?.name, 'اسم المشترك');
    const parts = intInput(share?.parts ?? 1);
    const paid = moneyInput(share?.paid ?? null);
    const s = sumOf(u);
    const onSave = async () => {
      const p = int(parts.value);
      if (!name.value.trim()) return err.show('اكتب الاسم');
      if (!p) return err.show('عدد الأسهم غير صالح');
      const next = { id: share?.id || newId('sh').slice(0, 8), name: name.value.trim(), parts: p, paid: paid.units() || 0 };
      try {
        await save({ id: u.id, shares: share ? u.shares.map((x) => (x.id === share.id ? next : x)) : [...(u.shares || []), next] });
        close(true);
      } catch (e) {
        err.show(e.message);
      }
    };
    body.append(
      err,
      h('div', { class: 'muted small', style: { marginBottom: '8px' }, text: `المتاح ${F.num(s.unsold + (share?.parts || 0))} سهم من ${F.num(s.totalParts)} — تكلفة السهم تقريباً ${F.egp(s.totalParts ? Math.round(s.total / s.totalParts) : 0)}` }),
      field('الاسم', name),
      h('div', { class: 'grid2' }, field('عدد الأسهم', parts), field('المدفوع (جنيه)', paid)),
      h('button', { class: 'btn primary block', type: 'button', text: 'حفظ', onclick: onSave }),
      share
        ? h('button', {
            class: 'btn danger block',
            style: { marginTop: '8px' },
            type: 'button',
            text: 'حذف المشترك',
            onclick: async () => {
              if (!(await confirmDialog({ title: 'حذف المشترك من الذبيحة؟', danger: true, okText: 'حذف' }))) return;
              await save({ id: u.id, shares: u.shares.filter((x) => x.id !== share.id) });
              close(true);
            },
          })
        : null,
    );
  });
}

function costForm(u) {
  openSheet('تكلفة إضافية (ذبح / نقل / علف…)', (body, close) => {
    const err = errorBox();
    const name = selectInput(['ذبح وتقطيع', 'نقل', 'علف ورعاية', 'أكياس وتعبئة', 'أخرى'].map((k) => ({ value: k, label: k })), 'ذبح وتقطيع');
    const amount = moneyInput(null);
    body.append(
      err,
      field('البند', name),
      field('المبلغ (جنيه)', amount),
      h('button', {
        class: 'btn primary block',
        type: 'button',
        text: 'إضافة',
        onclick: async () => {
          const a = amount.units();
          if (!a || a <= 0) return err.show('أدخل المبلغ');
          try {
            await save({ id: u.id, costs: [...(u.costs || []), { name: name.value, amount: a }] });
            close(true);
          } catch (e) {
            err.show(e.message);
          }
        },
      }),
    );
  });
}

export function udhiyaScreen({ id }) {
  const u = S().udhiya.get(id);
  if (!u) return { title: 'ذبيحة', body: empty('غير موجودة') };
  const s = sumOf(u);
  const body = h('div', {});
  const famName = (fid) => S().families.get(fid)?.name || 'مستفيد';
  body.append(
    h('div', { class: 'stats' }, stat('التكلفة الكلية', F.money(s.total), { cls: 'primary', hint: `ثمن ${F.money(u.price || 0)} + تكاليف ${F.money(s.extra)}`, pk: 'other|udhiya-cost' }), stat('المدفوع من المشتركين', F.money(s.paid), { hint: s.outstanding ? `باقٍ ${F.money(s.outstanding)}` : 'لا باقٍ', valueClass: s.outstanding ? '' : 'pos', pk: 'other|udhiya-paid' })),
    h(
      'div',
      { class: 'card' },
      kv('النوع', u.kind || '', '', { secret: false }),
      kv('التاريخ', F.date(u.date), '', { secret: false }),
      kv('الأسهم', `${F.num(s.sold)} مباعة من ${F.num(s.totalParts)}${s.unsold ? ` — ${F.num(s.unsold)} متاحة` : ''}`, '', { secret: false }),
      u.liveWeight ? kv('الوزن القائم', `${F.qty(u.liveWeight)} كجم`, '', { secret: false }) : null,
      u.meatWeight ? kv('اللحم الصافي', `${F.qty(u.meatWeight)} كجم${s.yieldPct !== null ? ` (${F.num(s.yieldPct)}%)` : ''}`, '', { secret: false }) : null,
      s.costPerKg !== null ? kv('تكلفة كيلو اللحم', F.egp(s.costPerKg)) : null,
      s.perPartMeat ? kv('لحم السهم الواحد', `${F.qty(s.perPartMeat)} كجم`, '', { secret: false }) : null,
    ),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'تعديل البيانات', onclick: () => udhiyaForm(u) }), h('button', { class: 'btn small', text: '+ تكلفة (ذبح / نقل)', onclick: () => costForm(u) })),
  );
  if ((u.costs || []).length) {
    body.append(
      sectionTitle('تكاليف إضافية'),
      list(
        u.costs.map((c, i) =>
          row({
            title: c.name,
            value: F.money(c.amount),
            pk: 'other|udhiya-costs',
            onclick: async () => {
              if (await confirmDialog({ title: `حذف «${c.name}»؟`, danger: true, okText: 'حذف' })) await save({ id, costs: u.costs.filter((_, j) => j !== i) });
            },
          }),
        ),
      ),
    );
  }
  body.append(sectionTitle('المشتركون ونِسبهم', h('button', { text: '+ مشترك', onclick: () => shareForm(u) })));
  body.append(
    s.shares.length
      ? table(
          [{ label: 'المشترك' }, { label: 'أسهم', num: true }, { label: 'النسبة', num: true }, { label: 'نصيبه من التكلفة', num: true }, { label: 'دفع', num: true }, { label: 'الباقي', num: true }, { label: 'لحمه (كجم)', num: true }],
          s.shares.map((r) => [r.name, F.num(r.parts), `${F.num(r.pct)}%`, F.money(r.cost), F.money(r.paid), r.balance === 0 ? '—' : r.balance < 0 ? `عليه ${F.money(-r.balance)}` : `له ${F.money(r.balance)}`, F.qty(r.meat)]),
          { pg: 'other', totalRow: ['الإجمالي', F.num(s.sold), '', F.money(s.shares.reduce((a, r) => a + r.cost, 0)), F.money(s.paid), s.outstanding ? `باقٍ ${F.money(s.outstanding)}` : '—', ''] },
        )
      : empty('لا مشتركين بعد'),
  );
  if (s.shares.length) body.append(h('div', { class: 'chips' }, s.shares.map((r) => h('button', { class: 'chip', text: `تعديل: ${r.name}`, onclick: () => shareForm(u, u.shares.find((x) => x.id === r.id)) }))));
  if (s.unsold) body.append(h('div', { class: 'muted small', style: { margin: '4px' }, text: `${F.num(s.unsold)} سهم غير مباع — نصيبه من التكلفة ${F.egp(s.unsoldCost)}` }));

  // نصيب الفقراء: الجزء الوحيد الذي يدخل حسابات المشروع
  body.append(sectionTitle('نصيب الفقراء (يدخل حسابات المشروع)'));
  const left = Math.max(0, s.poorQty - s.postedQty);
  body.append(
    h('div', { class: 'card' }, kv('الكمية', `${F.qty(s.poorQty)} كجم`, '', { secret: false }), kv('قيمته (بتكلفة الكيلو)', F.egp(s.poorValue)), kv('رُحّل للمخزن', `${F.qty(s.postedQty)} كجم`, s.postedQty >= s.poorQty && s.poorQty ? 'pos' : '', { secret: false }), kv('وُزّع على الأسر', `${F.qty(s.givenQty)} كجم لـ ${F.num(new Set(s.given.map((m) => m.familyId)).size)} أسرة`, '', { secret: false })),
    h(
      'div',
      { class: 'btn-row' },
      h('button', {
        class: 'btn primary',
        text: left ? `ترحيل ${F.qty(left)} كجم للمخزن` : 'رُحّل كله',
        disabled: !left || !u.itemId,
        onclick: async () => {
          if (!(await confirmDialog({ title: 'ترحيل نصيب الفقراء', message: `يُسجَّل تبرع عيني: ${F.qty(left)} كجم بقيمة تقديرية بتكلفة الكيلو. هذا الجزء فقط يدخل حسابات المشروع.`, okText: 'ترحيل' }))) return;
          try {
            await ctx.store.run((book) => book.addMovement(udhiyaPostMovement(book.state, u, { date: ctx.today() >= u.date ? ctx.today() : u.date, step: ctx.steps(u.date).money }), { now: new Date() }));
            toast('رُحّل نصيب الفقراء للمخزن');
          } catch (e) {
            toast(e.message, 'bad');
          }
        },
      }),
      h('button', { class: 'btn', text: 'توزيع على الأسر', disabled: !s.postedQty, onclick: () => openBatch({ mode: 'extra', families: [], extra: [{ itemId: u.itemId, qty: null }], udhiyaId: id }) }),
    ),
  );
  if (s.given.length) body.append(sectionTitle('راح لمين'), list(s.given.map((m) => row({ title: famName(m.familyId), subtitle: `${F.date(m.date)}${m.inkindLines ? ' · خُصم من الالتزام العيني' : ''}`, value: `${F.qty(m.items.reduce((a, it) => a + it.qty, 0))} كجم`, onclick: () => ctx.nav(`#/movement/${m.id}`), pk: 'other|udhiya-given' }))));
  void clear;
  return { title: u.name, subtitle: `أضحية — موسم ${F.num(u.season || u.date.slice(0, 4))}`, body };
}
