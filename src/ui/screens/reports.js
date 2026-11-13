// التقارير — منظّمة في أربعة أقسام:
//   1) لوحة القرار: أهم المؤشرات وتنبيهات مقترحة بروابط مباشرة.
//   2) تقارير للمشاركة: مجلس الإدارة، المشتركون، المتبرعون، عرض شامل للتقييم (بلا أسماء أسر).
//   3) تقرير الحركات: بآخر عدد محدد، أو بفترة، أو بأنواع محددة.
//   4) الجداول التحليلية والقوائم المالية.
// كل تقرير يُصدَّر بأكثر من طريقة: نص للمشاركة (واتساب)، طباعة / PDF، وملف Excel.
import { h } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { chips, table, empty, toast, saveFile, sectionTitle, stat, kv, field, selectInput, checkbox, list, row } from '../components.js';
import { ui } from '../widgets.js';
import { firstFiscalYear } from '../../core/engine.js';
import { buildXlsx } from '../../core/xlsx.js';
import { insights, buildBrief, movementsReport, BRIEF_AUDIENCES } from '../../core/briefs.js';
import { MOVEMENT_KINDS } from '../../config/defaults.js';
import { addMonths } from '../../core/util.js';
import { buildReports, buildExtraSheets, periodOf, displayCell, exportCell, toXlsxSheets } from '../report-data.js';
import { groupHidden, MASK } from '../privacy.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TABS = [
  ['month', 'بالشهر'],
  ['subscriber', 'بالشخص'],
  ['family', 'بالأسرة'],
  ['purpose', 'بالغرض'],
  ['category', 'بالفئة'],
  ['campaign', 'بالحملة'],
  ['fund', 'بالصندوق'],
  ['activities', 'قائمة الأنشطة'],
  ['position', 'المركز المالي'],
  ['trial', 'ميزان المراجعة'],
];
const SECTIONS = [
  { value: 'insights', label: 'لوحة القرار' },
  { value: 'briefs', label: 'تقارير للمشاركة' },
  { value: 'movements', label: 'تقرير الحركات' },
  { value: 'tables', label: 'جداول وقوائم مالية' },
];

const fmt = (v, type) => (v === null || v === undefined ? '—' : type === 'money' ? F.egp(v) : type === 'pct' ? `${F.num(v)}%` : type === 'qty' ? F.qty(v) : type === 'int' || type === 'num' ? F.num(v) : String(v));
const cellOf = (v, type) => (type === 'pct' || type === 'num' ? fmt(v, type) : displayCell(v, type));

async function share(text, okMsg = 'نُسخ النص') {
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('تعذّرت المشاركة', 'bad');
  }
}
async function saveXlsx(name, sheets) {
  try {
    const res = await saveFile(name, buildXlsx(sheets), XLSX_MIME);
    if (res !== 'cancelled') toast('تم تجهيز ملف Excel');
  } catch (e) {
    toast('تعذّر التصدير: ' + e.message, 'bad');
  }
}
// فتح صفحة الطباعة: التقرير وحده بلا أشرطة — «طباعة» في iPhone تتيح «حفظ كـ PDF» والمشاركة.
function openPrint(payload) {
  ui('print', {}).payload = payload;
  ctx.nav('#/print');
}
const exportBar = (...btns) => h('div', { class: 'btn-row no-print' }, btns);

// ---------- عرض تقرير موجَّه ----------
function renderBrief(b) {
  const out = h('div', { class: 'brief' });
  out.append(h('div', { class: 'brief-head' }, h('div', { class: 't', text: b.title }), h('div', { class: 'muted', text: [b.subtitle, `بتاريخ ${F.date(b.date)}`].filter(Boolean).join(' — ') })));
  const hidden = groupHidden('reports');
  for (const s of b.sections) {
    out.append(h('h2', { text: s.heading }));
    if (s.rows && s.rows.length) out.append(h('div', { class: 'card' }, s.rows.map(([k, v, t]) => kv(k, fmt(v, t), '', { pg: 'reports', secret: t !== 'text' }))));
    if (s.bars && s.bars.length > 1 && !hidden) {
      const max = Math.max(1, ...s.bars.map((x) => Math.abs(x.value)));
      out.append(
        h(
          'div',
          { class: 'bars' },
          s.bars.map((x) => {
            const fill = h('div', { class: 'fill' });
            fill.style.width = `${Math.max(2, Math.round((100 * Math.abs(x.value)) / max))}%`;
            return h('div', { class: 'bar' }, h('span', { text: x.label }), h('div', { class: 'track' }, fill), h('span', { class: 'num', text: x.type === 'int' ? F.num(x.value) : F.money(x.value) }));
          }),
        ),
      );
    }
    if (s.table) out.append(table(s.table.cols.map((c) => ({ label: c.label, num: c.type !== 'text' })), s.table.rows.map((r) => r.map((v, i) => cellOf(v, s.table.cols[i].type))), { pg: 'reports' }));
    if (s.notes && s.notes.length) out.append(h('ul', { class: 'notes' }, s.notes.map((n) => h('li', { text: n }))));
  }
  return out;
}

