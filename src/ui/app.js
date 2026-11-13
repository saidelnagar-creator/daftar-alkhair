// هيكل التطبيق: التنقل بالـ hash، الشريط العلوي والسفلي، إعادة الرسم عند تغيّر البيانات، قفل PIN.
import { h, icon, clear } from './dom.js';
import { ctx } from './ctx.js';
import { closeAllSheets } from './components.js';
import { RULES } from '../config/rules.js';
import { normalizeDigits } from '../core/money.js';
import { homeScreen } from './screens/home.js';
import { subscribersScreen, subscriberScreen } from './screens/subscribers.js';
import { familiesScreen, familyScreen } from './screens/families.js';
import { fundsScreen, fundScreen } from './screens/funds.js';
import { moreScreen, arrearsScreen, inventoryScreen, itemScreen, assetsScreen, assetScreen, ledgerScreen, movementScreen, listsScreen, listScreen, auditScreen } from './screens/more.js';
import { reportsScreen } from './screens/reports.js';
import { settingsScreen, backupScreen, closingScreen, archiveScreen, pinMatches, makePinRecord } from './screens/settings.js';
import { helpScreen } from './screens/help.js';
import { batchScreen, purchasePlanScreen } from './screens/inkind.js';
import { assessScreen, assessmentScreen, reviewsScreen, allocationScreen, needConfigScreen } from './screens/need.js';
import { udhiyaListScreen, udhiyaScreen } from './screens/udhiya.js';
import { printScreen } from './screens/reports.js';
import { PRIVACY_GROUPS, anyHidden, isCustomizing, isHidden, privacyState, setAllPrivacy, setCustomizing, toggleAllPrivacy, toggleGroupPrivacy } from './privacy.js';
import { chips } from './components.js';

const ROUTES = [
  [/^\/?$/, homeScreen, 'home'],
  [/^\/subscribers$/, subscribersScreen, 'subscribers'],
  [/^\/subscriber\/([^/]+)$/, (m) => subscriberScreen({ id: m[1] }), 'subscribers'],
  [/^\/families$/, familiesScreen, 'families'],
  [/^\/family\/([^/]+)$/, (m) => familyScreen({ id: m[1] }), 'families'],
  [/^\/funds$/, fundsScreen, 'funds'],
  [/^\/fund\/(.+)$/, (m) => fundScreen({ id: m[1] }), 'funds'],
  [/^\/more$/, moreScreen, 'more'],
  [/^\/arrears$/, arrearsScreen, 'more'],
  [/^\/inventory$/, inventoryScreen, 'more'],
  [/^\/item\/([^/]+)$/, (m) => itemScreen({ id: m[1] }), 'more'],
  [/^\/assets$/, assetsScreen, 'more'],
  [/^\/asset\/([^/]+)$/, (m) => assetScreen({ id: m[1] }), 'more'],
  [/^\/reports$/, reportsScreen, 'more'],
  [/^\/ledger$/, ledgerScreen, 'more'],
  [/^\/movement\/([^/]+)$/, (m) => movementScreen({ id: m[1] }), 'more'],
  [/^\/lists$/, listsScreen, 'more'],
  [/^\/lists\/([^/]+)$/, (m) => listScreen({ name: m[1] }), 'more'],
  [/^\/settings$/, settingsScreen, 'more'],
  [/^\/backup$/, backupScreen, 'more'],
  [/^\/closing$/, closingScreen, 'more'],
  [/^\/archive\/(\d+)$/, (m) => archiveScreen({ year: m[1] }), 'more'],
  [/^\/audit$/, auditScreen, 'more'],
  [/^\/help$/, helpScreen, 'more'],
  [/^\/batch$/, batchScreen, 'families'],
  [/^\/purchase-plan$/, purchasePlanScreen, 'more', 'assets'],
  [/^\/assess\/([^/]+)$/, (m) => assessScreen({ familyId: m[1] }), 'families'],
  [/^\/assess\/([^/]+)\/([^/]+)$/, (m) => assessScreen({ familyId: m[1], assessmentId: m[2] }), 'families'],
  [/^\/assessment\/([^/]+)$/, (m) => assessmentScreen({ id: m[1] }), 'families'],
  [/^\/reviews$/, reviewsScreen, 'families'],
  [/^\/allocation$/, allocationScreen, 'families'],
  [/^\/need-config$/, needConfigScreen, 'more'],
  [/^\/udhiya$/, udhiyaListScreen, 'more'],
  [/^\/udhiya\/([^/]+)$/, (m) => udhiyaScreen({ id: m[1] }), 'more'],
  [/^\/print$/, printScreen, 'more', 'reports'],
];

// مجموعة الخصوصية لكل شاشة (العمود الرابع في ROUTES يغلب، ثم المسار، ثم التبويب).
const PATH_GROUP = [
  [/^\/(assets|asset|inventory|item)/, 'assets'],
  [/^\/(ledger|movement|audit)/, 'movements'],
  [/^\/reports/, 'reports'],
  [/^\/arrears/, 'subscribers'],
];
const TAB_GROUP = { home: 'home', subscribers: 'subscribers', families: 'families', funds: 'funds', more: 'other' };
function groupOf(path, tab, explicit) {
  if (explicit) return explicit;
  for (const [re, g] of PATH_GROUP) if (re.test(path)) return g;
  return TAB_GROUP[tab] || 'other';
}

