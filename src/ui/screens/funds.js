// الصناديق: الأرصدة + كشف حساب كل صندوق/حملة/أمانة.
import { h } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { row, list, empty, sectionTitle, stat, kv, chips, badge } from '../components.js';
import { ui, movementRow } from '../widgets.js';
import { acctFund, acctLabel, closedThrough, firstFiscalYear } from '../../core/engine.js';
import { computeLedger, fundCash, fundAssets, subAccounts, totalCash, acctBalance } from '../../core/ledger.js';
import { acctStatement } from '../../core/reports.js';
import { transferForm, receiptForm, expenseForm, adjustmentForm, cashCountForm } from '../forms-movements.js';
import { listItemForm } from '../forms-entities.js';
import { FUND_TYPES } from '../../config/defaults.js';

export function fundsScreen() {
  const S = ctx.state;
  const led = computeLedger(S);
  const today = ctx.today();
  const body = h('div', {});
  let assetsValue = 0;
  const rows = [];
  for (const f of S.lists.funds.values()) {
    const cash = fundCash(led, f.id);
    const assets = fundAssets(S, led, f.id, today);
    assetsValue += assets.value;
    if (f.archived && cash === 0 && assets.cost === 0) continue;
    const subs = subAccounts(led, f.id).filter((a) => a.balance !== 0);
    rows.push(
      row({
        title: f.name,
        subtitle: [FUND_TYPES[f.type] || '', assets.cost ? `أصول ${F.money(assets.value)}` : '', subs.length ? `${F.num(subs.length)} حساب فرعي` : ''].filter(Boolean).join(' · '),
        value: F.money(cash),
        valueClass: cash < 0 ? 'neg' : '',
        onclick: () => ctx.nav(`#/fund/${encodeURIComponent(f.id)}`),
      }),
    );
  }
  body.append(h('div', { class: 'stats' }, stat('إجمالي السيولة', F.money(totalCash(led)), { cls: 'primary' }), stat('قيمة الأصول الحالية', F.money(assetsValue), { onclick: () => ctx.nav('#/assets') })));
  body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', text: 'تحويل بين صندوقين', onclick: () => transferForm() })));
  body.append(sectionTitle('الصناديق', h('button', { text: '+ صندوق', onclick: () => listItemForm('funds') })), list(rows));
  const camps = [...S.lists.campaigns.values()].filter((c) => !c.archived || acctBalance(led, `campaigns#campaign:${c.id}`) !== 0);
  body.append(sectionTitle('الحملات والمشروعات', h('button', { text: '+ حملة', onclick: () => listItemForm('campaigns') })));
  body.append(
    camps.length
      ? list(camps.map((c) => row({ title: c.name, subtitle: c.kind || '', value: F.money(acctBalance(led, `campaigns#campaign:${c.id}`)), badge: c.archived ? badge('مؤرشفة') : null, onclick: () => ctx.nav(`#/fund/${encodeURIComponent(`campaigns#campaign:${c.id}`)}`) })))
      : empty('لا توجد حملات — أضف حملة (وجبات رمضان، أضاحي، مدارس…)'),
  );
  const em = [...led.cash].filter(([a, v]) => a.startsWith('earmarked#') && v !== 0);
  if (em.length) {
    body.append(sectionTitle('أمانات مخصصة (لا تدخل الصندوق العام)'));
    body.append(list(em.map(([a, v]) => row({ title: acctLabel(S, a), value: F.money(v), onclick: () => ctx.nav(`#/fund/${encodeURIComponent(a)}`) }))));
  }
  return { title: 'الصناديق', body, root: true };
}

export function fundScreen({ id }) {
  const S = ctx.state;
  const acct = decodeURIComponent(id);
  const isSub = acct.includes('#');
  const fund = S.lists.funds.get(acctFund(acct));
  if (!fund) return { title: 'صندوق', body: empty('الصندوق غير موجود') };
  const fy = ctx.fiscalYear();
  const st = ui(`fund:${acct}`, { range: 'year' });
  const led = computeLedger(S);
  const body = h('div', {});
  const from = st.range === 'year' ? (closedThrough(S) !== null ? `${fy}-01-01` : null) : null;
  const stmt = acctStatement(S, isSub ? { acct, from } : { fundId: fund.id, from });
  const balance = isSub ? acctBalance(led, acct) : fundCash(led, fund.id);
  const assets = isSub ? { cost: 0, value: 0 } : fundAssets(S, led, fund.id, ctx.today());
  body.append(
    h('div', { class: 'stats' }, stat('الرصيد النقدي', F.money(balance), { cls: 'primary wide', hint: assets.cost ? `+ أصول بقيمة ${F.money(assets.value)} (المدفوع ${F.money(assets.cost)})` : '' })),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn', text: 'تحويل', onclick: () => transferForm({ from: acct }) }),
      h('button', { class: 'btn', text: 'تبرع للصندوق', onclick: () => receiptForm({ preset: isSub ? { target: targetOf(acct) } : fund.id === 'general' ? {} : { target: { type: 'fund', id: fund.id } } }) }),
      h('button', { class: 'btn', text: 'مصروف', onclick: () => expenseForm() }),
    ),
  );
  if (!isSub) {
    const subs = subAccounts(led, fund.id).filter((a) => a.balance !== 0);
    if (subs.length) {
      body.append(sectionTitle('حسابات فرعية'));
      body.append(list(subs.map((a) => row({ title: acctLabel(S, a.acct), value: F.money(a.balance), onclick: () => ctx.nav(`#/fund/${encodeURIComponent(a.acct)}`) }))));
    }
    const own = [...S.lists.assets.values()].filter((a) => a.fundId === fund.id);
    if (own.length) body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', text: `أصول الصندوق (${F.num(own.length)})`, onclick: () => ctx.nav('#/assets') })));
  }
  if (closedThrough(S) !== null) {
    body.append(
      chips(
        [
          { value: 'year', label: `سنة ${F.num(fy)}` },
          { value: 'all', label: 'كل السنوات' },
        ],
        st.range,
        (v) => {
          st.range = v;
          ctx.refresh();
        },
      ),
    );
  }
  body.append(sectionTitle('كشف الحساب'));
  const rows = [...stmt.rows].reverse().slice(0, 300).map((r) => movementRow(r.mv, { showBalance: r.balance }));
  if (from) rows.push(row({ title: 'رصيد افتتاحي', subtitle: `أول سنة ${F.num(fy)} (ناتج إقفال ${F.num(fy - 1)})`, value: F.money(stmt.opening) }));
  body.append(rows.length ? list(rows) : empty('لا توجد حركات'));
  body.append(h('div', { class: 'card' }, kv('النوع', isSub ? 'حساب فرعي' : FUND_TYPES[fund.type] || ''), kv('أول سنة في الدفاتر', F.num(firstFiscalYear(S)))));
  if (!isSub) {
    body.append(
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn small', text: 'تعديل الاسم', onclick: () => listItemForm('funds', fund) }),
        h('button', { class: 'btn small', text: 'جرد ومطابقة', onclick: () => cashCountForm(acct) }),
        h('button', { class: 'btn small', text: 'تسوية', onclick: () => adjustmentForm({ target: 'cash' }) }),
        h('button', { class: 'btn small', text: 'رصيد افتتاحي', onclick: () => adjustmentForm({ opening: true, target: 'cash' }) }),
      ),
    );
  }
  return { title: isSub ? acctLabel(S, acct) : fund.name, body };
}

function targetOf(acct) {
  const [type, id] = acct.split('#')[1].split(':');
  return { type, id };
}
