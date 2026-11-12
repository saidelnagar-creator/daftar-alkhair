// التقارير من أكثر من زاوية + تصدير Excel.
import { h } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { chips, table, empty, toast, saveFile } from '../components.js';
import { ui } from '../widgets.js';
import { firstFiscalYear } from '../../core/engine.js';
import { buildXlsx } from '../../core/xlsx.js';
import { buildReports, buildExtraSheets, periodOf, displayCell, toXlsxSheets } from '../report-data.js';

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

export function reportsScreen() {
  const S = ctx.state;
  const st = ui('reports', { tab: 'month', period: String(Math.max(ctx.fiscalYear(), new Date().getFullYear())) });
  const first = firstFiscalYear(S);
  const years = [];
  for (let y = first; y <= Math.max(new Date().getFullYear(), ctx.fiscalYear()); y++) years.push(String(y));
  if (st.period !== 'all' && !years.includes(st.period)) st.period = years[years.length - 1];
  const period = periodOf(S, st.period);
  const reports = buildReports(S, period);
  const r = reports[st.tab];
  const body = h('div', {});
  body.append(
    chips([...years.map((y) => ({ value: y, label: F.num(y) })), { value: 'all', label: 'كل السنوات' }], st.period, (v) => {
      st.period = v;
      ctx.refresh();
    }),
    chips(
      TABS.map(([value, label]) => ({ value, label })),
      st.tab,
      (v) => {
        st.tab = v;
        ctx.refresh();
      },
    ),
  );
  if (!r.rows.length) body.append(empty('لا بيانات في هذه الفترة'));
  else
    body.append(
      table(
        r.cols.map((c) => ({ label: c.label, num: c.type !== 'text' })),
        r.rows.map((row) => row.map((v, i) => displayCell(v, r.cols[i].type))),
        { totalRow: r.total ? r.total.map((v, i) => (typeof v === 'string' ? v : displayCell(v, r.cols[i].type))) : null },
      ),
    );
  body.append(
    h('button', {
      class: 'btn block',
      text: 'تصدير كل التقارير إلى Excel',
      onclick: async () => {
        try {
          const bytes = buildXlsx(toXlsxSheets(reports, buildExtraSheets(S, period)));
          const res = await saveFile(`daftar-reports-${st.period}-${ctx.today()}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          if (res !== 'cancelled') toast('تم تجهيز ملف Excel');
        } catch (e) {
          toast('تعذّر التصدير: ' + e.message, 'bad');
        }
      },
    }),
  );
  return { title: 'التقارير', subtitle: period.label, body };
}
