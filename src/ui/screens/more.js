// المزيد: القائمة، المتأخرات، المخزن، الأصول، كل الحركات، تفاصيل حركة، القوائم، سجل التدقيق.
import { h } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { row, list, empty, sectionTitle, stat, kv, chips, badge, selectInput, toast } from '../components.js';
import { ui, movementList, collator } from '../widgets.js';
import { acctLabel, isLockedDate, targetAcct, voucherText } from '../../core/engine.js';
import { computeLedger, assetPosition, itemPosition, cashPostings } from '../../core/ledger.js';
import { allArrears } from '../../core/subscriptions.js';
import { allFamilyDues } from '../../core/families.js';
import { describeMovement, searchMovements, payerName } from '../../core/reports.js';
import { ASSET_KINDS, MOVEMENT_KINDS } from '../../config/defaults.js';
import { receiptForm, distributionForm, purchaseForm, inkindReceiptForm, assetTradeForm, assetInForm, assetIncomeForm, priceForm, adjustmentForm, voidMovementFlow, editMovementFlow } from '../forms-movements.js';
import { listItemForm, dueDecisionForm, LIST_INFO } from '../forms-entities.js';

export function moreScreen() {
  const link = (title, subtitle, path) => row({ title, subtitle, onclick: () => ctx.nav(path) });
  const body = h(
    'div',
    {},
    list(link('المتأخرات', 'من عليه شهور ناقصة، و«لن يُسدد»', '#/arrears'), link('المخزن العيني', 'وارد وصادر وفائض', '#/inventory'), link('الذهب والاستثمار', 'المدفوع / الحالي / الربح', '#/assets'), link('التقارير', 'بالشهر، بالشخص، بالفئة، بالحملة، بالصندوق', '#/reports'), link('كل الحركات', 'بحث وفلترة وتعديل وإلغاء', '#/ledger')),
    list(link('النسخ الاحتياطي', 'تصدير / استيراد / نسخ تلقائية', '#/backup'), link('الإقفال السنوي والأرشيف', 'معاينة، إقفال، تراجع', '#/closing'), link('القوائم', 'صناديق، حملات، أصناف، فئات، أغراض، أنواع مصروف', '#/lists'), link('الإعدادات', 'الاسم، القفل، النقاط، التذكير', '#/settings')),
    list(link('سجل التدقيق', 'كل ما أُدخل وعُدّل وأُلغي', '#/audit'), link('دليل الاستخدام', 'صفحة واحدة', '#/help')),
  );
  return { title: 'المزيد', body, root: true };
}

// ---------- المتأخرات ----------
export function arrearsScreen() {
  const S = ctx.state;
  const st = ui('arrears', { tab: 'subscribers', open: null });
  const now = ctx.nowMonth();
  const body = h('div', {});
  const arrears = allArrears(S, now);
  const famDues = allFamilyDues(S, now);
  body.append(
    h('div', { class: 'stats' }, stat('متأخرات المشتركين', F.money(arrears.reduce((a, x) => a + x.total, 0)), { hint: `${F.num(arrears.length)} مشترك`, valueClass: 'neg' }), stat('استحقاقات أسر متبقية', F.money(famDues.reduce((a, x) => a + x.total, 0)), { hint: `${F.num(famDues.length)} أسرة` })),
    chips(
      [
        { value: 'subscribers', label: 'المشتركون' },
        { value: 'families', label: 'الأسر' },
      ],
      st.tab,
      (v) => {
        st.tab = v;
        st.open = null;
        ctx.refresh();
      },
    ),
    h('div', { class: 'muted small', style: { margin: '0 4px 10px' }, text: `حتى ${F.month(now)} — اضغط على الاسم لعرض الشهور، وعلى الشهر لتسجيل «لن يُسدد».` }),
  );
  const isSub = st.tab === 'subscribers';
  const data = isSub ? arrears.map((a) => ({ id: a.subscriber.id, name: a.subscriber.name, months: a.months, total: a.total })) : famDues.map((a) => ({ id: a.family.id, name: a.family.name, months: a.months, total: a.total }));
  if (!data.length) body.append(empty(isSub ? 'لا متأخرات — ما شاء الله' : 'لا استحقاقات متبقية'));
  else {
    const rows = [];
    for (const a of data) {
      rows.push(
        row({
          title: a.name,
          subtitle: `${F.num(a.months.length)} شهر: ${a.months.slice(0, 4).map((m) => F.monthShort(m.month)).join('، ')}${a.months.length > 4 ? '…' : ''}`,
          value: F.money(a.total),
          valueClass: 'neg',
          onclick: () => {
            st.open = st.open === a.id ? null : a.id;
            ctx.refresh();
          },
        }),
      );
      if (st.open === a.id) {
        rows.push(
          h(
            'div',
            { class: 'row', style: { flexDirection: 'column', alignItems: 'stretch' } },
            h(
              'div',
              { class: 'btn-row', style: { marginBottom: '8px' } },
              h('button', { class: 'btn primary small', text: isSub ? 'دفعة' : 'صرف', onclick: () => (isSub ? receiptForm({ subscriberId: a.id }) : distributionForm({ familyId: a.id })) }),
              h('button', { class: 'btn small', text: 'فتح الكشف', onclick: () => ctx.nav(isSub ? `#/subscriber/${a.id}` : `#/family/${a.id}`) }),
            ),
            list(a.months.map((m) => row({ title: F.month(m.month), subtitle: m.status === 'partial' ? 'مسدد جزئياً' : '', value: F.money(m.remaining), badge: badge(isSub ? 'لن يُسدد؟' : 'لن يُصرف؟'), onclick: () => dueDecisionForm({ entity: isSub ? 'subscriber' : 'family', entityId: a.id, month: m.month, current: m.status }) }))),
          ),
        );
      }
    }
    body.append(list(rows));
  }
  return { title: 'المتأخرات', body };
}

