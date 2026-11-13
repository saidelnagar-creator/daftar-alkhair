// اللوحة الرئيسية: أهم الأرقام + الإدخال السريع.
import { h } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { stat, sectionTitle } from '../components.js';
import { computeLedger, rollups } from '../../core/ledger.js';
import { dueReviews } from '../../core/need.js';
import { driveStatus } from '../../storage/drive-sync.js';
import { driveConnect } from '../../storage/drive-sync.js';
import { movementList } from '../widgets.js';
import { dashboard, searchMovements } from '../../core/reports.js';
import { exportBackupNow } from './settings.js';
import { paymentFlow, receiptForm, distributionForm, expenseForm, transferForm, purchaseForm, inkindReceiptForm } from '../forms-movements.js';

export function homeScreen() {
  const S = ctx.state;
  const d = dashboard(S, ctx.today());
  const body = h('div', {});
  // حالة النسخ الاحتياطي ظاهرة دائماً متى وُجد ما لم يُنسخ — والنسخ بنقرة واحدة
  const unsaved = ctx.store.unsavedChanges();
  const drive = driveStatus(ctx.store);
  if (drive.state === 'needs-auth' || drive.state === 'error') {
    body.append(
      h(
        'div',
        { class: 'banner' },
        h('span', { class: 'grow', text: drive.state === 'needs-auth' ? `النسخ التلقائي على Drive متوقف — جدّد الاتصال${drive.pending ? ` (${F.num(drive.pending)} تغيير لم يُرفع)` : ''}.` : `تعذّر الرفع إلى Drive: ${drive.error}` }),
        drive.state === 'needs-auth' ? h('button', { class: 'btn small', text: 'تجديد', onclick: () => driveConnect(ctx.store, { silent: !!drive.lastAt }) }) : h('button', { class: 'btn small', text: 'النسخ', onclick: () => ctx.nav('#/backup') }),
      ),
    );
  }
  if (unsaved > 0 && drive.state !== 'ok' && drive.state !== 'pending') {
    const last = ctx.store.meta.lastBackupAt;
    const days = last ? Math.floor((Date.now() - new Date(last)) / 86400000) : null;
    const due = ctx.store.backupDue();
    const when = last ? (days === 0 ? 'اليوم' : `منذ ${F.num(days)} يوم`) : 'لم تُؤخذ بعد';
    body.append(
      h(
        'div',
        { class: `banner ${due ? '' : 'info'}` },
        h('span', { class: 'grow', text: due ? `حان وقت النسخة الاحتياطية — ${F.num(unsaved)} تغيير غير منسوخ (آخر نسخة: ${when}).` : `آخر نسخة احتياطية: ${when} — ${F.num(unsaved)} تغيير غير منسوخ.` }),
        h('button', { class: 'btn small', text: 'نسخ الآن', onclick: () => exportBackupNow() }),
      ),
    );
  }
  if (d.problems) body.append(h('div', { class: 'banner bad', text: 'يوجد رصيد سالب في المخزن أو الأصول — راجع الحركات.' }));
  const action = (emo, label, onclick, cls = '') => h('button', { class: `action ${cls}`, onclick }, h('span', { class: 'emo', text: emo, 'aria-hidden': 'true' }), h('span', { text: label }));
  body.append(
    h(
      'div',
      { class: 'actions' },
      action('＋', 'دفعة اشتراك', () => paymentFlow(), 'primary'),
      action('🤲', 'تبرع', () => receiptForm()),
      action('👪', 'صرف لأسرة', () => distributionForm()),
      action('🧾', 'مصروف', () => expenseForm()),
      action('🔁', 'تحويل', () => transferForm()),
      action('🛒', 'شراء', () => purchaseForm()),
      action('📦', 'تبرع عيني', () => inkindReceiptForm()),
      action('👥', 'صرف مجمّع', () => ctx.nav('#/batch')),
      action('📊', 'التقارير', () => ctx.nav('#/reports')),
    ),
  );
  const pools = rollups(S, computeLedger(S));
  const reviews = dueReviews(S, ctx.nowMonth());
  if (reviews.length) body.append(h('div', { class: 'banner info' }, h('span', { class: 'grow', text: `مراجعات مستحقة: ${F.num(reviews.length)} أسرة حلّ موعد مراجعة تقييمها.` }), h('button', { class: 'btn small', text: 'عرض', onclick: () => ctx.nav('#/reviews') })));
  body.append(
    h(
      'div',
      { class: 'stats' },
      stat('إجمالي السيولة', F.money(d.totalCash), { cls: 'primary', hint: `الصندوق العام ${F.money(d.general)}`, onclick: () => ctx.nav('#/funds') }),
      ...pools.map((p) => stat(p.rollup.name, F.money(p.total), { hint: p.parts.map((x) => x.fund.name).join(' + '), onclick: () => ctx.nav('#/funds') })),
      stat('المتأخرات', F.money(d.arrearsTotal), { hint: `${F.num(d.arrearsCount)} مشترك`, valueClass: d.arrearsTotal ? 'neg' : '', onclick: () => ctx.nav('#/arrears') }),
      stat('وارد هذا الشهر', F.money(d.monthIn), { valueClass: 'pos' }),
      stat('منصرف هذا الشهر', F.money(d.monthOut), { valueClass: 'neg' }),
      stat('استحقاقات أسر متبقية', F.money(d.familyDuesTotal), { hint: `${F.num(d.familyDuesCount)} أسرة`, onclick: () => ctx.nav('#/families') }),
      stat('الذهب والاستثمار', F.money(d.assetsValue), { hint: `المدفوع ${F.money(d.assetsCost)}`, onclick: () => ctx.nav('#/assets') }),
    ),
  );
  body.append(sectionTitle('آخر الحركات', h('button', { text: 'الكل', onclick: () => ctx.nav('#/ledger') })));
  body.append(movementList(searchMovements(S, { limit: 8 }), { emptyText: 'ابدأ بإضافة مشترك أو أسرة، أو استورد نسخة احتياطية من «المزيد».' }));
  return { title: S.settings.orgName || 'دفتر الخير', subtitle: `السنة المالية ${F.num(ctx.fiscalYear())}${ctx.fiscalYear() < new Date().getFullYear() ? ' — لم تُقفل بعد' : ''}`, body, root: true };
}
