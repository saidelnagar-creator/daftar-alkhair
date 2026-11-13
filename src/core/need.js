// حاسبة الاحتياج داخل الدفتر: ربط المحرك الخالص (need-engine.js) بالحالة والأحداث.
// المحرك يعمل بالجنيه الصحيح؛ التحويل من/إلى تمثيل المبالغ الداخلي (أعشار الجنيه) يتم هنا فقط.
// الحاسبة استشارية: لا تنشئ حركة مالية، ولا يتغير مبلغ أسرة إلا باعتماد صريح (approveAssessment).
import { ZAKAT_LIKE } from '../config/defaults.js';
import { acctFund, activeMovements, cached, needConfigAt, profileAt } from './engine.js';
import { MONEY, roundToStep } from './money.js';
import { ENGINE_VERSION, CATEGORY_LABELS, assess, allocate, classifyDebt, assessOneOff, pointsOf, ageOf } from './need-engine.js';
import { cmp, ymOf } from './util.js';

export { ENGINE_VERSION as NEED_ENGINE_VERSION, CATEGORY_LABELS as NEED_CATEGORY_LABELS, assess as needAssess, allocate as needAllocate, classifyDebt, assessOneOff, pointsOf as needPointsOf, ageOf as needAgeOf };

export const poundsToUnits = (pounds) => pounds * MONEY;
export const unitsToPounds = (units) => Math.round(units / MONEY);

// فئة الحاسبة ← درجة الاحتياج في ملف الأسرة.
export const NEED_LEVEL_OF = Object.freeze({ severe: 'high', needy: 'medium', partial: 'low' });
// أحداث تحمل تفاصيل حساسة (صحة وسلوك ودخل): تُستبعد من «نسخة بلا تفاصيل التقييم» ومن التقارير العامة.
export const NEED_SENSITIVE_EVENTS = Object.freeze(['need.assessment.save', 'need.file.upsert']);
export const redactNeedEvents = (events) => events.filter((e) => !NEED_SENSITIVE_EVENTS.includes(e.type));

export function nextNeedConfigVersion(state) {
  return (state.needConfigs || []).reduce((a, c) => Math.max(a, c.version), 0) + 1;
}

// تشغيل الحاسبة على مدخلات بنسخة الإعداد السارية في شهر التقييم.
export function runAssessment(state, input, { config = null } = {}) {
  const ver = needConfigAt(state, input.evalDate);
  const result = assess(input, config || ver.config);
  return { result, configVersion: config ? null : ver.version, engineVersion: ENGINE_VERSION };
}

export function familyAssessments(state, familyId) {
  return cached(state, 'needFam:' + familyId, () => [...state.assessments.values()].filter((a) => a.familyId === familyId).sort((a, b) => cmp(b.date, a.date) || cmp(b.ts, a.ts)));
}

// التقييم المعتمد الساري لأسرة (الأحدث)، أو null.
export function currentAssessment(state, familyId) {
  return familyAssessments(state, familyId).find((a) => a.status === 'approved') || null;
}

// فئات الأسرة المشتقة من المدخلات (من الفئات الافتراضية الموجودة فقط).
export function categoriesFromInput(state, input) {
  const cfg = needConfigAt(state, input.evalDate).config;
  const out = [];
  const present = (input.members || []).filter((m) => !m.absent);
  const age = (m) => ageOf(m, input.evalDate);
  if (present.some((m) => m.orphan && age(m) < cfg.ages.orphanBelow)) out.push('c-orphans');
  if ((input.household || {}).maritalCase === 'widow') out.push('c-widows');
  if (present.some((m) => (m.chronic || []).length > 0 || m.able === false)) out.push('c-sick');
  if (present.some((m) => m.study && m.study !== 'none')) out.push('c-students');
  if (present.some((m) => age(m) >= cfg.ages.elder)) out.push('c-elderly');
  return out.filter((c) => state.lists.familyCategories.has(c));
}
const DERIVED_CATEGORIES = ['c-orphans', 'c-widows', 'c-sick', 'c-students', 'c-elderly'];

// ملف الأسرة الناتج عن اعتماد تقييم: يحافظ على ما لا تعرفه الحاسبة (الرغبة، الحالات، التعديل اليدوي للنقاط، الفئات المضافة يدوياً).
// monthly: المبلغ المعتمد بأعشار الجنيه، أو null لترك المبلغ كما هو.
export function profileFromAssessment(state, assessment, { monthly = null, from } = {}) {
  const fam = state.families.get(assessment.familyId);
  const cur = profileAt(state, assessment.familyId, from) || (fam && fam.profiles[fam.profiles.length - 1]) || {};
  const { from: _f, ...base } = cur;
  const present = (assessment.input.members || []).filter((m) => !m.absent);
  const kept = (base.categories || []).filter((c) => !DERIVED_CATEGORIES.includes(c));
  const profile = {
    ...base,
    members: present.length,
    needLevel: NEED_LEVEL_OF[assessment.result.category] || null,
    categories: [...new Set([...kept, ...categoriesFromInput(state, assessment.input)])],
    status: base.status || 'occasional',
  };
  if (monthly !== null && monthly !== undefined) {
    profile.monthlyAmount = monthly;
    if (monthly > 0) profile.status = 'permanent';
  }
  return profile;
}