// ---------- المخزن ----------
export function inventoryScreen() {
  const S = ctx.state;
  const led = computeLedger(S);
  const body = h('div', {});
  let total = 0;
  const rows = [];
  for (const it of [...S.lists.items.values()].sort((a, b) => collator.compare(a.name, b.name))) {
    const p = itemPosition(led, it.id);
    total += p.cost;
    if (it.archived && p.qty === 0) continue;
    rows.push(row({ title: it.name, subtitle: p.qty ? `متوسط تكلفة ال${it.unit} ${F.money(Math.round((p.cost * 100) / p.qty))}` : 'لا رصيد', value: `${F.qty(p.qty)} ${it.unit}`, badge: p.qty > 0 ? badge(`قيمة ${F.money(p.cost)}`, 'info') : null, onclick: () => ctx.nav(`#/item/${it.id}`) }));
  }
  body.append(
    h('div', { class: 'stats' }, stat('قيمة المخزون (بالتكلفة)', F.money(total), { cls: 'wide' })),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', text: 'وارد: شراء', onclick: () => purchaseForm() }),
      h('button', { class: 'btn primary', text: 'وارد: تبرع عيني', onclick: () => inkindReceiptForm() }),
      h('button', { class: 'btn', text: 'صادر: توزيع على أسرة', onclick: () => distributionForm() }),
    ),
    sectionTitle('الأصناف والفائض', h('button', { text: '+ صنف', onclick: () => listItemForm('items') })),
    rows.length ? list(rows) : empty('لا توجد أصناف'),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'تسوية جرد', onclick: () => adjustmentForm({ target: 'item' }) }), h('button', { class: 'btn small', text: 'رصيد افتتاحي', onclick: () => adjustmentForm({ opening: true, target: 'item' }) })),
  );
  return { title: 'المخزن العيني', body };
}

