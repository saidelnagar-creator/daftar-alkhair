// الاشتراكات الشهرية: المطلوب بنسخ زمنية، المسدَّد من بنود تخصيص الدفعات، والمتأخرات.
import { RULES } from '../config/rules.js';
import { activeMovements, cached, requiredAt, isWrittenOff } from './engine.js';
import { addMonths, monthsRange, ymOf, cmp } from './util.js';

// فهرس: لكل مشترك مجموع المسدَّد لكل شهر + دفعاته.
export function subscriberIndex(state) {
  return cached(state, 'subIndex', () => {
    const idx = new Map();
    for (const mv of activeMovements(state)) {
      if (mv.kind !== 'receipt' || mv.payer?.type !== 'subscriber') continue;
      let e = idx.get(mv.payer.id);
      if (!e) idx.set(mv.payer.id, (e = { paid: new Map(), receipts: [], total: 0, extra: 0, earmarked: 0 }));
      e.receipts.push(mv);
      e.total += mv.amount;
      for (const l of mv.lines) {
        if ((l.kind === 'sub' || l.kind === 'advance') && l.month) e.paid.set(l.month, (e.paid.get(l.month) || 0) + l.amount);
        else if (l.kind === 'earmark') e.earmarked += l.amount;
        else e.extra += l.amount;
      }
    }
    return idx;
  });
}

export function paidFor(state, subscriberId, month) {
  return subscriberIndex(state).get(subscriberId)?.paid.get(month) || 0;
}

// حالة شهر لمشترك:
// paid مسدد | partial مسدد جزئياً | due متأخر | upcoming لم يحن | advance مسدد مقدماً | writeoff لن يُسدد | none لا اشتراك
export function monthStatus(state, subscriberId, month, nowMonth) {
  const required = requiredAt(state, subscriberId, month);
  const paid = paidFor(state, subscriberId, month);
  const writtenOff = isWrittenOff(state, 'subscriber', subscriberId, month);
  let remaining = Math.max(0, required - paid);
  let status;
  if (required === 0 && paid === 0) status = 'none';
  else if (remaining === 0) status = month > nowMonth ? 'advance' : 'paid';
  else if (writtenOff) {
    status = 'writeoff';
  } else if (month > nowMonth) status = paid > 0 ? 'partial' : 'upcoming';
  else status = paid > 0 ? 'partial' : 'due';
  const writeoffAmount = status === 'writeoff' ? remaining : 0;
  if (status === 'writeoff') remaining = 0;
  return { month, required, paid, remaining, status, writeoffAmount };
}

export function firstMonthOf(state, subscriberId) {
  const s = state.subscribers.get(subscriberId);
  let first = s && s.versions.length ? s.versions[0].from : null;
  const idx = subscriberIndex(state).get(subscriberId);
  if (idx) for (const m of idx.paid.keys()) if (!first || m < first) first = m;
  return first;
}

export function subscriberMonths(state, subscriberId, from, to, nowMonth) {
  return monthsRange(from, to).map((m) => monthStatus(state, subscriberId, m, nowMonth));
}

// الشهور المتأخرة (المستحقة حتى asOf وغير المسددة كاملاً وغير المشطوبة).
export function arrearsFor(state, subscriberId, asOfMonth) {
  const first = firstMonthOf(state, subscriberId);
  if (!first || first > asOfMonth) return [];
  const out = [];
  for (const m of monthsRange(first, asOfMonth)) {
    const st = monthStatus(state, subscriberId, m, asOfMonth);
    if (st.remaining > 0) out.push(st);
  }
  return out;
}

export function allArrears(state, asOfMonth) {
  return cached(state, 'arrears:' + asOfMonth, () => {
    const out = [];
    for (const s of state.subscribers.values()) {
      const months = arrearsFor(state, s.id, asOfMonth);
      if (months.length) out.push({ subscriber: s, months, total: months.reduce((a, m) => a + m.remaining, 0) });
    }
    out.sort((a, b) => b.total - a.total || cmp(a.subscriber.name || '', b.subscriber.name || ''));
    return out;
  });
}

