// الصناديق: الأرصدة + كشف حساب كل صندوق/حملة/أمانة.
import { h } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { row, list, empty, sectionTitle, stat, kv, chips, badge, openSheet, checkbox, textInput, field, errorBox, toast } from '../components.js';
import { ui, movementRow } from '../widgets.js';
import { acctFund, acctLabel, closedThrough, firstFiscalYear } from '../../core/engine.js';
import { computeLedger, fundCash, fundAssets, fundHoldings, rollups, rollupsOfFund, subAccounts, totalCash, acctBalance } from '../../core/ledger.js';
import { newId } from '../../core/util.js';
import { acctStatement } from '../../core/reports.js';
import { transferForm, receiptForm, expenseForm, adjustmentForm, cashCountForm, amanaDeliverForm, amanaRedirectForm, assetTradeForm, assetInForm, priceForm } from '../forms-movements.js';
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
        subtitle: [FUND_TYPES[f.type] || '', assets.cost ? `أصول ${F.money(assets.value)}` : '', subs.length ? `${F.num(subs.length)} حساب فرعي` : '', ...rollupsOfFund(S, f.id).map((r) => `ضمن «${r.name}»`)].filter(Boolean).join(' · '),
        value: F.money(cash),
        valueClass: cash < 0 ? 'neg' : '',
        onclick: () => ctx.nav(`#/fund/${encodeURIComponent(f.id)}`),
      }),
    );
  }
  body.append(h('div', { class: 'stats' }, stat('إجمالي السيولة', F.money(totalCash(led)), { cls: 'primary' }), stat('قيمة الأصول الحالية', F.money(assetsValue), { onclick: () => ctx.nav('#/assets') })));
  // مجاميع الأرصدة (مثل «رصيد الأسر» = العام + الأمانات): عرض مجمَّع لا يغيّر حساب أي صندوق
  const pools = rollups(S, led);
  if (pools.length) {
    body.append(
      h(
        'div',
        { class: 'stats' },
        pools.map((p) => stat(p.rollup.name, F.money(p.total), { cls: 'wide', hint: p.parts.length ? p.parts.map((x) => `${x.fund.name} ${F.money(x.cash)}`).join(' + ') : 'لم تُحدَّد صناديق', onclick: () => rollupsForm() })),
      ),
    );
  }
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
    body.append(sectionTitle('الأمانات (توصيل لجهة محددة) — لكل أمانة حسابها'));
    body.append(list(em.map(([a, v]) => row({ title: acctLabel(S, a), subtitle: a.startsWith('earmarked#family:') ? 'اضغط للتسليم أو تغيير التخصيص' : '', value: F.money(v), onclick: () => amanaSheet(a) }))));
  }
  body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'تعديل المجاميع (ما يدخل «رصيد الأسر»)', onclick: () => rollupsForm() })));
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
  if (isSub && acct.startsWith('earmarked#')) {
    body.append(
      h(
        'div',
        { class: 'btn-row' },
        acct.startsWith('earmarked#family:') ? h('button', { class: 'btn primary', text: 'تسليم للأسرة', onclick: () => amanaDeliverForm(acct) }) : null,
        h('button', { class: 'btn', text: 'تغيير التخصيص (عام / هدف آخر)', onclick: () => amanaRedirectForm(acct) }),
      ),
    );
  }
  if (!isSub) {
    const inPools = rollupsOfFund(S, fund.id);
    if (inPools.length) body.append(h('div', { class: 'muted small', style: { margin: '0 4px 8px' }, text: `رصيد هذا الصندوق يُسمَّع في: ${inPools.map((r) => `«${r.name}»`).join('، ')} — أي وارد له أو صرف منه يظهر هناك أيضاً.` }));
    // كل ما يتبع الصندوق: أصوله، كل أصل بتقييمه
    const hold = fundHoldings(S, led, fund.id, ctx.today());
    if (hold.assets.length || !['general', 'reserve', 'store', 'campaigns', 'earmarked'].includes(fund.id)) {
      body.append(sectionTitle('أصول الصندوق', h('button', { text: '+ أصل', onclick: () => listItemForm('assets', null, { fundId: fund.id, kind: fund.type === 'gold' ? 'gold' : 'investment' }) })));
      if (hold.assets.length) {
        body.append(
          list(
            hold.assets.map(({ asset, pos }) =>
              row({
                title: asset.name,
                subtitle: `${F.aqty(pos.qty)} ${asset.unit} · المدفوع ${F.money(pos.cost)}${pos.price === null ? ' · بلا سعر سوقي' : ` · سعر ${F.date(pos.priceDate)}`}`,
                value: F.money(pos.value),
                badge: pos.price !== null ? badge(F.money(pos.unrealized, { sign: true }), pos.unrealized >= 0 ? 'ok' : 'bad') : badge('حدّث السعر', 'warn'),
                onclick: () => ctx.nav(`#/asset/${asset.id}`),
              }),
            ),
          ),
          h('div', { class: 'card' }, kv('النقد', F.egp(hold.cash)), kv('الأصول بالقيمة الحالية', F.egp(hold.assetsValue)), kv('إجمالي الصندوق', F.egp(hold.total))),
          h(
            'div',
            { class: 'btn-row' },
            h('button', { class: 'btn small', text: 'شراء أصل', onclick: () => assetTradeForm({ kind: 'asset_buy', assetId: hold.assets[0].asset.id }) }),
            h('button', { class: 'btn small', text: 'أصل وارد (تبرع عيني)', onclick: () => assetInForm({ assetId: hold.assets[0].asset.id }) }),
            h('button', { class: 'btn small', text: 'بيع', onclick: () => assetTradeForm({ kind: 'asset_sell', assetId: hold.assets[0].asset.id }) }),
            hold.assets.length === 1 ? h('button', { class: 'btn small', text: 'تحديث السعر', onclick: () => priceForm(hold.assets[0].asset.id) }) : null,
          ),
        );
      } else body.append(empty('لا أصول في هذا الصندوق — أضف أصلاً ثم سجّل شراءه أو استلامه.'));
    }
    const subs = subAccounts(led, fund.id).filter((a) => a.balance !== 0);
    if (subs.length) {
      body.append(sectionTitle('حسابات فرعية'));
      body.append(list(subs.map((a) => row({ title: acctLabel(S, a.acct), value: F.money(a.balance), onclick: () => ctx.nav(`#/fund/${encodeURIComponent(a.acct)}`) }))));
    }
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

// نافذة أمانة: تسليم مباشر، تغيير تخصيص، أو كشف الحساب.
function amanaSheet(acct) {
  const S = ctx.state;
  const bal = acctBalance(computeLedger(S), acct);
  const isFamily = acct.startsWith('earmarked#family:');
  openSheet(acctLabel(S, acct), (body, close) => {
    const go = (fn) => () => {
      close();
      fn();
    };
    body.append(
      h('div', { class: 'card' }, kv('رصيد الأمانة', F.egp(bal), '', { pg: 'funds' })),
      isFamily ? h('button', { class: 'btn primary block', text: 'تسليم للأسرة (كلها أو جزء منها)', onclick: go(() => amanaDeliverForm(acct)) }) : null,
      h('button', { class: 'btn block', style: { marginTop: '8px' }, text: 'تحويلها إلى عام أو لهدف آخر', onclick: go(() => amanaRedirectForm(acct)) }),
      h('button', { class: 'btn block', style: { marginTop: '8px' }, text: 'كشف حساب الأمانة', onclick: go(() => ctx.nav(`#/fund/${encodeURIComponent(acct)}`)) }),
      isFamily ? h('button', { class: 'btn block', style: { marginTop: '8px' }, text: 'ملف الأسرة', onclick: go(() => ctx.nav(`#/family/${acct.split(':')[1]}`)) }) : null,
    );
  });
}

// تعديل المجاميع: اختيار الصناديق التي تُسمَّع في كل مجموع، وإضافة مجموع جديد أو حذفه.
export function rollupsForm() {
  const S = ctx.state;
  openSheet('مجاميع الأرصدة', (body, close) => {
    const err = errorBox();
    const funds = [...S.lists.funds.values()].filter((f) => !f.archived);
    let pools = (S.settings.rollups || []).map((r) => ({ ...r, funds: [...r.funds] }));
    const box = h('div', {});
    const draw = () => {
      box.replaceChildren();
      pools.forEach((r, i) => {
        const name = textInput(r.name, 'اسم المجموع');
        name.addEventListener('input', () => (r.name = name.value));
        const checks = funds.map((f) => {
          const c = checkbox(f.name, r.funds.includes(f.id));
          c.input.addEventListener('change', () => {
            r.funds = c.input.checked ? [...new Set([...r.funds, f.id])] : r.funds.filter((x) => x !== f.id);
          });
          return c;
        });
        box.append(h('div', { class: 'card' }, field('اسم المجموع', name), h('div', { class: 'label muted small', text: 'الصناديق التي تدخل فيه' }), checks, pools.length > 1 || r.id !== 'families' ? h('button', { class: 'btn small danger', type: 'button', text: 'حذف هذا المجموع', onclick: () => (pools.splice(i, 1), draw()) }) : null));
      });
    };
    draw();
    const save = async () => {
      if (pools.some((r) => !r.name.trim())) return err.show('اكتب اسم كل مجموع');
      try {
        await ctx.store.dispatch('settings.set', { key: 'rollups', value: pools.map((r) => ({ id: r.id, name: r.name.trim(), funds: r.funds })) });
        toast('تم حفظ المجاميع');
        close(true);
      } catch (e) {
        err.show(e.message);
      }
    };
    body.append(
      err,
      h('p', { class: 'muted', text: 'المجموع رقم للعرض يجمع نقد صناديق تختارها. لا ينقل مالاً ولا يغيّر رصيد أي صندوق: الوارد لأي صندوق داخل المجموع يزيده، والصرف منه ينقصه.' }),
      box,
      h('button', { class: 'btn small', type: 'button', text: '+ مجموع جديد', onclick: () => (pools.push({ id: newId('r-'), name: '', funds: [] }), draw()) }),
      h('button', { class: 'btn primary block', style: { marginTop: '12px' }, type: 'button', text: 'حفظ', onclick: save }),
    );
  });
}