export function itemScreen({ id }) {
  const S = ctx.state;
  const it = S.lists.items.get(id);
  if (!it) return { title: 'صنف', body: empty('الصنف غير موجود') };
  const p = itemPosition(computeLedger(S), id);
  const movs = S.movements
    .filter((mv) => !mv.voided && ((mv.kind === 'purchase' && mv.lines.some((l) => l.itemId === id)) || ((mv.kind === 'inkind_receipt' || mv.kind === 'distribution') && (mv.items || []).some((x) => x.itemId === id)) || ((mv.kind === 'adjustment' || mv.kind === 'opening') && mv.itemId === id)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq));
  const body = h(
    'div',
    {},
    h(
      'div',
      { class: 'card' },
      kv('الرصيد الحالي (الفائض)', `${F.qty(p.qty)} ${it.unit}`),
      kv('قيمته بالتكلفة', F.egp(p.cost)),
      kv('وارد بالشراء', `${F.qty(p.purchasedQty)} ${it.unit} — ${F.egp(p.purchasedCost)}`),
      kv('وارد بالتبرع', `${F.qty(p.donatedQty)} ${it.unit} — ${F.egp(p.donatedValue)}`),
      kv('وُزّع مباشرة دون مخزن', `${F.qty(p.directQty)} ${it.unit}`),
      kv('صادر من المخزن', `${F.qty(p.distributedQty)} ${it.unit} — ${F.egp(p.distributedCost)}`),
      p.adjustedQty ? kv('تسويات', `${F.qty(p.adjustedQty)} ${it.unit}`) : null,
    ),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'تعديل الصنف', onclick: () => listItemForm('items', it) })),
    sectionTitle('حركات الصنف'),
    movementList(movs),
  );
  return { title: it.name, body };
}

// ---------- الأصول: ذهب / عملة / ممتلكات / استثمار ----------
export function assetsScreen() {
  const S = ctx.state;
  const led = computeLedger(S);
  const today = ctx.today();
  const body = h('div', {});
  let cost = 0;
  let value = 0;
  let realized = 0;
  let income = 0;
  const byFund = new Map();
  for (const a of S.lists.assets.values()) {
    const p = assetPosition(S, led, a.id, today);
    cost += p.cost;
    value += p.value;
    realized += p.realized;
    income += p.income;
    if (a.archived && p.qty === 0) continue;
    if (!byFund.has(a.fundId)) byFund.set(a.fundId, []);
    byFund.get(a.fundId).push({ a, p });
  }
  const pl = value - cost;
  body.append(
    h(
      'div',
      { class: 'stats' },
      stat('المدفوع (التكلفة)', F.money(cost)),
      stat('القيمة الحالية', F.money(value), { cls: 'primary' }),
      stat('ربح/خسارة غير محققة', F.money(pl, { sign: true }), { valueClass: pl >= 0 ? 'pos' : 'neg' }),
      stat('أرباح محققة + عوائد', F.money(realized + income, { sign: true }), { valueClass: realized + income >= 0 ? 'pos' : 'neg' }),
    ),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', text: 'شراء', onclick: () => assetTradeForm({ kind: 'asset_buy' }) }),
      h('button', { class: 'btn primary', text: 'بيع', onclick: () => assetTradeForm({ kind: 'asset_sell' }) }),
      h('button', { class: 'btn', text: 'عائد', onclick: () => assetIncomeForm() }),
    ),
  );
  body.append(sectionTitle('الأصول', h('button', { text: '+ أصل جديد', onclick: () => listItemForm('assets') })));
  if (!byFund.size) body.append(empty('لا توجد أصول — أضف أصلاً (ذهب، عملة، ممتلكات، استثمار) ثم سجّل الشراء.'));
  for (const [fundId, arr] of byFund) {
    body.append(h('div', { class: 'muted small', style: { margin: '10px 4px 4px' }, text: S.lists.funds.get(fundId)?.name || '' }));
    body.append(
      list(
        arr.map(({ a, p }) =>
          row({
            title: a.name,
            subtitle: `${F.aqty(p.qty)} ${a.unit} · المدفوع ${F.money(p.cost)}${p.price === null ? ' · بلا سعر حالي' : ''}`,
            value: F.money(p.value),
            badge: p.price !== null ? badge(F.money(p.unrealized, { sign: true }), p.unrealized >= 0 ? 'ok' : 'bad') : badge('حدّث السعر', 'warn'),
            onclick: () => ctx.nav(`#/asset/${a.id}`),
          }),
        ),
      ),
    );
  }
  body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'أصل وارد بدون شراء', onclick: () => assetInForm() }), h('button', { class: 'btn small', text: 'رصيد افتتاحي لأصل', onclick: () => adjustmentForm({ opening: true, target: 'asset' }) })));
  return { title: 'الذهب والاستثمار', body };
}

