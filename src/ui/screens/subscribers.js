// المشتركون: القائمة + كشف المشترك (شهور: مسدد / متبقي / مقدم).
import { h } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { row, badge, list, empty, sectionTitle, chips, monthGrid, monthLegend, kv } from '../components.js';
import { ui, movementList, yearChips, collator } from '../widgets.js';
import { firstFiscalYear, requiredAt, closedThrough } from '../../core/engine.js';
import { arrearsFor, subscriberSummary, subscriberIndex } from '../../core/subscriptions.js';
import { receiptForm } from '../forms-movements.js';
import { subscriberForm, subscriptionForm, dueDecisionForm } from '../forms-entities.js';

export function subscribersScreen() {
  const S = ctx.state;
  const st = ui('subscribers', { q: '', filter: 'active' });
  const now = ctx.nowMonth();
  const body = h('div', {});
  const search = h('input', { class: 'search', type: 'search', placeholder: 'بحث بالاسم أو الكود…', value: st.q, 'aria-label': 'بحث' });
  const box = h('div', {});
  const draw = () => {
    const q = st.q.trim().toLowerCase();
    let rows = [...S.subscribers.values()].map((s) => {
      const due = arrearsFor(S, s.id, now);
      return { s, due, total: due.reduce((a, m) => a + m.remaining, 0), req: requiredAt(S, s.id, now) };
    });
    rows = rows.filter((r) => {
      if (q && !`${r.s.name} ${r.s.code || ''} ${r.s.phone || ''}`.toLowerCase().includes(q)) return false;
      if (st.filter === 'archived') return !!r.s.archived;
      if (r.s.archived) return false;
      if (st.filter === 'late') return r.total > 0;
      if (st.filter === 'ok') return r.total === 0 && r.req > 0;
      if (st.filter === 'nosub') return r.req === 0;
      return true;
    });
    rows.sort((a, b) => collator.compare(a.s.name, b.s.name));
    box.replaceChildren(
      rows.length
        ? list(
            rows.map((r) =>
              row({
                title: r.s.name,
                subtitle: r.req ? `اشتراك ${F.egp(r.req)} شهرياً` : 'بلا اشتراك شهري',
                value: r.total ? F.money(r.total) : '',
                valueClass: 'neg',
                badge: r.total ? badge(`متأخر ${F.num(r.due.length)} شهر`, 'bad') : r.req ? badge('منتظم', 'ok') : null,
                onclick: () => ctx.nav(`#/subscriber/${r.s.id}`),
              }),
            ),
          )
        : empty(S.subscribers.size ? 'لا نتائج' : 'لا يوجد مشتركون بعد'),
    );
  };
  search.addEventListener('input', () => {
    st.q = search.value;
    draw();
  });
  body.append(
    search,
    chips(
      [
        { value: 'active', label: 'الكل' },
        { value: 'late', label: 'متأخرون' },
        { value: 'ok', label: 'منتظمون' },
        { value: 'nosub', label: 'بلا اشتراك' },
        { value: 'archived', label: 'مؤرشفون' },
      ],
      st.filter,
      (v) => {
        st.filter = v;
        draw();
      },
    ),
    box,
  );
  draw();
  return { title: 'المشتركون', subtitle: `${F.num([...S.subscribers.values()].filter((s) => !s.archived).length)} مشترك`, body, root: true, fab: { label: 'مشترك جديد', onclick: async () => { const id = await subscriberForm(); if (id) ctx.nav(`#/subscriber/${id}`); } } };
}

export function subscriberScreen({ id }) {
  const S = ctx.state;
  const s = S.subscribers.get(id);
  if (!s) return { title: 'مشترك', body: empty('المشترك غير موجود') };
  const now = ctx.nowMonth();
  const fy = ctx.fiscalYear();
  const st = ui(`subscriber:${id}`, { year: Math.max(fy, Number(now.slice(0, 4))) });
  const first = firstFiscalYear(S);
  const body = h('div', {});
  const req = requiredAt(S, id, now);
  const sum = subscriberSummary(S, id, `${st.year}-01`, `${st.year}-12`, now);
  const idx = subscriberIndex(S).get(id);
  const allDue = arrearsFor(S, id, now);
  const dueTotal = allDue.reduce((a, m) => a + m.remaining, 0);

  body.append(
    h(
      'div',
      { class: 'card' },
      kv('الاشتراك الحالي', req ? F.egp(req) : 'لا يوجد'),
      kv('إجمالي المتأخر حتى الآن', dueTotal ? `${F.egp(dueTotal)} (${F.num(allDue.length)} شهر)` : 'لا شيء', dueTotal ? 'neg' : 'pos'),
      kv('إجمالي ما دفعه', F.egp(idx?.total || 0)),
      s.code ? kv('الكود', s.code) : null,
      s.phone ? kv('الهاتف', s.phone) : null,
      s.note ? kv('ملاحظة', s.note) : null,
    ),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', text: 'دفعة', onclick: () => receiptForm({ subscriberId: id }) }),
      h('button', { class: 'btn', text: 'تغيير الاشتراك', onclick: () => subscriptionForm(id) }),
      h('button', { class: 'btn', text: 'تعديل البيانات', onclick: () => subscriberForm(s) }),
    ),
  );

  // متأخرات السنوات المقفولة: تظل ظاهرة هنا فقط
  const closed = closedThrough(S);
  const carried = closed !== null ? allDue.filter((m) => Number(m.month.slice(0, 4)) <= closed) : [];
  if (carried.length && st.year > closed) {
    body.append(sectionTitle(`متأخرات مرحّلة من سنوات مقفولة (${F.num(carried.length)} شهر)`));
    body.append(h('div', { class: 'card' }, monthGrid(carried, { onTap: (m) => monthTap(id, m), amountOf: (m) => m.remaining })));
  }

  body.append(
    sectionTitle(`كشف سنة ${F.num(st.year)}`),
    yearChips(first, st.year, (y) => {
      st.year = y;
      ctx.refresh();
    }),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'legend', style: { marginTop: 0, marginBottom: '10px' } }, badge(`مسدد ${F.num(sum.paidCount)}`, 'ok'), badge(`متبقي ${F.num(sum.dueCount)}`, 'bad'), badge(`مقدم ${F.num(sum.advanceCount)}`, 'info'), sum.writeoffCount ? badge(`لن يُسدد ${F.num(sum.writeoffCount)}`) : null),
      monthGrid(sum.months, { onTap: (m) => monthTap(id, m) }),
      monthLegend(),
      h('div', { style: { marginTop: '10px' } }, kv('مطلوب السنة', F.egp(sum.required)), kv('مسدد لشهور السنة', F.egp(sum.paid)), kv('متبقي حتى الآن', F.egp(sum.remaining), sum.remaining ? 'neg' : '')),
    ),
  );

  if (s.versions.length) {
    body.append(sectionTitle('تاريخ الاشتراك'));
    body.append(list([...s.versions].reverse().map((v) => row({ title: v.amount ? F.egp(v.amount) : 'متوقف', subtitle: `من ${F.month(v.from)}` }))));
  }
  body.append(sectionTitle('الدفعات'));
  body.append(movementList([...(idx?.receipts || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq)), { emptyText: 'لا توجد دفعات', limit: 100 }));
  return { title: s.name, subtitle: s.archived ? 'مؤرشف' : '', body };
}

async function monthTap(id, m) {
  if (m.status === 'due' || m.status === 'partial' || m.status === 'writeoff') {
    await dueDecisionForm({ entity: 'subscriber', entityId: id, month: m.month, current: m.status });
  }
}