// ملخص مشترك لفترة: شهور مسددة / متبقية / مقدمة ومجاميع.
export function subscriberSummary(state, subscriberId, from, to, nowMonth) {
  const months = subscriberMonths(state, subscriberId, from, to, nowMonth);
  const s = { months, required: 0, paid: 0, remaining: 0, paidCount: 0, dueCount: 0, advanceCount: 0, writeoffCount: 0, writeoff: 0 };
  for (const m of months) {
    s.required += m.required;
    s.paid += m.paid;
    if (m.month <= nowMonth) s.remaining += m.remaining;
    if (m.status === 'paid') s.paidCount++;
    else if (m.status === 'advance') s.advanceCount++;
    else if (m.status === 'due' || (m.status === 'partial' && m.month <= nowMonth)) s.dueCount++;
    else if (m.status === 'writeoff') {
      s.writeoffCount++;
      s.writeoff += m.writeoffAmount;
    }
  }
  return s;
}

// القاعدة الافتراضية لتخصيص دفعة (قابلة للتعديل اليدوي قبل الحفظ):
// 1) المتأخرات الأقدم أولاً حتى شهر الدفع (ويُسمح بسداد جزئي لشهر)
// 2) الزائد مقدماً لشهور قادمة كاملة   3) ما يتبقى «زيادة عامة»
export function suggestAllocation(state, subscriberId, amount, date, policy = RULES.allocation) {
  const payMonth = ymOf(date);
  const lines = [];
  let left = amount;
  const first = firstMonthOf(state, subscriberId);
  const s = state.subscribers.get(subscriberId);
  if (s && s.versions.length && first && left > 0) {
    if (first <= payMonth) {
      for (const m of monthsRange(first, payMonth)) {
        if (left <= 0) break;
        const st = monthStatus(state, subscriberId, m, payMonth);
        if (st.remaining <= 0) continue;
        const a = Math.min(left, st.remaining);
        lines.push({ kind: 'sub', month: m, amount: a });
        left -= a;
      }
    }
    if (left > 0 && policy.excess === 'advance') {
      let m = payMonth;
      for (let i = 0; i < policy.maxAdvanceMonths && left > 0; i++) {
        m = addMonths(m, 1);
        const st = monthStatus(state, subscriberId, m, payMonth);
        if (st.required === 0 || st.remaining <= 0) continue;
        if (left >= st.remaining) {
          lines.push({ kind: 'advance', month: m, amount: st.remaining });
          left -= st.remaining;
        } else {
          if (policy.partialRemainder === 'advance') {
            lines.push({ kind: 'advance', month: m, amount: left });
            left = 0;
          }
          break;
        }
      }
    }
  }
  if (left > 0) lines.push({ kind: 'extra', month: payMonth, amount: left });
  return lines;
}

// المبلغ المقترح للدفعة المعتادة:
//   شهر واحد متأخر ⇒ المتبقي منه. أكثر من شهر ⇒ قيمة اشتراك شهر واحد (يسدد الأقدم أولاً).
//   لا متأخرات ⇒ اشتراك أول شهر قادم غير مسدد (مقدم).
export function suggestAmount(state, subscriberId, date) {
  const month = ymOf(date);
  const dues = arrearsFor(state, subscriberId, month);
  if (dues.length === 1) return dues[0].remaining;
  if (dues.length > 1) return requiredAt(state, subscriberId, month) || dues[0].remaining;
  for (let i = 1, m = addMonths(month, 1); i <= 12; i++, m = addMonths(m, 1)) {
    const st = monthStatus(state, subscriberId, m, month);
    if (st.remaining > 0) return st.remaining;
  }
  return requiredAt(state, subscriberId, month);
}