export function assetScreen({ id }) {
  const S = ctx.state;
  const a = S.lists.assets.get(id);
  if (!a) return { title: 'أصل', body: empty('الأصل غير موجود') };
  const led = computeLedger(S);
  const p = assetPosition(S, led, id, ctx.today());
  const prices = [...(S.prices.get(id) || [])].reverse();
  const movs = S.movements.filter((mv) => !mv.voided && mv.assetId === id).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.seq - x.seq));
  const body = h(
    'div',
    {},
    h(
      'div',
      { class: 'card' },
      kv('النوع', ASSET_KINDS[a.kind] || ''),
      kv('يتبع', S.lists.funds.get(a.fundId)?.name || ''),
      kv('الكمية الموجودة', `${F.aqty(p.qty)} ${a.unit}`),
      kv('المدفوع (التكلفة)', F.egp(p.cost)),
      kv('السعر الحالي للوحدة', p.price !== null ? `${F.egp(p.price)} (${F.date(p.priceDate)})` : 'لم يُدخل'),
      kv('القيمة الحالية', F.egp(p.value)),
      kv('ربح/خسارة غير محققة', F.egp(p.unrealized, { sign: true }), p.unrealized >= 0 ? 'pos' : 'neg'),
      kv('ربح/خسارة محققة من البيع', F.egp(p.realized, { sign: true }), p.realized >= 0 ? 'pos' : 'neg'),
      p.income ? kv('عوائد مستلمة', F.egp(p.income), 'pos') : null,
    ),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', text: 'تحديث السعر', onclick: () => priceForm(id) }),
      h('button', { class: 'btn', text: 'شراء', onclick: () => assetTradeForm({ kind: 'asset_buy', assetId: id }) }),
      h('button', { class: 'btn', text: 'بيع', onclick: () => assetTradeForm({ kind: 'asset_sell', assetId: id }) }),
    ),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'عائد', onclick: () => assetIncomeForm({ assetId: id }) }), h('button', { class: 'btn small', text: 'تعديل الأصل', onclick: () => listItemForm('assets', a) })),
    sectionTitle('الحركات'),
    movementList(movs),
    sectionTitle('سجل الأسعار'),
    prices.length ? list(prices.map((x) => row({ title: F.egp(x.price), subtitle: F.date(x.date) }))) : empty('لم يُدخل سعر بعد'),
  );
  return { title: a.name, body };
}

// ---------- كل الحركات ----------
export function ledgerScreen() {
  const S = ctx.state;
  const st = ui('ledger', { q: '', kind: '', fund: '', from: '', to: '', voided: false });
  const body = h('div', {});
  const search = h('input', { class: 'search', type: 'search', placeholder: 'بحث: اسم، مبلغ، ملاحظة، تاريخ…', value: st.q, 'aria-label': 'بحث' });
  const kind = selectInput(Object.entries(MOVEMENT_KINDS).map(([value, label]) => ({ value, label })), st.kind, { placeholder: 'كل الأنواع' });
  const fund = selectInput([...S.lists.funds.values()].map((f) => ({ value: f.id, label: f.name })), st.fund, { placeholder: 'كل الصناديق' });
  const from = h('input', { type: 'date', value: st.from, 'aria-label': 'من تاريخ' });
  const to = h('input', { type: 'date', value: st.to, 'aria-label': 'إلى تاريخ' });
  const voided = h('input', { type: 'checkbox', checked: st.voided });
  const box = h('div', {});
  const draw = () => {
    Object.assign(st, { q: search.value, kind: kind.value, fund: fund.value, from: from.value, to: to.value, voided: voided.checked });
    const movs = searchMovements(S, { text: st.q, kinds: st.kind ? [st.kind] : null, fundId: st.fund || null, from: st.from || null, to: st.to || null, includeVoided: st.voided });
    box.replaceChildren(h('div', { class: 'muted small', style: { margin: '0 4px 6px' }, text: `${F.num(movs.length)} حركة` }), movementList(movs));
  };
  [search, from, to].forEach((el) => el.addEventListener('input', draw));
  [kind, fund, voided].forEach((el) => el.addEventListener('change', draw));
  body.append(search, h('div', { class: 'grid2' }, h('div', { class: 'field' }, kind), h('div', { class: 'field' }, fund)), h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { text: 'من' }), from), h('div', { class: 'field' }, h('label', { text: 'إلى' }), to)), h('label', { class: 'check' }, voided, 'إظهار الملغاة'), box);
  draw();
  return { title: 'كل الحركات', body };
}

