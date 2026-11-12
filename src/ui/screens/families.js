// الأسر: القائمة + كشف الأسرة (شهور الاستحقاق: وصل / متبقي).
import { h } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { row, badge, list, empty, sectionTitle, chips, monthGrid, monthLegend, kv } from '../components.js';
import { ui, movementList, yearChips, collator } from '../widgets.js';
import { firstFiscalYear, profileAt, closedThrough } from '../../core/engine.js';
import { computePoints, entitlementAt, familyDues, familyIndex, familySummary } from '../../core/families.js';
import { FAMILY_STATUS } from '../../config/defaults.js';
import { distributionForm } from '../forms-movements.js';
import { familyForm, familyProfileForm, dueDecisionForm } from '../forms-entities.js';

const currentProfile = (S, f, month) => profileAt(S, f.id, month) || f.profiles[0] || null;
const STATUS_BADGE = { permanent: ['دائمة', 'ok'], occasional: ['عند الحاجة', 'info'], paused: ['موقوفة', ''] };

export function familiesScreen() {
  const S = ctx.state;
  const st = ui('families', { q: '', filter: 'all' });
  const now = ctx.nowMonth();
  const body = h('div', {});
  const search = h('input', { class: 'search', type: 'search', placeholder: 'بحث بالاسم أو الكود…', value: st.q, 'aria-label': 'بحث' });
  const box = h('div', {});
  const cats = [...S.lists.familyCategories.values()].filter((c) => !c.archived);
  const draw = () => {
    const q = st.q.trim().toLowerCase();
    let rows = [...S.families.values()].map((f) => {
      const p = currentProfile(S, f, now);
      const dues = familyDues(S, f.id, now);
      return { f, p, dues, total: dues.reduce((a, m) => a + m.remaining, 0), ent: entitlementAt(S, f.id, now) };
    });
    rows = rows.filter((r) => {
      if (q && !`${r.f.name} ${r.f.code || ''} ${r.f.note || ''}`.toLowerCase().includes(q)) return false;
      if (st.filter === 'archived') return !!r.f.archived;
      if (r.f.archived) return false;
      if (st.filter === 'due') return r.total > 0;
      if (['permanent', 'occasional', 'paused'].includes(st.filter)) return (r.p?.status || 'occasional') === st.filter;
      if (st.filter.startsWith('cat:')) return (r.p?.categories || []).includes(st.filter.slice(4));
      return true;
    });
    rows.sort((a, b) => collator.compare(a.f.name, b.f.name));
    box.replaceChildren(
      rows.length
        ? list(
            rows.map((r) => {
              const sb = STATUS_BADGE[r.p?.status || 'occasional'];
              const pts = computePoints(S.settings.criteria, r.p);
              return row({
                title: r.f.name,
                subtitle: [r.p?.members ? `${F.num(r.p.members)} أفراد` : '', `${F.num(pts)} نقطة`, r.ent ? `${F.egp(r.ent)} شهرياً` : ''].filter(Boolean).join(' · '),
                value: r.total ? F.money(r.total) : '',
                valueClass: 'neg',
                badge: r.total ? badge(`متبقي ${F.num(r.dues.length)} شهر`, 'warn') : badge(sb[0], sb[1]),
                onclick: () => ctx.nav(`#/family/${r.f.id}`),
              });
            }),
          )
        : empty(S.families.size ? 'لا نتائج' : 'لا توجد أسر بعد'),
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
        { value: 'all', label: 'الكل' },
        { value: 'due', label: 'لها متبقي' },
        { value: 'permanent', label: 'دائمة' },
        { value: 'occasional', label: 'عند الحاجة' },
        { value: 'paused', label: 'موقوفة' },
        ...cats.map((c) => ({ value: `cat:${c.id}`, label: c.name })),
        { value: 'archived', label: 'مؤرشفة' },
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
  return { title: 'الأسر', subtitle: `${F.num([...S.families.values()].filter((f) => !f.archived).length)} أسرة`, body, root: true, fab: {
      label: 'أسرة جديدة',
      onclick: async () => {
        const id = await familyForm();
        if (!id) return;
        // بعد الانتقال لصفحة الأسرة افتح ملفها مباشرة (الانتقال يغلق أي نافذة مفتوحة أولاً)
        window.addEventListener('hashchange', () => familyProfileForm(id), { once: true });
        ctx.nav(`#/family/${id}`);
      },
    },
  };
}

export function familyScreen({ id }) {
  const S = ctx.state;
  const f = S.families.get(id);
  if (!f) return { title: 'أسرة', body: empty('الأسرة غير موجودة') };
  const now = ctx.nowMonth();
  const st = ui(`family:${id}`, { year: Math.max(ctx.fiscalYear(), Number(now.slice(0, 4))) });
  const p = currentProfile(S, f, now);
  const crit = S.settings.criteria;
  const idx = familyIndex(S).get(id);
  const dues = familyDues(S, id, now);
  const dueTotal = dues.reduce((a, m) => a + m.remaining, 0);
  const sum = familySummary(S, id, `${st.year}-01`, `${st.year}-12`, now);
  const body = h('div', {});
  const catNames = (p?.categories || []).map((c) => S.lists.familyCategories.get(c)?.name).filter(Boolean);
  const flagNames = (p?.flags || []).map((x) => crit.flags.find((fl) => fl.id === x)?.name).filter(Boolean);
  body.append(
    h(
      'div',
      { class: 'card' },
      kv('الحالة', FAMILY_STATUS[p?.status] || 'لم يُحدَّد ملف'),
      kv('عدد الأفراد', F.num(p?.members || 0)),
      kv('نقاط الاستحقاق', F.num(computePoints(crit, p))),
      kv('الاستحقاق الشهري', entitlementAt(S, id, now) ? F.egp(entitlementAt(S, id, now)) : 'لا يوجد'),
      kv('المتبقي حتى الآن', dueTotal ? `${F.egp(dueTotal)} (${F.num(dues.length)} شهر)` : 'لا شيء', dueTotal ? 'neg' : 'pos'),
      kv('إجمالي ما صُرف نقداً', F.egp(idx?.cash || 0)),
      p?.needLevel ? kv('درجة الاحتياج', crit.needLevels.find((l) => l.id === p.needLevel)?.name || '') : null,
      flagNames.length ? kv('حالات', flagNames.join('، ')) : null,
      catNames.length ? kv('الفئات', catNames.join('، ')) : null,
      p?.preference ? kv('رغبتهم', p.preference) : null,
      f.code ? kv('الكود', f.code) : null,
      f.phone ? kv('الهاتف', f.phone) : null,
      f.address ? kv('العنوان', f.address) : null,
      f.note ? kv('ملاحظة', f.note) : null,
    ),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', text: 'صرف', onclick: () => distributionForm({ familyId: id }) }),
      h('button', { class: 'btn', text: 'تحديث الملف', onclick: () => familyProfileForm(id) }),
      h('button', { class: 'btn', text: 'تعديل البيانات', onclick: () => familyForm(f) }),
    ),
  );
  const tap = (m) => {
    if (['due', 'partial', 'writeoff'].includes(m.status)) dueDecisionForm({ entity: 'family', entityId: id, month: m.month, current: m.status });
  };
  const closed = closedThrough(S);
  const carried = closed !== null ? dues.filter((m) => Number(m.month.slice(0, 4)) <= closed) : [];
  if (carried.length && st.year > closed) {
    body.append(sectionTitle(`استحقاقات مرحّلة من سنوات مقفولة (${F.num(carried.length)} شهر)`), h('div', { class: 'card' }, monthGrid(carried, { onTap: tap, amountOf: (m) => m.remaining })));
  }
  body.append(
    sectionTitle(`استحقاق سنة ${F.num(st.year)}`),
    yearChips(firstFiscalYear(S), st.year, (y) => {
      st.year = y;
      ctx.refresh();
    }),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'legend', style: { marginTop: 0, marginBottom: '10px' } }, badge(`وصل ${F.num(sum.deliveredCount)}`, 'ok'), badge(`متبقي ${F.num(sum.dueCount)}`, 'bad'), badge(`مقدم ${F.num(sum.advanceCount)}`, 'info')),
      monthGrid(sum.months, { onTap: tap, amountOf: (m) => (m.remaining > 0 ? m.remaining : m.received) }),
      monthLegend('family'),
    ),
  );
  if (f.profiles.length) {
    body.append(sectionTitle('تاريخ ملف الأسرة'));
    body.append(
      list(
        [...f.profiles].reverse().map((v) =>
          row({
            title: `${FAMILY_STATUS[v.status] || ''}${v.status === 'permanent' ? ` — ${F.egp(entitlementAt(S, id, v.from))}` : ''}`,
            subtitle: `من ${F.month(v.from)} · ${F.num(v.members || 0)} أفراد · ${F.num(computePoints(crit, v))} نقطة`,
          }),
        ),
      ),
    );
  }
  body.append(sectionTitle('ما صُرف للأسرة'));
  body.append(movementList([...(idx?.distributions || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq)), { emptyText: 'لم يُصرف شيء بعد', limit: 100 }));
  return { title: f.name, subtitle: f.archived ? 'مؤرشفة' : '', body };
}
