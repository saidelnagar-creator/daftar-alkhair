// الأسر: ملف بنسخ زمنية، نقاط الاستحقاق الموحّدة، الاستحقاق الشهري، وما وصل/المتبقي لكل شهر.
import { RULES } from '../config/rules.js';
import { activeMovements, cached, profileAt, pointValueAt, isWrittenOff } from './engine.js';
import { addMonths, monthsRange, ymOf } from './util.js';

// النقاط = أفراد × perMember + درجة الاحتياج + الحالات + تعديل يدوي (الجدول من الإعدادات).
export function computePoints(criteria, profile) {
  if (!profile) return 0;
  let p = (profile.members || 0) * (criteria.perMember || 0);
  const lvl = (criteria.needLevels || []).find((l) => l.id === profile.needLevel);
  if (lvl) p += lvl.points;
  for (const f of profile.flags || []) {
    const fl = (criteria.flags || []).find((x) => x.id === f);
    if (fl) p += fl.points;
  }
  p += profile.pointsAdjust || 0;
  return Math.max(0, p);
}

export function suggestedMonthly(state, profile, month) {
  return computePoints(state.settings.criteria, profile) * pointValueAt(state, month);
}

// الاستحقاق الشهري: للأسر ذات «المساعدة الدائمة» فقط؛ المبلغ اليدوي إن وُجد وإلا المقترح من النقاط.
export function entitlementAt(state, familyId, month) {
  const p = profileAt(state, familyId, month);
  if (!p || p.status !== 'permanent') return 0;
  if (p.monthlyAmount !== null && p.monthlyAmount !== undefined) return p.monthlyAmount;
  return suggestedMonthly(state, p, month);
}

export function familyIndex(state) {
  return cached(state, 'famIndex', () => {
    const idx = new Map();
    for (const mv of activeMovements(state)) {
      if (mv.kind !== 'distribution' || !mv.familyId) continue;
      let e = idx.get(mv.familyId);
      if (!e) idx.set(mv.familyId, (e = { received: new Map(), inkind: new Set(), distributions: [], cash: 0, extra: 0, monthLines: 0 }));
      e.distributions.push(mv);
      e.cash += mv.amount;
      for (const l of mv.lines || []) {
        if (l.kind === 'entitlement' && l.month) {
          e.received.set(l.month, (e.received.get(l.month) || 0) + l.amount);
          e.monthLines++;
        } else e.extra += l.amount;
      }
      for (const m of mv.inkindMonths || []) e.inkind.add(m);
    }
    return idx;
  });
}

// حالة شهر لأسرة: delivered وصل | partial وصل جزئياً | due متبقي | upcoming لم يحن | advance وصل مقدماً | writeoff لن يُصرف | none
export function familyMonthStatus(state, familyId, month, nowMonth) {
  const entitled = entitlementAt(state, familyId, month);
  const e = familyIndex(state).get(familyId);
  const received = e?.received.get(month) || 0;
  const inkind = !!e?.inkind.has(month);
  let remaining = inkind ? 0 : Math.max(0, entitled - received);
  let status;
  if (entitled === 0 && received === 0 && !inkind) status = 'none';
  else if (remaining === 0) status = month > nowMonth ? 'advance' : 'delivered';
  else if (isWrittenOff(state, 'family', familyId, month)) status = 'writeoff';
  else if (month > nowMonth) status = received > 0 ? 'partial' : 'upcoming';
  else status = received > 0 ? 'partial' : 'due';
  const writeoffAmount = status === 'writeoff' ? remaining : 0;
  if (status === 'writeoff') remaining = 0;
  return { month, entitled, received, inkind, remaining, status, writeoffAmount };
}

export function familyFirstMonth(state, familyId) {
  const f = state.families.get(familyId);
  let first = f && f.profiles.length ? f.profiles[0].from : null;
  const e = familyIndex(state).get(familyId);
  if (e) for (const m of e.received.keys()) if (!first || m < first) first = m;
  return first;
}

export function familyMonths(state, familyId, from, to, nowMonth) {
  return monthsRange(from, to).map((m) => familyMonthStatus(state, familyId, m, nowMonth));
}

export function familyDues(state, familyId, asOfMonth) {
  const first = familyFirstMonth(state, familyId);
  if (!first || first > asOfMonth) return [];
  const out = [];
  for (const m of monthsRange(first, asOfMonth)) {
    const st = familyMonthStatus(state, familyId, m, asOfMonth);
    if (st.remaining > 0) out.push(st);
  }
  return out;
}

export function allFamilyDues(state, asOfMonth) {
  return cached(state, 'famDues:' + asOfMonth, () => {
    const out = [];
    for (const f of state.families.values()) {
      const months = familyDues(state, f.id, asOfMonth);
      if (months.length) out.push({ family: f, months, total: months.reduce((a, m) => a + m.remaining, 0) });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  });
}

// تخصيص افتراضي للصرف: شهور الاستحقاق الأقدم أولاً، ثم مقدماً لشهور كاملة، والباقي «إضافة عامة».
export function suggestFamilyAllocation(state, familyId, amount, date, policy = RULES.familyAllocation) {
  const payMonth = ymOf(date);
  const lines = [];
  let left = amount;
  const first = familyFirstMonth(state, familyId);
  if (first && left > 0) {
    if (first <= payMonth) {
      for (const m of monthsRange(first, payMonth)) {
        if (left <= 0) break;
        const st = familyMonthStatus(state, familyId, m, payMonth);
        if (st.remaining <= 0) continue;
        const a = Math.min(left, st.remaining);
        lines.push({ kind: 'entitlement', month: m, amount: a });
        left -= a;
      }
    }
    if (left > 0 && policy.excess === 'advance') {
      let m = payMonth;
      for (let i = 0; i < policy.maxAdvanceMonths && left > 0; i++) {
        m = addMonths(m, 1);
        const st = familyMonthStatus(state, familyId, m, payMonth);
        if (st.entitled === 0 || st.remaining <= 0) continue;
        if (left >= st.remaining) {
          lines.push({ kind: 'entitlement', month: m, amount: st.remaining });
          left -= st.remaining;
        } else {
          if (policy.partialRemainder === 'advance') {
            lines.push({ kind: 'entitlement', month: m, amount: left });
            left = 0;
          }
          break;
        }
      }
    }
  }
  if (left > 0) lines.push({ kind: 'extra', amount: left });
  return lines;
}

// المبلغ المقترح: المتبقي حتى الشهر الحالي، وإلا استحقاق الشهر القادم غير المصروف.
export function suggestFamilyAmount(state, familyId, date) {
  const month = ymOf(date);
  const due = familyDues(state, familyId, month).reduce((a, m) => a + m.remaining, 0);
  if (due > 0) return due;
  for (let i = 1, m = addMonths(month, 1); i <= 12; i++, m = addMonths(m, 1)) {
    const st = familyMonthStatus(state, familyId, m, month);
    if (st.remaining > 0) return st.remaining;
  }
  return 0;
}

export function familySummary(state, familyId, from, to, nowMonth) {
  const months = familyMonths(state, familyId, from, to, nowMonth);
  const s = { months, entitled: 0, received: 0, remaining: 0, deliveredCount: 0, dueCount: 0, advanceCount: 0 };
  for (const m of months) {
    s.entitled += m.entitled;
    s.received += m.received;
    if (m.month <= nowMonth) s.remaining += m.remaining;
    if (m.status === 'delivered') s.deliveredCount++;
    else if (m.status === 'advance') s.advanceCount++;
    else if (m.status === 'due' || (m.status === 'partial' && m.month <= nowMonth)) s.dueCount++;
  }
  return s;
}