// ---------- تفاصيل حركة ----------
const LINE_KIND = { sub: 'اشتراك', advance: 'مقدم لشهر قادم', extra: 'زيادة / إضافة عامة', earmark: 'مخصص', entitlement: 'استحقاق شهر' };

export function movementScreen({ id }) {
  const S = ctx.state;
  const mv = S.mvById.get(id);
  if (!mv) return { title: 'حركة', body: empty('الحركة غير موجودة') };
  const d = describeMovement(S, mv);
  const led = computeLedger(S);
  const eff = led.effects.get(id);
  const body = h('div', {});
  if (mv.voided) body.append(h('div', { class: 'banner bad', text: `ملغاة في ${F.date(mv.voided.date)} — السبب: ${mv.voided.reason}` }));
  const card = h('div', { class: 'card' }, mv.voucher ? kv('السند', voucherText(mv)) : null, kv('النوع', d.kind), kv('التاريخ', F.date(mv.date)));
  if (mv.payer) card.append(kv('من', payerName(S, mv.payer)));
  if (mv.kind === 'distribution') card.append(kv('إلى', d.party));
  if (mv.amount !== undefined && mv.target !== 'item' && mv.target !== 'asset') card.append(kv('المبلغ', F.egp(mv.amount)));
  for (const [acct, delta] of cashPostings(mv)) card.append(kv(delta >= 0 ? 'يدخل' : 'يخرج من', `${acctLabel(S, acct)}: ${F.money(delta, { sign: true })}`, delta >= 0 ? 'pos' : 'neg'));
  if (mv.assetId) card.append(kv('الأصل', S.lists.assets.get(mv.assetId)?.name || ''));
  if (mv.qty !== undefined && (mv.assetId || mv.target === 'asset')) card.append(kv('الكمية', `${F.aqty(mv.qty)} ${S.lists.assets.get(mv.assetId)?.unit || ''}`));
  if (mv.target === 'item') card.append(kv('الصنف', S.lists.items.get(mv.itemId)?.name || ''), kv('الكمية', F.qty(mv.qty)));
  if (mv.value !== undefined) card.append(kv('القيمة', F.egp(mv.value)));
  if (mv.cost !== undefined) card.append(kv('التكلفة', F.egp(mv.cost)));
  if (eff?.realized !== undefined) card.append(kv(eff.realized >= 0 ? 'ربح البيع' : 'خسارة البيع', F.egp(eff.realized, { sign: true }), eff.realized >= 0 ? 'pos' : 'neg'));
  if (eff?.costOut && mv.kind === 'distribution') card.append(kv('تكلفة الأصناف الموزعة', F.egp(eff.costOut)));
  if (mv.expenseTypeId) card.append(kv('نوع المصروف', S.lists.expenseTypes.get(mv.expenseTypeId)?.name || ''));
  if (mv.direct) card.append(kv('ملاحظة مخزن', 'وُزّع مباشرة (لم يدخل المخزن)'));
  if (mv.reason) card.append(kv('السبب', mv.reason));
  if (mv.note) card.append(kv('ملاحظة', mv.note));
  if (mv.replaces) card.append(kv('تعديل لحركة سابقة', h('button', { class: 'link', text: 'عرض الأصلية', onclick: () => ctx.nav(`#/movement/${mv.replaces}`) })));
  card.append(kv('سُجّلت في', F.dateTime(mv.ts)));
  body.append(card);

  if ((mv.kind === 'receipt' || mv.kind === 'distribution') && mv.lines?.length) {
    body.append(sectionTitle('بنود التخصيص'));
    body.append(
      list(
        mv.lines.map((l) =>
          row({
            title: `${LINE_KIND[l.kind] || l.kind}${l.month ? ` — ${F.month(l.month)}` : ''}`,
            subtitle: [l.target ? acctLabel(S, targetAcct(l.target)) : '', l.purposeId ? S.lists.purposes.get(l.purposeId)?.name : ''].filter(Boolean).join(' · '),
            value: F.money(l.amount),
          }),
        ),
      ),
    );
  }
  if (mv.kind === 'purchase') {
    body.append(sectionTitle('الأصناف'));
    body.append(list(mv.lines.map((l) => row({ title: S.lists.items.get(l.itemId)?.name || '', subtitle: [`${F.qty(l.qty)} ${S.lists.items.get(l.itemId)?.unit || ''}`, l.note].filter(Boolean).join(' · '), value: F.money(l.cost) }))));
  }
  if (mv.items?.length) {
    body.append(sectionTitle('الأصناف'));
    body.append(list(mv.items.map((it) => row({ title: S.lists.items.get(it.itemId)?.name || '', subtitle: `${F.qty(it.qty)} ${S.lists.items.get(it.itemId)?.unit || ''}`, value: it.value !== undefined ? F.money(it.value) : '' }))));
  }
  if (mv.inkindMonths?.length) body.append(h('div', { class: 'card' }, kv('يسدد استحقاق شهور', mv.inkindMonths.map((m) => F.month(m)).join('، '))));

  if (!mv.voided && ['receipt', 'inkind_receipt', 'distribution'].includes(mv.kind)) {
    body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', text: 'مشاركة إيصال', onclick: () => shareReceipt(S, mv, d) })));
  }
  if (!mv.voided) {
    const locked = isLockedDate(S, mv.date);
    if (locked) body.append(h('div', { class: 'banner info', text: 'هذه الحركة داخل سنة مقفولة — للقراءة فقط.' }));
    else {
      body.append(
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn', text: 'تعديل', onclick: () => editMovementFlow(mv) }),
          h('button', {
            class: 'btn danger',
            text: 'إلغاء الحركة',
            onclick: async () => {
              if (await voidMovementFlow(mv)) ctx.refresh();
            },
          }),
        ),
      );
    }
  }
  return { title: d.title, body };
}