// شريط تخصيص الإخفاء: مجموعة مجموعة، والبنود المفردة بزر العين بجانب كل رقم.
function privacyBar() {
  const p = privacyState();
  const groups = h('div', { class: 'chips' });
  for (const [g, label] of Object.entries(PRIVACY_GROUPS)) {
    if (g === 'other') continue;
    const hidden = isHidden(g);
    groups.append(h('button', { class: `chip ${hidden ? '' : 'on'}`, text: `${hidden ? '🙈' : '👁'} ${label}`, 'aria-pressed': hidden ? 'false' : 'true', onclick: () => toggleGroupPrivacy(g) }));
  }
  return h(
    'div',
    { class: 'privacy-bar no-print' },
    h('div', { class: 'muted small', text: 'اختر ما يظهر: اضغط مجموعة لإخفائها أو إظهارها كلها، أو زر العين بجانب أي رقم لبند واحد. الإعداد محفوظ على هذا الجهاز.' }),
    groups,
    h(
      'div',
      { class: 'btn-row', style: { marginTop: '8px' } },
      h('button', { class: 'btn small', text: 'إخفاء الكل', onclick: () => setAllPrivacy('hide') }),
      h('button', { class: 'btn small', text: 'إظهار الكل', onclick: () => setAllPrivacy('show') }),
      h('button', { class: 'btn small primary', text: 'تم', onclick: () => setCustomizing(false) }),
    ),
    h('div', { class: 'muted small', style: { marginTop: '6px' }, text: p.all === 'hide' ? 'الوضع العام: مخفي' : 'الوضع العام: ظاهر' }),
  );
}

const TABS = [
  ['#/', 'home', 'الرئيسية', 'home'],
  ['#/subscribers', 'users', 'المشتركون', 'subscribers'],
  ['#/families', 'family', 'الأسر', 'families'],
  ['#/funds', 'wallet', 'الصناديق', 'funds'],
  ['#/more', 'more', 'المزيد', 'more'],
];

let root;
let lastPath = null;
let updateBanner = null;

function currentPath() {
  return (location.hash || '#/').slice(1) || '/';
}

function render() {
  const path = currentPath();
  const samePage = path === lastPath;
  const scroll = samePage ? window.scrollY : 0;
  let match = null;
  for (const [re, fn, tab, group] of ROUTES) {
    const m = path.match(re);
    if (m) {
      match = { fn: () => fn(m), tab, group };
      break;
    }
  }
  ctx.pgroup = match ? groupOf(path, match.tab, match.group) : 'other';
  let screen;
  try {
    screen = match ? match.fn() : { title: 'غير موجود', body: h('div', { class: 'empty', text: 'الصفحة غير موجودة' }) };
  } catch (e) {
    console.error(e);
    screen = { title: 'خطأ', body: h('div', { class: 'banner bad', text: 'حدث خطأ أثناء عرض الصفحة: ' + e.message }) };
  }
  const top = h(
    'header',
    { class: 'topbar' },
    screen.root ? null : h('button', { class: 'icon-btn', 'aria-label': 'رجوع', onclick: () => ctx.back(), style: { transform: 'scaleX(1)' } }, icon('back')),
    h('h1', {}, screen.title, screen.subtitle ? h('div', { class: 'sub', text: screen.subtitle }) : null),
    // ضغطة واحدة: إخفاء كل الأرصدة / إظهار الكل
    h('button', { class: `icon-btn ${anyHidden() ? 'on' : ''}`, id: 'privacy-toggle', 'aria-label': privacyState().all === 'hide' ? 'إظهار كل الأرصدة' : 'إخفاء كل الأرصدة', 'aria-pressed': privacyState().all === 'hide' ? 'true' : 'false', onclick: () => toggleAllPrivacy() }, icon(privacyState().all === 'hide' ? 'eyeOff' : 'eye')),
    h('button', { class: `icon-btn ${isCustomizing() ? 'on' : ''}`, id: 'privacy-customize', 'aria-label': 'تخصيص الإخفاء', onclick: () => setCustomizing(!isCustomizing()) }, icon('tune')),
  );
  const main = h('main', { class: 'screen', id: 'screen' }, updateBanner, isCustomizing() ? privacyBar() : null, screen.body);
  const tabs = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'التنقل الرئيسي' },
    TABS.map(([href, ic, label, key]) => h('a', { href, class: match && match.tab === key ? 'active' : '', 'aria-current': match && match.tab === key ? 'page' : null }, icon(ic), h('span', { text: label }))),
  );
  clear(root);
  root.append(top, main);
  if (screen.fab) root.append(h('button', { class: 'fab', onclick: screen.fab.onclick }, icon('plus', 20), screen.fab.label));
  root.append(tabs);
  document.title = `${screen.title} — دفتر الخير`;
  lastPath = path;
  window.scrollTo(0, scroll);
}

