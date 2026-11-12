// عناصر عرض مشتركة بين الشاشات.
import { h } from './dom.js';
import { ctx, F } from './ctx.js';
import { row, badge, list, empty } from './components.js';
import { describeMovement } from '../core/reports.js';

const uiState = new Map();
// حالة واجهة تبقى بين إعادة الرسم (فلاتر، بحث، سنة مختارة).
export function ui(key, defaults) {
  if (!uiState.has(key)) uiState.set(key, { ...defaults });
  return uiState.get(key);
}

export function movementRow(mv, { showBalance = null } = {}) {
  const d = describeMovement(ctx.state, mv);
  const signed = d.sign > 0 ? F.money(d.amount, { sign: true }) : d.sign < 0 ? F.money(-d.amount) : F.money(d.amount);
  return row({
    title: d.party ? `${d.title} — ${d.party}` : d.title,
    subtitle: [F.date(mv.date), mv.note].filter(Boolean).join(' · '),
    value: signed,
    valueClass: mv.voided ? '' : d.sign > 0 ? 'pos' : d.sign < 0 ? 'neg' : '',
    cls: mv.voided ? 'voided' : '',
    badge: mv.voided ? badge('ملغاة', 'bad') : null,
    end: showBalance !== null ? h('div', { class: 'subtitle num', text: `الرصيد ${F.money(showBalance)}` }) : null,
    onclick: () => ctx.nav(`#/movement/${mv.id}`),
  });
}

export function movementList(movs, { emptyText = 'لا توجد حركات', limit = 200 } = {}) {
  if (!movs.length) return empty(emptyText);
  const shown = movs.slice(0, limit);
  const el = list(shown.map((mv) => movementRow(mv)));
  if (movs.length > limit) el.append(h('div', { class: 'empty small', text: `يُعرض أحدث ${F.num(limit)} من ${F.num(movs.length)} — استخدم البحث أو الفلاتر للتضييق` }));
  return el;
}

// اختيار السنة: السنوات من أول سنة في الدفاتر حتى السنة القادمة.
export function yearChips(firstYear, value, onchange) {
  const years = [];
  const max = Math.max(new Date().getFullYear() + 1, value);
  for (let y = Math.min(firstYear, value); y <= max; y++) years.push(y);
  const el = h('div', { class: 'chips' });
  for (const y of years) el.append(h('button', { class: `chip ${y === value ? 'on' : ''}`, text: F.num(y), onclick: () => onchange(y) }));
  setTimeout(() => el.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' }), 0);
  return el;
}

export const collator = new Intl.Collator('ar', { numeric: true });