// نص إيصال يُرسل للمتبرع أو يُحفظ (واتساب/رسائل) — توثيق لكل قبض وصرف.
function receiptText(S, mv, d) {
  const out = [S.settings.orgName || 'دفتر الخير'];
  if (mv.voucher) out.push(voucherText(mv));
  out.push(`التاريخ: ${F.date(mv.date)}`);
  if (mv.kind === 'distribution') out.push(`صُرف إلى: ${d.party}`);
  else out.push(`استلمنا من: ${d.party}`);
  if (mv.amount) out.push(`المبلغ: ${F.egp(mv.amount)}`);
  const parts = [];
  for (const l of mv.lines || []) {
    const what = l.kind === 'sub' ? `اشتراك ${F.month(l.month)}` : l.kind === 'advance' ? `مقدم ${F.month(l.month)}` : l.kind === 'entitlement' ? `استحقاق ${F.month(l.month)}` : l.kind === 'earmark' ? acctLabel(S, targetAcct(l.target)) : mv.kind === 'distribution' ? 'مساعدة' : 'تبرع';
    parts.push(`${what}: ${F.money(l.amount)}`);
  }
  for (const it of mv.items || []) parts.push(`${S.lists.items.get(it.itemId)?.name || ''}: ${F.qty(it.qty)} ${S.lists.items.get(it.itemId)?.unit || ''}`);
  if (parts.length) out.push('البيان: ' + parts.join('، '));
  if (mv.kind !== 'distribution') out.push('جزاكم الله خيراً');
  return out.join('\n');
}

async function shareReceipt(S, mv, d) {
  const text = receiptText(S, mv, d);
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      toast('نُسخ نص الإيصال');
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('تعذّرت المشاركة', 'bad');
  }
}

// ---------- القوائم ----------
export function listsScreen() {
  const S = ctx.state;
  const body = h('div', {}, list(Object.entries(LIST_INFO).map(([name, info]) => row({ title: info.title, subtitle: `${F.num(S.lists[name].size)} عنصر`, onclick: () => ctx.nav(`#/lists/${name}`) }))));
  return { title: 'القوائم', body };
}

export function listScreen({ name }) {
  const S = ctx.state;
  const info = LIST_INFO[name];
  if (!info) return { title: 'قائمة', body: empty('غير موجودة') };
  const items = [...S.lists[name].values()].sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || collator.compare(a.name, b.name));
  const sub = (it) => (name === 'items' ? it.unit : name === 'campaigns' ? it.kind : name === 'assets' ? `${ASSET_KINDS[it.kind] || ''} · ${it.unit}` : '');
  const body = h('div', {}, items.length ? list(items.map((it) => row({ title: it.name, subtitle: sub(it) || '', badge: it.archived ? badge('مؤرشف') : it.builtin ? badge('أساسي', 'info') : null, onclick: () => listItemForm(name, it) }))) : empty('فارغة'));
  return { title: info.title, body, fab: { label: `${info.one} جديد`, onclick: () => listItemForm(name) } };
}