export function briefToText(b) {
  const lines = [`*${b.title}*`, [b.subtitle, F.date(b.date)].filter(Boolean).join(' — '), ''];
  for (const s of b.sections) {
    lines.push(`*${s.heading}*`);
    for (const [k, v, t] of s.rows || []) lines.push(`• ${k}: ${fmt(v, t)}`);
    if (s.table) for (const r of s.table.rows) lines.push('• ' + r.map((v, i) => (i === 0 ? v : `${s.table.cols[i].label} ${cellOf(v, s.table.cols[i].type)}`)).join(' — '));
    for (const n of s.notes || []) lines.push(`• ${n}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function briefSheets(b) {
  return b.sections.map((s, i) => {
    const rows = [[s.heading], []];
    for (const [k, v, t] of s.rows || []) rows.push([k, t === 'pct' || t === 'num' ? v : exportCell(v, t)]);
    if (s.table) {
      if (rows.length > 2) rows.push([]);
      rows.push(s.table.cols.map((c) => c.label), ...s.table.rows.map((r) => r.map((v, j) => exportCell(v, s.table.cols[j].type))));
    }
    for (const n of s.notes || []) rows.push([n]);
    return { name: `${i + 1}. ${s.heading}`.slice(0, 28).replace(/[\\/?*[\]:]/g, ' '), rows };
  });
}

// ---------- تقرير الحركات المخصص ----------
function movementsSection(body, S) {
  const st = ui('mvReport', { mode: 'last', n: 20, from: `${addMonths(ctx.nowMonth(), 0)}-01`, to: ctx.today(), kinds: [], fund: '' });
  body.append(
    chips(
      [
        { value: 'last', label: 'آخر عدد من الحركات' },
        { value: 'period', label: 'حركات فترة' },
        { value: 'all', label: 'كل الحركات' },
      ],
      st.mode,
      (v) => ((st.mode = v), ctx.refresh()),
    ),
  );
  if (st.mode === 'last') {
    const n = selectInput([5, 10, 20, 30, 50, 100, 200].map((x) => ({ value: String(x), label: `آخر ${x} حركة` })), String(st.n));
    n.addEventListener('change', () => ((st.n = Number(n.value)), ctx.refresh()));
    body.append(field('العدد', n));
  } else if (st.mode === 'period') {
    const from = h('input', { type: 'date', value: st.from });
    const to = h('input', { type: 'date', value: st.to });
    from.addEventListener('change', () => ((st.from = from.value), ctx.refresh()));
    to.addEventListener('change', () => ((st.to = to.value), ctx.refresh()));
    body.append(h('div', { class: 'grid2' }, field('من تاريخ', from), field('إلى تاريخ', to)));
  }
  const kindBox = h('div', { class: 'chips' });
  for (const [k, label] of Object.entries(MOVEMENT_KINDS)) {
    const on = st.kinds.includes(k);
    kindBox.append(h('button', { class: `chip ${on ? 'on' : ''}`, text: label, 'aria-pressed': on ? 'true' : 'false', onclick: () => ((st.kinds = on ? st.kinds.filter((x) => x !== k) : [...st.kinds, k]), ctx.refresh()) }));
  }
  const fund = selectInput([...S.lists.funds.values()].map((f) => ({ value: f.id, label: f.name })), st.fund, { placeholder: 'كل الصناديق' });
  fund.addEventListener('change', () => ((st.fund = fund.value), ctx.refresh()));
  body.append(h('div', { class: 'label muted small', text: `أنواع الحركات (${st.kinds.length ? F.num(st.kinds.length) + ' مختارة' : 'الكل'})` }), kindBox, field('الصندوق', fund));
  const rep = movementsReport(S, { lastN: st.mode === 'last' ? st.n : 0, from: st.mode === 'period' ? st.from || null : null, to: st.mode === 'period' ? st.to || null : null, kinds: st.kinds, fundId: st.fund || null });
  const label = st.mode === 'last' ? `آخر ${F.num(rep.count)} حركة` : st.mode === 'period' ? `من ${F.date(st.from)} إلى ${F.date(st.to)}` : 'كل الحركات';
  const kindsLabel = st.kinds.length ? st.kinds.map((k) => MOVEMENT_KINDS[k]).join('، ') : 'كل الأنواع';
  body.append(h('div', { class: 'stats' }, stat('عدد الحركات', F.num(rep.count), { pk: 'reports|mv-count' }), stat('الصافي', F.money(rep.net, { sign: true }), { valueClass: rep.net >= 0 ? 'pos' : 'neg', pk: 'reports|mv-net' }), stat('وارد', F.money(rep.inflow), { valueClass: 'pos', pk: 'reports|mv-in' }), stat('منصرف', F.money(rep.outflow), { valueClass: 'neg', pk: 'reports|mv-out' })));
  if (!rep.count) return body.append(empty('لا حركات مطابقة'));
  const tbl = () => table(rep.cols.map((c) => ({ label: c.label, num: c.type !== 'text' })), rep.rows.map((r) => r.map((v, i) => (i === 0 ? F.date(v) : displayCell(v, rep.cols[i].type)))), { totalRow: ['الإجمالي', '', '', '', '', F.money(rep.inflow), F.money(rep.outflow), '', ''], pg: 'reports' });
  const text = () => [`*تقرير الحركات — ${S.settings.orgName || 'دفتر الخير'}*`, `${label} · ${kindsLabel}`, '', ...rep.rows.map((r) => `${F.date(r[0])} — ${r[3]}${r[4] ? ` (${r[4]})` : ''}: ${r[5] ? '+' + F.money(r[5]) : r[6] ? '−' + F.money(r[6]) : '—'}`), '', `وارد ${F.egp(rep.inflow)} · منصرف ${F.egp(rep.outflow)} · الصافي ${F.egp(rep.net)}`].join('\n');
  body.append(
    exportBar(
      h('button', { class: 'btn', text: 'مشاركة نص', onclick: () => share(text()) }),
      h('button', { class: 'btn', text: 'طباعة / PDF', onclick: () => openPrint({ title: 'تقرير الحركات', subtitle: `${label} — ${kindsLabel}`, build: () => h('div', {}, tbl(), h('div', { class: 'card' }, kv('وارد', F.egp(rep.inflow)), kv('منصرف', F.egp(rep.outflow)), kv('الصافي', F.egp(rep.net)))) }) }),
      h('button', { class: 'btn', text: 'Excel', onclick: () => saveXlsx(`daftar-movements-${ctx.today()}.xlsx`, [{ name: 'الحركات', rows: [rep.cols.map((c) => c.label), ...rep.rows.map((r) => r.map((v, i) => exportCell(v, rep.cols[i].type))), ['الإجمالي', '', '', '', '', rep.inflow / 10, rep.outflow / 10, '', '']] }, { name: 'ملخص بالنوع', rows: [['النوع', 'العدد', 'وارد', 'منصرف'], ...rep.byKind.map((k) => [k.label, k.count, k.inflow / 10, k.outflow / 10])] }]) }),
    ),
    sectionTitle('ملخص بالنوع'),
    table([{ label: 'النوع' }, { label: 'العدد', num: true }, { label: 'وارد', num: true }, { label: 'منصرف', num: true }], rep.byKind.map((k) => [k.label, F.num(k.count), F.money(k.inflow), F.money(k.outflow)]), { pg: 'reports' }),
    sectionTitle('الحركات'),
    tbl(),
  );
}

// ---------- لوحة القرار ----------
function insightsSection(body, S) {
  const ins = insights(S, ctx.today());
  const pk = (k) => `reports|ins-${k}`;
  body.append(
    h(
      'div',
      { class: 'stats' },
      stat('إجمالي السيولة', F.money(ins.cash), { cls: 'primary', hint: `غير مقيّد ${F.money(ins.unrestricted)}`, pk: pk('cash') }),
      ...ins.pools.map((p) => stat(p.rollup.name, F.money(p.total), { hint: `الشهر القادم يحتاج ${F.money(ins.nextCash)}`, valueClass: p.rollup.id === 'families' && p.total < ins.nextCash ? 'neg' : '', pk: pk('pool-' + p.rollup.id) })),
      stat('تكفي السيولة', ins.runway === null ? '—' : `${F.num(ins.runway)} شهر`, { hint: `متوسط الصرف ${F.money(ins.avgOut)} شهرياً`, pk: pk('runway') }),
      stat('تحصيل اشتراكات السنة', ins.collectionPct === null ? '—' : `${F.num(ins.collectionPct)}%`, { hint: `متأخرات ${F.money(ins.arrearsTotal)}`, onclick: () => ctx.nav('#/arrears'), pk: pk('collect') }),
      stat('استحقاقات أسر متبقية', F.money(ins.famDuesTotal), { hint: `${F.num(ins.famDuesCount)} أسرة`, onclick: () => ctx.nav('#/batch'), pk: pk('dues') }),
      stat('الأصول والمخزون', F.money(ins.assetsValue + ins.inventory), { hint: `أصول ${F.money(ins.assetsValue)} · مخزون ${F.money(ins.inventory)}`, onclick: () => ctx.nav('#/assets'), pk: pk('assets') }),
    ),
    sectionTitle('تنبيهات وقرارات مقترحة'),
    h('div', { class: 'list' }, ins.decisions.map((d) => h(d.path ? 'button' : 'div', { class: `decision ${d.level}`, onclick: d.path ? () => ctx.nav(d.path) : null }, h('span', { class: 'dot' }), h('span', { text: d.text })))),
  );
  if (ins.inkind.length) {
    body.append(sectionTitle('الالتزام العيني: هذا الشهر والقادم'), table([{ label: 'الصنف' }, { label: 'المتبقي للأسر', num: true }, { label: 'المخزون', num: true }, { label: 'العجز', num: true }], ins.inkind.map((t) => [`${t.name} (${t.unit})`, F.qty(t.remaining), F.qty(t.stock), t.short ? F.qty(t.short) : '—']), { pg: 'reports' }));
  }
  if (ins.history.length) {
    const max = Math.max(1, ...ins.history.flatMap((r) => [r.inflow, r.outflow]));
    const bar = (label, v, cls) => {
      const fill = h('div', { class: 'fill' });
      fill.style.width = `${Math.max(2, Math.round((100 * v) / max))}%`;
      if (cls) fill.style.background = `var(--${cls})`;
      return h('div', { class: 'bar' }, h('span', { text: label }), h('div', { class: 'track' }, fill), h('span', { class: 'num', text: groupHidden('reports') ? MASK : F.money(v) }));
    };
    body.append(sectionTitle('آخر 3 شهور: وارد ومنصرف'), h('div', { class: 'bars card' }, ins.history.flatMap((r) => [bar(`${F.month(r.month, { short: true })} وارد`, r.inflow, 'ok'), bar(`${F.month(r.month, { short: true })} منصرف`, r.outflow, 'bad')])));
  }
}

export function reportsScreen() {
  const S = ctx.state;
  const st = ui('reports', { section: 'insights', tab: 'month', period: String(Math.max(ctx.fiscalYear(), new Date().getFullYear())), audience: 'board' });
  const first = firstFiscalYear(S);
  const years = [];
  for (let y = first; y <= Math.max(new Date().getFullYear(), ctx.fiscalYear()); y++) years.push(String(y));
  if (st.period !== 'all' && !years.includes(st.period)) st.period = years[years.length - 1];
  const period = periodOf(S, st.period);
  const body = h('div', {});
  body.append(chips(SECTIONS, st.section, (v) => ((st.section = v), ctx.refresh())));
  const periodChips = () =>
    chips([...years.map((y) => ({ value: y, label: F.num(y) })), { value: 'all', label: 'كل السنوات' }], st.period, (v) => {
      st.period = v;
      ctx.refresh();
    });

  if (st.section === 'insights') insightsSection(body, S);
  else if (st.section === 'movements') movementsSection(body, S);
  else if (st.section === 'briefs') {
    body.append(
      periodChips(),
      list(Object.entries(BRIEF_AUDIENCES).map(([value, label]) => row({ title: label, subtitle: { board: 'الخلاصة، التنبيهات، الالتزامات، الصناديق، الأثر', subscribers: 'اشتراكاتكم وأين صُرفت — بلا أسماء', donor: 'الأثر وأمانة الصرف والحاجة القائمة — بلا أسماء', evaluator: 'المركز المالي، الصناديق والأصول، الضبط والتوثيق' }[value], badge: st.audience === value ? h('span', { class: 'badge ok', text: 'معروض' }) : null, onclick: () => ((st.audience = value), ctx.refresh()) }))),
    );
    const brief = buildBrief(S, st.audience, { from: period.from, to: period.to, today: ctx.today(), periodLabel: period.label });
    body.append(
      exportBar(
        h('button', { class: 'btn primary', text: 'مشاركة نص', onclick: () => share(briefToText(brief)) }),
        h('button', { class: 'btn', text: 'طباعة / PDF', onclick: () => openPrint({ title: brief.title, subtitle: brief.subtitle, build: () => renderBrief(brief) }) }),
        h('button', { class: 'btn', text: 'Excel', onclick: () => saveXlsx(`daftar-${st.audience}-${st.period}-${ctx.today()}.xlsx`, briefSheets(brief)) }),
      ),
      renderBrief(brief),
    );
  } else {
    const reports = buildReports(S, period);
    const r = reports[st.tab];
    body.append(
      periodChips(),
      chips(
        TABS.map(([value, label]) => ({ value, label })),
        st.tab,
        (v) => {
          st.tab = v;
          ctx.refresh();
        },
      ),
    );
    const tbl = () =>
      table(
        r.cols.map((c) => ({ label: c.label, num: c.type !== 'text' })),
        r.rows.map((x) => x.map((v, i) => displayCell(v, r.cols[i].type))),
        { totalRow: r.total ? r.total.map((v, i) => (typeof v === 'string' ? v : displayCell(v, r.cols[i].type))) : null, pg: 'reports' },
      );
    if (!r.rows.length) body.append(empty('لا بيانات في هذه الفترة'));
    else body.append(tbl());
    const withNeed = checkbox('أضف ورقة «تقييم الاحتياج» (بيانات حساسة)', false);
    body.append(
      exportBar(
        h('button', { class: 'btn', text: 'طباعة / PDF', disabled: !r.rows.length, onclick: () => openPrint({ title: `${r.title} — ${S.settings.orgName || 'دفتر الخير'}`, subtitle: period.label, build: tbl }) }),
        h('button', { class: 'btn', text: 'تصدير كل التقارير إلى Excel', onclick: () => saveXlsx(`daftar-reports-${st.period}-${ctx.today()}.xlsx`, toXlsxSheets(reports, buildExtraSheets(S, period, { includeNeed: withNeed.input.checked }))) }),
      ),
      h('div', { class: 'no-print' }, withNeed, h('div', { class: 'muted small', text: 'تفاصيل التقييم لا تدخل أي تقرير أو تصدير إلا باختيارك الصريح هنا.' })),
    );
  }
  return { title: 'التقارير', subtitle: st.section === 'tables' || st.section === 'briefs' ? period.label : SECTIONS.find((x) => x.value === st.section).label, body };
}

// صفحة الطباعة: التقرير وحده. الزران لا يُطبعان.
export function printScreen() {
  const p = ui('print', {}).payload;
  if (!p) return { title: 'طباعة', body: empty('لا تقرير للطباعة — اختره من شاشة التقارير') };
  const content = p.build();
  const hasHead = !!content.querySelector('.brief-head');
  const body = h('div', {});
  body.append(
    exportBar(h('button', { class: 'btn primary', text: 'طباعة / حفظ PDF', onclick: () => window.print() }), h('button', { class: 'btn', text: 'رجوع', onclick: () => ctx.back() })),
    hasHead ? null : h('div', { class: 'brief' }, h('div', { class: 'brief-head' }, h('div', { class: 't', text: p.title || '' }), h('div', { class: 'muted', text: [p.subtitle, `بتاريخ ${F.date(ctx.today())}`].filter(Boolean).join(' — ') }))),
    content,
  );
  return { title: p.title || 'طباعة', subtitle: p.subtitle || '', body };
}