export function showUpdateBanner(onApply) {
  updateBanner = h('div', { class: 'banner info' }, h('span', { class: 'grow', text: 'يوجد تحديث جديد للتطبيق (بياناتك لا تتأثر).' }), h('button', { class: 'btn small', text: 'تحديث الآن', onclick: onApply }));
  if (root && !document.querySelector('.lock')) render();
}

// ---------- قفل PIN ----------
// بعد 5 محاولات خاطئة متتالية يُفرض انتظار يتضاعف (30 ثانية ← … ← 15 دقيقة). العدّاد محفوظ فلا يصفّره إغلاق التطبيق.
const LOCK_AFTER = 5;
const lockDelay = (fails) => Math.min(15 * 60, 30 * 2 ** (fails - LOCK_AFTER)) * 1000;
let lockedAt = 0;

function lockScreen(onUnlock) {
  const store = ctx.store;
  const pin = store.meta.pin;
  let entered = '';
  let busy = false;
  let tickTimer = null;
  const dots = h('div', { class: 'pin-dots' });
  const msg = h('div', { class: 'muted', role: 'status', text: 'أدخل رقم القفل' });
  const guard = () => store.meta.pinGuard || { fails: 0, until: 0 };
  const waitMs = () => Math.max(0, (guard().until || 0) - Date.now());
  const draw = () => {
    clear(dots);
    for (let i = 0; i < Math.max(pin.len || 4, entered.length); i++) dots.append(h('span', { class: i < entered.length ? 'on' : '' }));
  };
  const showWait = () => {
    clearInterval(tickTimer);
    const update = () => {
      const ms = waitMs();
      if (ms <= 0) {
        clearInterval(tickTimer);
        msg.textContent = 'أدخل رقم القفل';
        return;
      }
      msg.textContent = `محاولات خاطئة كثيرة — انتظر ${Math.ceil(ms / 1000)} ثانية`;
    };
    update();
    tickTimer = setInterval(update, 1000);
  };
  const finish = () => {
    clearInterval(tickTimer);
    document.removeEventListener('keydown', onKey);
    onUnlock();
  };
  const submit = async () => {
    if (busy || waitMs() > 0) return;
    busy = true;
    const ok = pinMatches(pin, entered);
    if (ok) {
      if (guard().fails) await store.setMeta('pinGuard', undefined);
      if (!pin.iter) await store.setMeta('pin', makePinRecord(entered)); // ترقية سجل قديم للصيغة الأقوى
      busy = false;
      return finish();
    }
    const fails = guard().fails + 1;
    await store.setMeta('pinGuard', { fails, until: fails >= LOCK_AFTER ? Date.now() + lockDelay(fails) : 0 });
    entered = '';
    busy = false;
    draw();
    if (waitMs() > 0) showWait();
    else msg.textContent = `رقم غير صحيح (${fails} من ${LOCK_AFTER} قبل الانتظار)`;
  };
  const press = (k) => {
    if (busy || waitMs() > 0) return;
    if (k === 'del') entered = entered.slice(0, -1);
    else if (entered.length < 8) entered += k;
    draw();
    // السجل الجديد يعرف طول الرقم فيتحقق عند اكتماله؛ القديم يتحقق من 4 أرقام فصاعداً دون احتساب المحاولات الناقصة
    if (pin.len ? entered.length === pin.len : entered.length === 8 || (entered.length >= 4 && pinMatches(pin, entered))) submit();
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  const pad = h('div', { class: 'keypad' }, keys.map((k) => (k === '' ? h('span', {}) : h('button', { type: 'button', text: k === 'del' ? '⌫' : k, 'aria-label': k === 'del' ? 'مسح' : k, onclick: () => press(k) }))));
  function onKey(e) {
    const d = normalizeDigits(e.key);
    if (/^\d$/.test(d)) press(d);
    else if (e.key === 'Backspace') press('del');
  }
  document.addEventListener('keydown', onKey);
  closeAllSheets();
  clear(root);
  root.append(h('div', { class: 'lock' }, h('div', { class: 'boot-logo', text: 'دفتر الخير' }), msg, dots, pad));
  draw();
  if (waitMs() > 0) showWait();
}

function startRouter() {
  render();
}

export function startApp(store) {
  root = document.getElementById('app');
  ctx.store = store;
  ctx.refresh = () => {
    if (!document.querySelector('.lock')) render();
  };
  store.subscribe(() => ctx.refresh());
  window.addEventListener('hashchange', () => {
    closeAllSheets();
    ctx.refresh();
  });
  const begin = () => startRouter();
  if (store.meta.pin) lockScreen(begin);
  else begin();
  // إعادة القفل بعد مدة في الخلفية
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lockedAt = Date.now();
    else if (store.meta.pin && lockedAt && Date.now() - lockedAt > RULES.pinLockMinutes * 60000 && !document.querySelector('.lock')) lockScreen(() => render());
  });
}
