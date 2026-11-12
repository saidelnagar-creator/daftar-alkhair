// مكوّنات الواجهة المشتركة: نافذة سفلية، تأكيد، إشعار، حقول، قوائم اختيار، شبكة شهور.
import { h, icon, clear } from './dom.js';
import { ctx, F } from './ctx.js';
import { parseAssetQty, parseMoney, parseQty, MONEY, QTY, ASSET } from '../core/money.js';
import { addMonths, monthsRange } from '../core/util.js';

// ---------- إشعار ----------
let toastTimer = null;
export function toast(message, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h('div', { class: `toast ${kind}`, role: 'status', text: message });
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), kind === 'bad' ? 4500 : 2200);
}

// ---------- نافذة سفلية ----------
const openSheets = [];
export function openSheet(title, build, { onClose = null } = {}) {
  const body = h('div', { class: 'sheet-body' });
  const backdrop = h('div', { class: 'sheet-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = (result) => {
    const i = openSheets.indexOf(entry);
    if (i < 0) return;
    openSheets.splice(i, 1);
    backdrop.remove();
    if (onClose) onClose(result);
  };
  const entry = { close };
  const sheet = h('div', { class: 'sheet' }, h('div', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', 'aria-label': 'إغلاق', onclick: () => close() }, icon('close'))), body);
  backdrop.append(sheet);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  openSheets.push(entry);
  build(body, close);
  return close;
}

export function closeAllSheets() {
  while (openSheets.length) openSheets[openSheets.length - 1].close();
}

// ---------- تأكيد (مع حقل نص اختياري) ----------
export function confirmDialog({ title, message = '', okText = 'تأكيد', cancelText = 'رجوع', danger = false, input = null }) {
  return new Promise((resolve) => {
    let field = null;
    const err = h('div', { class: 'form-error', style: { display: 'none' } });
    const done = (v) => {
      backdrop.remove();
      resolve(v);
    };
    const ok = () => {
      if (input) {
        const v = field.value.trim();
        if (input.required && !v) {
          err.textContent = input.requiredMessage || 'هذا الحقل مطلوب';
          err.style.display = '';
          return;
        }
        done(v || true);
      } else done(true);
    };
    const dialog = h(
      'div',
      { class: 'dialog' },
      h('h2', { text: title }),
      message ? h('p', { text: message }) : null,
      err,
      input ? h('div', { class: 'field' }, h('label', { text: input.label }), (field = h('input', { type: 'text', value: input.value || '', placeholder: input.placeholder || '' }))) : null,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', text: cancelText, onclick: () => done(false) }), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: okText, onclick: ok })),
    );
    const backdrop = h('div', { class: 'sheet-backdrop', role: 'alertdialog', 'aria-modal': 'true' }, dialog);
    document.body.append(backdrop);
    if (field) field.focus();
  });
}

// ---------- حقول ----------
let fieldSeq = 0;
// حقل بعنوان مرتبط بعنصر الإدخال (for/id) لقارئات الشاشة والاختبارات.
export function field(label, control, hint = '') {
  const lab = h('label', { text: label });
  const input = control.matches?.('input,select,textarea') ? control : control.querySelector?.('input,select,textarea');
  if (input) {
    if (!input.id) input.id = `fld-${++fieldSeq}`;
    lab.htmlFor = input.id;
  }
  return h('div', { class: 'field' }, lab, control, hint ? h('div', { class: 'hint', text: hint }) : null);
}

const plain = (units, scale) => {
  if (units === null || units === undefined || units === '') return '';
  const neg = units < 0;
  const abs = Math.abs(units);
  const fp = abs % scale;
  const decimals = String(scale).length - 1;
  return (neg ? '-' : '') + Math.floor(abs / scale) + (fp ? '.' + String(fp).padStart(decimals, '0').replace(/0+$/, '') : '');
};

function numericInput(value, scale, parse, cls = '') {
  const el = h('input', { type: 'text', inputMode: scale === MONEY && ctx.store && ctx.precision().money === 0 ? 'numeric' : 'decimal', autocomplete: 'off', class: cls, value: plain(value, scale), enterKeyHint: 'done' });
  el.addEventListener('focus', () => setTimeout(() => el.select(), 0));
  el.units = () => (el.value.trim() === '' ? null : parse(el.value));
  el.setUnits = (u) => {
    el.value = plain(u, scale);
  };
  return el;
}
export const moneyInput = (value = null, cls = 'money') => numericInput(value, MONEY, (v) => parseMoney(v, ctx.precision().money), cls);
export const qtyInput = (value = null) => numericInput(value, QTY, (v) => parseQty(v, ctx.precision().qty));
export const assetQtyInput = (value = null) => numericInput(value, ASSET, (v) => parseAssetQty(v, ctx.precision().asset));
export const intInput = (value = '') => h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', value: value ?? '' });
export const textInput = (value = '', placeholder = '') => h('input', { type: 'text', value: value || '', placeholder, autocomplete: 'off' });
export const textArea = (value = '', placeholder = '') => h('textarea', { rows: 2, placeholder }, value || '');
export const dateInput = (value) => h('input', { type: 'date', value: value || ctx.today() });

export function selectInput(options, value = '', { placeholder = null } = {}) {
  const el = h('select', {});
  if (placeholder !== null) el.append(h('option', { value: '', text: placeholder }));
  for (const o of options) {
    if (o.group) {
      const g = h('optgroup', { label: o.group });
      for (const x of o.options) g.append(h('option', { value: x.value, text: x.label }));
      el.append(g);
    } else el.append(h('option', { value: o.value, text: o.label }));
  }
  el.value = value ?? '';
  if (el.selectedIndex < 0) el.selectedIndex = 0;
  return el;
}

// قائمة شهور للاختيار (من/إلى) بترتيب تنازلي أو تصاعدي.
export function monthOptions(from, to) {
  return monthsRange(from, to).map((m) => ({ value: m, label: F.month(m) }));
}
export function monthSelect(value, { back = 36, ahead = 24 } = {}) {
  const now = ctx.nowMonth();
  let from = addMonths(now, -back);
  let to = addMonths(now, ahead);
  if (value && value < from) from = value;
  if (value && value > to) to = value;
  return selectInput(monthOptions(from, to), value || now);
}

export function checkbox(label, checked = false) {
  const input = h('input', { type: 'checkbox', checked });
  const el = h('label', { class: 'check' }, input, label);
  el.input = input;
  return el;
}

export function errorBox() {
  const el = h('div', { class: 'form-error', style: { display: 'none' }, role: 'alert' });
  el.show = (msg) => {
    el.textContent = msg;
    el.style.display = msg ? '' : 'none';
    if (msg) el.scrollIntoView({ block: 'nearest' });
  };
  return el;
}

// ---------- عناصر العرض ----------
export function row({ title, subtitle = '', value = '', valueClass = '', badge = null, onclick = null, cls = '', end = null }) {
  return h(
    onclick ? 'button' : 'div',
    { class: `row ${cls}`, onclick },
    h('div', { class: 'main' }, h('div', { class: 'title', text: title }), subtitle ? h('div', { class: 'subtitle', text: subtitle }) : null),
    h('div', { class: 'end' }, value !== '' ? h('div', { class: `value num ${valueClass}`, text: value }) : null, badge, end),
  );
}

export const badge = (text, kind = '') => h('span', { class: `badge ${kind}`, text });
export const empty = (text) => h('div', { class: 'empty', text });
export const list = (...rows) => h('div', { class: 'list' }, rows);
export const sectionTitle = (text, action = null) => h('div', { class: 'section-title' }, h('span', { text }), action);
export const kv = (k, v, cls = '') => h('div', { class: 'kv' }, h('span', { class: 'k', text: k }), h('span', { class: `v ${cls}` }, v));

export function stat(label, value, { hint = '', cls = '', onclick = null, valueClass = '' } = {}) {
  return h(onclick ? 'button' : 'div', { class: `stat ${cls}`, onclick }, h('div', { class: 'label', text: label }), h('div', { class: `value num ${valueClass}`, text: value }), hint ? h('div', { class: 'hint', text: hint }) : null);
}

export function chips(options, value, onchange) {
  const el = h('div', { class: 'chips', role: 'tablist' });
  const render = (v) => {
    clear(el);
    for (const o of options) el.append(h('button', { class: `chip ${o.value === v ? 'on' : ''}`, text: o.label, role: 'tab', 'aria-selected': o.value === v, onclick: () => (render(o.value), onchange(o.value)) }));
  };
  render(value);
  return el;
}

// قائمة اختيار ببحث (للمشتركين والأسر...): تعيد المعرّف المختار أو null.
export function pickFromList({ title, items, placeholder = 'بحث بالاسم…', emptyText = 'لا يوجد' }) {
  return new Promise((resolve) => {
    let picked = null;
    openSheet(
      title,
      (body, close) => {
        const search = h('input', { class: 'search', type: 'search', placeholder, 'aria-label': 'بحث' });
        const box = h('div', {});
        const render = () => {
          const q = search.value.trim().toLowerCase();
          const shown = items.filter((it) => !q || `${it.title} ${it.subtitle || ''}`.toLowerCase().includes(q)).slice(0, 200);
          clear(box);
          if (!shown.length) box.append(empty(emptyText));
          else
            box.append(
              list(
                shown.map((it) =>
                  row({
                    title: it.title,
                    subtitle: it.subtitle,
                    value: it.value || '',
                    valueClass: it.valueClass || '',
                    badge: it.badge || null,
                    onclick: () => {
                      picked = it.id;
                      close();
                    },
                  }),
                ),
              ),
            );
        };
        search.addEventListener('input', render);
        body.append(search, box);
        render();
      },
      { onClose: () => resolve(picked) },
    );
  });
}

const STATUS_LABEL = { paid: 'مسدد', delivered: 'وصل', advance: 'مقدم', due: 'متبقي', partial: 'جزئي', writeoff: 'لن يُسدد', upcoming: 'لم يحن', none: '—' };

// شبكة الشهور: لكل شهر حالته ومبلغه. months من subscriberMonths/familyMonths.
export function monthGrid(months, { onTap = null, amountOf = (m) => (m.remaining > 0 ? m.remaining : m.paid ?? m.received ?? 0) } = {}) {
  return h(
    'div',
    { class: 'months' },
    months.map((m) =>
      h(
        onTap ? 'button' : 'div',
        { class: `month ${m.status}`, onclick: onTap ? () => onTap(m) : null, 'aria-label': `${F.month(m.month)}: ${STATUS_LABEL[m.status]}` },
        h('div', { class: 'm', text: F.monthShort(m.month) }),
        h('div', { class: 'a num', text: m.status === 'none' ? '' : F.money(amountOf(m)) }),
        h('div', { class: 's', text: STATUS_LABEL[m.status] }),
      ),
    ),
  );
}

export function monthLegend(kind = 'subscriber') {
  const paid = kind === 'family' ? ['delivered', 'وصل'] : ['paid', 'مسدد'];
  return h('div', { class: 'legend' }, badge(paid[1], 'ok'), badge('مقدم', 'info'), badge('جزئي', 'warn'), badge('متبقي', 'bad'), badge('لم يحن'));
}

// جدول تقرير بسيط: columns [{label, num?}] و rows مصفوفات نصوص.
export function table(columns, rows, { totalRow = null } = {}) {
  const t = h('table', { class: 'report' });
  t.append(h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'n' : '', text: c.label })))));
  const tb = h('tbody', {});
  for (const r of rows) tb.append(h('tr', {}, r.map((cell, i) => h('td', { class: columns[i].num ? 'n num' : '', text: cell }))));
  if (totalRow) tb.append(h('tr', { class: 'total' }, totalRow.map((cell, i) => h('td', { class: columns[i].num ? 'n num' : '', text: cell }))));
  t.append(tb);
  return h('div', { class: 'table-wrap' }, t);
}

// حفظ ملف على الجهاز: مشاركة iOS إن أمكن، وإلا تنزيل عادي.
export async function saveFile(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
  return 'downloaded';
}