// حدثا الاعتماد: التقييم المعتمد ثم ملف الأسرة من شهر السريان. يُنفَّذان ككتلة واحدة عبر store.run.
// decision: { monthly (أعشار الجنيه | null = لا تغيّر المبلغ), appliedFrom (YYYY-MM), estimate (جنيه), note }
export function approveAssessment(book, draft, decision, { now = new Date() } = {}) {
  const coveragePct = decision.monthly !== null && decision.monthly !== undefined && draft.result.monthly.amount > 0 ? Math.round((100 * unitsToPounds(decision.monthly)) / draft.result.monthly.amount) : null;
  const approved = {
    ...draft,
    status: 'approved',
    appliedFrom: decision.appliedFrom,
    committee: { estimate: decision.estimate ?? null, monthly: decision.monthly ?? null, coveragePct, note: decision.note || '' },
  };
  delete approved.ts;
  delete approved.createdAt;
  book.dispatch('need.assessment.save', approved, { now });
  book.dispatch('family.profile.set', { familyId: draft.familyId, from: decision.appliedFrom, profile: profileFromAssessment(book.state, approved, { monthly: decision.monthly ?? null, from: decision.appliedFrom }), assessmentId: draft.id }, { now });
  return approved;
}

// الفرق بين تقدير اللجنة ونتيجة الحاسبة (بالنسبة المئوية من نتيجة الحاسبة)؛ > 20% علامة لمراجعة الأوزان.
export function estimateGapPct(result, estimatePounds) {
  if (estimatePounds === null || estimatePounds === undefined) return null;
  const base = result.monthly.amount;
  if (base === 0) return estimatePounds === 0 ? 0 : 100;
  return Math.round((100 * Math.abs(estimatePounds - base)) / base);
}

// مراجعات مستحقة: أسر تقييمها المعتمد الساري حلّ موعد مراجعته أو فات.
export function dueReviews(state, nowMonth) {
  return cached(state, 'needReviews:' + nowMonth, () => {
    const out = [];
    for (const f of state.families.values()) {
      if (f.archived) continue;
      const a = currentAssessment(state, f.id);
      if (a && a.result.reviewBy && a.result.reviewBy <= nowMonth) out.push({ family: f, assessment: a, reviewBy: a.result.reviewBy });
    }
    return out.sort((x, y) => cmp(x.reviewBy, y.reviewBy));
  });
}

// مقارنة تقييمين (الأقدم a والأحدث b): صفوف [البند، قيمة a، قيمة b].
export function compareAssessments(a, b) {
  const r = (x) => x.result;
  const rows = [
    ['الاحتياج N', r(a).N, r(b).N, 'egp'],
    ['الدخل المعترف به I', r(a).I, r(b).I, 'egp'],
    ['العجز G', r(a).G, r(b).G, 'egp'],
    ['نسبة العجز %', r(a).gPct, r(b).gPct, 'num'],
    ['الفئة', r(a).categoryLabel, r(b).categoryLabel, 'text'],
    ['المبلغ الشهري المستحق', r(a).monthly.amount, r(b).monthly.amount, 'egp'],
    ['وزن الأولوية', r(a).w10 / 10, r(b).w10 / 10, 'num'],
    ['نقاط الأولوية', r(a).points.priority, r(b).points.priority, 'num'],
    ['عدد الأفراد المحسوبين', r(a).need.members.length, r(b).need.members.length, 'num'],
    ['المبلغ المعتمد من اللجنة', a.committee?.monthly ?? null, b.committee?.monthly ?? null, 'units'],
    ['نسبة التغطية المعتمدة %', a.committee?.coveragePct ?? null, b.committee?.coveragePct ?? null, 'num'],
  ];
  const flagsA = new Set(r(a).flags);
  const flagsB = new Set(r(b).flags);
  return { rows, flagsAdded: [...flagsB].filter((f) => !flagsA.has(f)), flagsRemoved: [...flagsA].filter((f) => !flagsB.has(f)) };
}