// ---------- سجل التدقيق ----------
const EVENT_LABEL = {
  'settings.set': 'تغيير إعداد',
  'list.upsert': 'تعديل قائمة',
  'subscriber.upsert': 'بيانات مشترك',
  'subscription.set': 'تغيير اشتراك',
  'family.upsert': 'بيانات أسرة',
  'family.profile.set': 'تحديث ملف أسرة',
  'price.set': 'تحديث سعر أصل',
  'movement.add': 'حركة',
  'movement.void': 'إلغاء حركة',
  'due.decision': 'قرار على متأخر',
  'year.close': 'إقفال سنة',
  'year.reopen': 'تراجع عن إقفال',
};

function describeEvent(S, ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'movement.add': {
      const mv = S.mvById.get(d.movement.id);
      const x = mv ? describeMovement(S, mv) : null;
      return { text: x ? `${x.title}${x.party ? ` — ${x.party}` : ''}: ${F.money(x.amount)}` : 'حركة', path: `#/movement/${d.movement.id}` };
    }
    case 'movement.void':
      return { text: `السبب: ${d.reason}`, path: `#/movement/${d.movementId}` };
    case 'subscription.set':
      return { text: `${S.subscribers.get(d.subscriberId)?.name || ''}: ${d.amount ? F.egp(d.amount) : 'إيقاف'} من ${F.month(d.from)}`, path: `#/subscriber/${d.subscriberId}` };
    case 'subscriber.upsert':
      return { text: d.name || S.subscribers.get(d.id)?.name || '', path: `#/subscriber/${d.id}` };
    case 'family.upsert':
      return { text: d.name || S.families.get(d.id)?.name || '', path: `#/family/${d.id}` };
    case 'family.profile.set':
      return { text: `${S.families.get(d.familyId)?.name || ''} من ${F.month(d.from)}`, path: `#/family/${d.familyId}` };
    case 'list.upsert':
      return { text: `${LIST_INFO[d.list]?.one || d.list}: ${d.item.name || S.lists[d.list]?.get(d.item.id)?.name || ''}` };
    case 'price.set':
      return { text: `${S.lists.assets.get(d.assetId)?.name || ''}: ${F.egp(d.price)} بتاريخ ${F.date(d.date)}`, path: `#/asset/${d.assetId}` };
    case 'due.decision': {
      const who = d.entity === 'family' ? S.families.get(d.entityId)?.name : S.subscribers.get(d.entityId)?.name;
      return { text: `${who || ''} — ${F.month(d.month)}: ${d.decision === 'writeoff' ? `لن يُسدد (${d.reason})` : 'أُعيد كمطلوب'}` };
    }
    case 'year.close':
    case 'year.reopen':
      return { text: `سنة ${F.num(d.year)}`, path: '#/closing' };
    case 'settings.set':
      return { text: d.key };
    default:
      return { text: '' };
  }
}

export function auditScreen() {
  const S = ctx.state;
  const st = ui('audit', { limit: 150 });
  const events = ctx.store.events.filter((e) => !e.id.startsWith('seed-'));
  const shown = events.slice(-st.limit).reverse();
  const body = h('div', {}, h('div', { class: 'muted small', style: { margin: '0 4px 8px' }, text: `${F.num(events.length)} حدث مسجَّل — السجل لا يُمحى منه شيء؛ التعديل والحذف يُسجَّلان كأحداث جديدة.` }));
  body.append(
    shown.length
      ? list(
          shown.map((ev) => {
            const x = describeEvent(S, ev);
            return row({ title: EVENT_LABEL[ev.type] || ev.type, subtitle: [F.dateTime(ev.ts), x.text].filter(Boolean).join(' · '), onclick: x.path ? () => ctx.nav(x.path) : null });
          }),
        )
      : empty('لا أحداث بعد'),
  );
  if (events.length > st.limit) body.append(h('button', { class: 'btn block', text: 'عرض المزيد', onclick: () => ((st.limit += 300), ctx.refresh()) }));
  return { title: 'سجل التدقيق', body };
}