// اقتراح توزيع الشهر بميزانيتين (بالجنيه): الزكاة أولاً على المؤهلين لها، ثم الصدقة على ما بقي من عجز الجميع.
export function proposeMonthAllocation(state, { zakat = 0, sadaqa = 0, roundTo = 1, tierPriority = true } = {}) {
  const fams = [];
  for (const f of state.families.values()) {
    if (f.archived) continue;
    const a = currentAssessment(state, f.id);
    if (!a || a.result.category === 'sufficient' || !(a.result.monthly.amount > 0)) continue;
    fams.push({ id: f.id, name: f.name, category: a.result.category, source: a.result.monthly.source, amount: a.result.monthly.amount, w10: a.result.w10, priority: a.result.points.priority, mode: a.result.monthly.mode });
  }
  const opts = { roundTo, tierPriority };
  const z = allocate(zakat, fams.filter((f) => f.source === 'zakat' || f.source === 'zakat-or-sadaqa'), opts);
  const zBy = new Map(z.rows.map((r) => [r.id, r.allocated]));
  const s = allocate(sadaqa, fams.map((f) => ({ ...f, amount: f.amount - (zBy.get(f.id) || 0) })), opts);
  const sBy = new Map(s.rows.map((r) => [r.id, r.allocated]));
  const rows = fams
    .map((f) => {
      const zk = zBy.get(f.id) || 0;
      const sd = sBy.get(f.id) || 0;
      return { ...f, due: f.amount, zakat: zk, sadaqa: sd, total: zk + sd, coveredPct: Math.round((100 * (zk + sd)) / f.amount) };
    })
    .sort((x, y) => y.priority - x.priority || cmp(x.name, y.name));
  const due = rows.reduce((t, r) => t + r.due, 0);
  const total = rows.reduce((t, r) => t + r.total, 0);
  return { rows, due, total, zakatUsed: z.allocated, sadaqaUsed: s.allocated, zakatLeft: z.unallocated, sadaqaLeft: s.unallocated, coveredPct: due ? Math.round((100 * total) / due) : 0 };
}

// عند نسخة إعداد جديدة: إعادة حساب التقييمات السارية وعرض من تتغير فئته أو مبلغه — دون تغيير أي مبلغ معتمد.
export function recalcWithConfig(state, config) {
  const out = [];
  for (const f of state.families.values()) {
    if (f.archived) continue;
    const a = currentAssessment(state, f.id);
    if (!a) continue;
    let after;
    try {
      after = assess(a.input, config);
    } catch (e) {
      out.push({ family: f, error: e.message, before: a.result, after: null, categoryChanged: false, amountChanged: false });
      continue;
    }
    const categoryChanged = after.category !== a.result.category;
    const amountChanged = after.monthly.amount !== a.result.monthly.amount;
    if (categoryChanged || amountChanged) out.push({ family: f, before: a.result, after, categoryChanged, amountChanged });
  }
  return out.sort((x, y) => Number(y.categoryChanged) - Number(x.categoryChanged) || cmp(x.family.name, y.family.name));
}

// نوع المال لحركة صرف: من غرض أي بند، أو من الصندوق المصروف منه.
export function distributionMoneyTypes(state, mv) {
  const types = new Set();
  for (const l of mv.lines || []) {
    const t = l.purposeId && state.lists.purposes.get(l.purposeId)?.moneyType;
    if (t) types.add(t);
  }
  const fund = mv.acct && state.lists.funds.get(acctFund(mv.acct));
  if (fund?.moneyType) types.add(fund.moneyType);
  return [...types];
}

// تنبيهات شاشة الصرف (لا تمنع الحفظ): زكاة لمن لا تحل له، أو تجاوز مصروف الشهر للمبلغ المستحق في التقييم المعتمد.
export function distributionWarnings(state, mv) {
  const out = [];
  if (!mv.familyId) return out;
  const a = currentAssessment(state, mv.familyId);
  if (!a) return out;
  const zakat = distributionMoneyTypes(state, mv).some((t) => ZAKAT_LIKE.includes(t));
  if (zakat && a.result.category === 'sufficient') out.push({ code: 'zakat-sufficient', text: 'المصدر زكاة والأسرة في آخر تقييم معتمد «مكتفٍ لا يُعطى» — الزكاة لا تُصرف لها.' });
  else if (zakat && a.result.monthly.source === 'sadaqa-only') out.push({ code: 'zakat-sadaqa-only', text: 'المصدر زكاة والأسرة في آخر تقييم معتمد «صدقة تطوع فقط» — اصرف من مال الصدقة.' });
  if (mv.amount > 0 && mv.date) {
    const month = ymOf(mv.date);
    let spent = 0;
    for (const m of activeMovements(state)) if (m.kind === 'distribution' && m.familyId === mv.familyId && ymOf(m.date) === month && m.id !== mv.replaces && m.id !== mv.id) spent += m.amount;
    const cap = poundsToUnits(a.result.monthly.amount);
    if (spent + mv.amount > cap) out.push({ code: 'over-gap', text: 'مصروف هذا الشهر للأسرة يتجاوز العجز المعتمد في آخر تقييم.', spent: spent + mv.amount, cap });
  }
  return out;
}

// المبلغ الشهري المقترح للاعتماد بأعشار الجنيه (مقرَّباً بخطوة الدقة السارية)، بنسبة تغطية اختيارية.
export function suggestedApprovedMonthly(result, step, coveragePct = 100) {
  return roundToStep((poundsToUnits(result.monthly.amount) * coveragePct) / 100, step);
}
