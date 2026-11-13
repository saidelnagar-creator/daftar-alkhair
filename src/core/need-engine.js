// محرك حاسبة الاحتياج — منقول كما هو من المحرك المرجعي (docs/NEED_CALCULATOR_SPEC.md). لا تغيّر الحساب:
// أي تعديل يجب أن يُبقي حالات tests/fixtures/need-vectors.json كلها مطابقة. دوال خالصة، أعداد صحيحة بالجنيه.
// التحويل من/إلى تمثيل المبالغ الداخلي (أعشار الجنيه) يتم في need.js عند الحدود فقط.

export const ENGINE_VERSION = '1.0.0';

/* ───────────── أدوات التاريخ والعمر ───────────── */

function ymIndex(s) {
  const [y, m] = String(s).split('-').map(Number);
  if (!Number.isInteger(y)) throw new Error('تاريخ غير صالح: ' + s);
  return y * 12 + ((m || 1) - 1);
}
function ymString(i) {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
export function addMonths(s, n) { return ymString(ymIndex(s) + n); }
export function monthsBetween(from, to) { return ymIndex(to) - ymIndex(from); }

export function ageOf(member, evalDate) {
  if (member.birth) return Math.floor((ymIndex(evalDate) - ymIndex(member.birth)) / 12);
  if (Number.isInteger(member.age)) return member.age;
  throw new Error('الفرد بلا عمر ولا تاريخ ميلاد: ' + (member.id ?? '?'));
}

/* ───────────── اختيار قيمة البند (ب4-1) ───────────── */
// كل بند = قص(الفعلي، الأدنى، الأعلى). بلا فعلي ← المعتاد.
// البنود ذات belowMin:"actual" (الإيجار والدواء) تؤخذ قيمتها الفعلية تحت الحد الأدنى ولا تُرفع.

function pick(cfg, key, actual) {
  const it = cfg.items[key];
  if (!it) throw new Error('بند غير معرّف في الإعداد: ' + key);
  if (actual == null) return { key, label: it.label, value: it.typ, basis: 'typ', excess: 0 };
  if (actual > it.max) return { key, label: it.label, value: it.max, basis: 'capped', excess: actual - it.max };
  if (actual < it.min) {
    return it.belowMin === 'actual'
      ? { key, label: it.label, value: Math.max(0, actual), basis: 'actual', excess: 0 }
      : { key, label: it.label, value: it.min, basis: 'raised', excess: 0 };
  }
  return { key, label: it.label, value: actual, basis: 'actual', excess: 0 };
}

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const pct = (value, percent) => Math.round((value * percent) / 100);

/* ───────────── احتياج الفرد (ب2) ───────────── */

function memberItems(m, age, cfg) {
  const A = cfg.ages;
  const a = m.actual || {};
  const items = [];

  const band = age <= A.food0_5Max ? 'food_0_5'
    : age <= A.food6_11Max ? 'food_6_11'
    : age <= A.food12_17Max ? 'food_12_17' : 'food_adult';
  items.push(pick(cfg, band, a.food));

  if (age <= A.smallChildClothingMax && a.clothing == null) {
    items.push({ key: 'clothing', label: cfg.items.clothing.label, value: cfg.smallChildClothing, basis: 'small-child', excess: 0 });
  } else items.push(pick(cfg, 'clothing', a.clothing));

  items.push(pick(cfg, 'hygiene', a.hygiene));
  items.push(pick(cfg, 'health', a.health));

  const study = m.study && m.study !== 'none' ? m.study : null;
  if (study) {
    const key = 'edu_' + study;
    const nonSerious = m.serious === false && age >= A.adult;           // أ9: غير الجاد ← تكلفة دنيا
    if (nonSerious) {
      const v = Math.min(cfg.student.nonSeriousCost, cfg.items[key].typ);
      items.push({ key, label: cfg.items[key].label, value: v, basis: 'non-serious', excess: 0 });
    } else items.push(pick(cfg, key, a.education));
  }

  for (const raw of m.chronic || []) {
    const c = typeof raw === 'string' ? { type: raw } : raw;
    if (c.covered) {                                                    // علاج على نفقة الدولة/التأمين ← صفر
      items.push({ key: 'chronic_' + c.type, label: c.label || cfg.items['chronic_' + c.type]?.label || 'مرض مزمن', value: 0, basis: 'covered', excess: 0 });
    } else if (c.type === 'other') {
      const actual = c.actual || 0;
      const v = Math.min(actual, cfg.chronicOtherMax);
      items.push({ key: 'chronic_other', label: c.label || 'مرض مزمن آخر', value: v, basis: actual > v ? 'capped' : 'actual', excess: actual - v });
    } else items.push(pick(cfg, 'chronic_' + c.type, c.actual));
  }

  if (m.formula) items.push(pick(cfg, 'formula', a.formula));
  if (m.diapers) items.push(pick(cfg, 'diapers', a.diapers));
  return items;
}

/* ───────────── ثابت الأسرة (ب2) ───────────── */

function fixedItems(hh, residents, cfg) {
  const a = hh.actual || {};
  const housing = hh.housing || 'owned';
  const share = hh.fixedShare > 0 && hh.fixedShare < 1 ? hh.fixedShare : 1;
  const shared = new Set(cfg.sharedItems || []);
  const out = [];
  let luxuryExcess = 0;

  if (housing === 'hosted') {
    // مقيمون عند قريب يتحمل السكن والمرافق: لا ثابت إلا ما يدفعونه فعلًا
    for (const k of ['rent', 'electricity', 'water', 'gas', 'telecom', 'transport']) {
      const v = k === 'rent' ? (hh.rent || 0) : (a[k] || 0);
      if (v > 0) {
        const p = pick(cfg, k, v);
        out.push({ ...p, value: Math.min(v, cfg.items[k].max), basis: 'actual' });
        luxuryExcess += p.excess;
      }
    }
    return { items: out, luxuryExcess };
  }

  if (housing === 'rent') {
    const p = pick(cfg, 'rent', hh.rent);       // فوق السقف يُقص، وتحت الأدنى يؤخذ كما هو
    out.push(p); luxuryExcess += p.excess;
  } else if (housing === 'owned') {
    out.push(pick(cfg, 'maintenance', a.maintenance));
  } // free: لا إيجار ولا صيانة

  out.push(pick(cfg, 'electricity', a.electricity));
  out.push(pick(cfg, 'water', a.water));
  if (a.gas == null && residents >= cfg.gasLargeFamily.fromResidents) {
    out.push({ key: 'gas', label: cfg.items.gas.label, value: cfg.gasLargeFamily.amount, basis: 'large-family', excess: 0 });
  } else out.push(pick(cfg, 'gas', a.gas));
  out.push(pick(cfg, 'telecom', a.telecom));
  out.push(pick(cfg, 'transport', a.transport));

  if (share < 1) for (const it of out) if (shared.has(it.key)) { it.value = Math.round(it.value * share); it.basis += '+share'; }
  return { items: out, luxuryExcess };
}

/* ───────────── الفئة (ب4) ───────────── */

function categoryOf(G, N, cfg) {
  if (N <= 0 || G <= 0) return 'sufficient';
  const t = cfg.thresholds;
  if (100 * G <= t.stopPct * N) return 'sufficient';       // قاعدة التوقف: الدخل ≥ 95% من الاحتياج
  if (100 * G < t.partialBelowPct * N) return 'partial';
  if (100 * G < t.severeFromPct * N) return 'needy';
  return 'severe';
}
// نقاط أي مبلغ (مثال: إيجار 1,000 = 45.5 نقطة)
export function pointsOf(value, cfg, decimals = 0) {
  const f = 10 ** decimals;
  return Math.round((value * cfg.pointsPerR * f) / cfg.R) / f;
}
export const CATEGORY_LABELS = { severe: 'شديد الاحتياج', needy: 'محتاج', partial: 'محتاج جزئيًا', sufficient: 'مكتفٍ لا يُعطى' };

const OTHER_INCOME_LABELS = {
  takaful: 'تكافل وكرامة', pension: 'معاش', assetYield: 'صافي عائد أصل (أرض/ماشية/مركبة)', remittance: 'تحويلات',
  relativesAid: 'مساعدات أقارب منتظمة', charityAid: 'جمعيات وجهات أخرى', inKind: 'دخل عيني مقوَّم', other: 'دخل آخر',
};

/* ───────────── التقييم الرئيسي ───────────── */

export function assess(input, cfg) {
  const evalDate = input.evalDate;
  if (!evalDate) throw new Error('evalDate مطلوب (YYYY-MM)');
  const hh = input.household || {};
  const A = cfg.ages;
  const P = cfg.R / cfg.pointsPerR;                          // قيمة النقطة (22 ج)
  const monthWage = cfg.dailyWage * cfg.imputedWorkDays;      // الشهر المرجعي للقادر (6,000 ج)
  const flags = new Set();
  const toPts = (v) => Math.round(v / P);

  /* 1) الأفراد وحالاتهم */
  const members = (input.members || []).map((m) => {
    const age = ageOf(m, evalDate);
    const male = m.sex === 'm';
    const able = m.able !== false;
    const studying = !!(m.study && m.study !== 'none');
    const serious = m.serious !== false;
    const adult = age >= A.adult;
    const elder = age >= A.elder;
    const nonSeriousStudent = adult && studying && !serious;
    // من يُنتظر منه الكسب: ذكر بالغ دون الستين قادر غير متفرغ لدراسة جادة (أ2، أ7)
    const expected = male && adult && !elder && able && !(studying && serious) && !m.absent;
    const refusing = expected && !nonSeriousStudent && m.work === 'refusing';
    const teenIdle = male && able && !m.absent && age >= A.teenWorkFrom && age < A.adult && !studying
      && m.work !== 'working' && m.work !== 'seeking';
    let rate = cfg.incomeRates.default;
    if (age < A.teenWorkFrom) rate = hh.schoolGrant ? 0 : cfg.incomeRates.default;   // أ14: عمالة أطفال
    else if (!male) rate = cfg.incomeRates.voluntary;                                 // أ8: كسب المرأة طوعي
    else if (studying && serious) rate = cfg.incomeRates.voluntary;                   // أ9: عمل الطالب الجاد
    const items = m.absent ? [] : memberItems(m, age, cfg);
    return { src: m, id: m.id, age, male, able, studying, serious, adult, elder, expected, refusing,
      nonSeriousStudent, teenIdle, rate, earn: m.absent ? 0 : (m.earn || 0), items, share: sum(items, (i) => i.value) };
  });
  const present = members.filter((m) => !m.src.absent);
  const residents = Number.isInteger(hh.residents) ? hh.residents : present.length;

  // الرافض: رب الأسرة ذو المعالين ← دخل مفترض + حماية المعالين. غيره ← يُحذف نصيبه فقط (أ7).
  const headCand = present.find((m) => m.src.rel === 'head' && m.refusing);
  const dependents = present.filter((m) => m !== headCand && !m.refusing);
  const headRefuser = headCand && dependents.length > 0 ? headCand : null;
  for (const m of present) m.excluded = m.refusing && m !== headRefuser;

  /* 2) الاحتياج N */
  const fixed = fixedItems(hh, residents, cfg);
  const fixedTotal = sum(fixed.items, (i) => i.value);
  const counted = present.filter((m) => !m.excluded);
  // إن لم يبقَ في الأسرة فرد محسوب (قادر رافض يعيش وحده) فلا احتياج معترفًا به: «لا حظ فيها لقوي مكتسب»
  const N_house = counted.length ? fixedTotal + sum(counted, (m) => m.share) : 0;
  const excludedShare = sum(present.filter((m) => m.excluded), (m) => m.share) + (headRefuser ? headRefuser.share : 0);
  if (fixed.luxuryExcess > 0) flags.add('rent-excess-luxury');
  // إنفاق فعلي فوق سقف العرف في غير الإيجار (فاتورة كهرباء عالية مثلًا): مؤشر يستدعي التحقق من دخل مخفي (أ16)
  const overCeiling = fixed.items.some((i) => i.key !== 'rent' && i.excess > 0)
    || present.some((m) => m.items.some((i) => i.key !== 'chronic_other' && i.excess > 0));
  if (overCeiling) flags.add('spending-above-ceiling');
  if (present.some((m) => m.items.some((i) => i.key === 'chronic_other' && i.excess > 0))) flags.add('medical-file');

  /* 3) الدخل المعترف به I */
  const lines = [];
  let headImputedExtra = 0;
  let headSelfUse = 0;
  for (const m of present) {
    if (m.excluded) {
      // المحذوف نصيبه يبدأ بنفسه: لا يُحسب للأسرة من كسبه إلا ما زاد على نصيبه
      if (m.earn > 0) lines.push({ type: 'earned-excluded', memberId: m.id, label: 'كسب فرد محذوف النصيب (الزائد عن نصيبه)', actual: m.earn, rate: 100, recognized: Math.max(0, m.earn - m.share) });
      continue;
    }
    if (m.earn > 0) {
      if (m.age < A.teenWorkFrom) flags.add(hh.schoolGrant ? 'school-grant-conditional' : 'child-labor');
      lines.push({ type: 'earned', memberId: m.id, label: 'كسب', actual: m.earn, rate: m.rate, recognized: pct(m.earn, m.rate) });
    }
    if (m === headRefuser) {
      headImputedExtra = Math.max(0, monthWage - m.earn);
      headSelfUse = Math.min(m.earn, m.share);
    } else if (m.nonSeriousStudent && m.male && m.able && !m.elder) {
      const extra = Math.max(0, cfg.imputed.nonSeriousStudent - pct(m.earn, m.rate));
      if (extra > 0) lines.push({ type: 'imputed', memberId: m.id, label: 'دخل مفترض: طالب غير جاد', actual: 0, rate: 100, recognized: extra });
      flags.add('non-serious-student');
    } else if (m.teenIdle) {
      const extra = Math.max(0, pct(monthWage, cfg.imputed.teenOutOfSchoolPct) - m.earn);
      if (extra > 0) lines.push({ type: 'imputed', memberId: m.id, label: 'دخل مفترض: 15–17 خارج الدراسة', actual: 0, rate: 100, recognized: extra });
      flags.add('teen-out-of-school');
    }
    if (m.nonSeriousStudent) flags.add('non-serious-student');
  }

  const rp = hh.rationPersons || 0;
  if (rp > 0) {
    const r = cfg.ration;
    const v = Math.min(rp, r.fullUpTo) * r.perPerson + Math.max(0, rp - r.fullUpTo) * r.perExtra;
    lines.push({ type: 'ration', label: `تموين (${rp} أفراد)`, actual: v, rate: 100, recognized: v });
  }
  for (const inc of input.income || []) {
    if (!(inc.amount > 0)) continue;
    lines.push({ type: inc.type, label: inc.label || OTHER_INCOME_LABELS[inc.type] || OTHER_INCOME_LABELS.other, actual: inc.amount, rate: 100, recognized: inc.amount });
    if (inc.type === 'charityAid') flags.add('coordinate-charities');
  }
  // النفقة الواجبة (أ6): المدفوعة فعلًا دخل كامل؛ غير المدفوعة صفر مع المتابعة
  for (const n of input.nafaqa || []) {
    if (n.paid > 0) lines.push({ type: 'nafaqaPaid', label: 'نفقة مدفوعة فعلًا', actual: n.paid, rate: 100, recognized: n.paid });
    if (n.unpaid) {
      const waited = n.since ? monthsBetween(n.since, evalDate) : 0;
      if (n.courtOrdered) flags.add('nasser-bank');
      flags.add(waited >= cfg.review.relativesContactMonths ? 'nafaqa-lawsuit-guidance' : 'contact-relatives');
    }
  }
  const I_actual = sum(lines, (l) => l.recognized);

  /* 4) المنظوران قبل الأصول */
  const I_house0 = I_actual + headImputedExtra;
  const N_dep = headRefuser ? N_house - headRefuser.share : N_house;
  const I_dep0 = headRefuser ? I_actual - headSelfUse : I_actual;
  const G0 = headRefuser ? N_dep - I_dep0 : N_house - I_house0;

  /* 5) اختبار الأصول (ب4-4) */
  const as = input.assets || {};
  const liquid = Math.max(0, (as.savings || 0) + (as.goldExcess || 0) + (as.idle || 0) - (as.earmarked || 0));
  const nisab = cfg.nisabGrams * cfg.gold21PricePerGram;
  const assets = { liquid, nisab, surplus: 0, monthlyFromAssets: 0, status: 'none' };
  if (liquid > 0) {
    const g0 = Math.max(0, G0);
    assets.surplus = liquid - cfg.assets.bufferMonths * g0;
    if (assets.surplus >= nisab) assets.status = 'rich';                                        // غنية عند الجميع
    else if (g0 > 0 && assets.surplus >= cfg.assets.sufficientMonths * g0) assets.status = 'sufficient-now';
    else if (g0 > 0 && assets.surplus > 0) {
      assets.status = 'partial';
      assets.monthlyFromAssets = Math.floor(assets.surplus / cfg.assets.sufficientMonths);
      lines.push({ type: 'assets', label: 'الأصول السائلة الفائضة ÷ 12', actual: assets.surplus, rate: 100, recognized: assets.monthlyFromAssets });
    } else assets.status = g0 > 0 ? 'within-buffer' : 'none';
    if (assets.status === 'rich') flags.add('assets-rich');
    if (assets.status === 'sufficient-now') flags.add('assets-sufficient-now');
    if (assets.status === 'partial') flags.add('assets-partial');
  }

  /* 6) النتيجة */
  const I_house = I_house0 + assets.monthlyFromAssets;
  const G_house = N_house - I_house;
  const I_dep = I_dep0 + assets.monthlyFromAssets;
  const G_dep = N_dep - I_dep;

  const view = headRefuser ? 'dependents' : 'household';
  const N = headRefuser ? N_dep : N_house;
  const I = headRefuser ? I_dep : I_house;
  const G = N - I;
  const assetStop = assets.status === 'rich' || assets.status === 'sufficient-now';
  const category = assetStop ? 'sufficient' : categoryOf(G, N, cfg);

  /* 7) المبلغ الشهري المستحق (لا يتجاوز العجز أبدًا) */
  const monthly = { amount: 0, phase: null, afterGrace: null, mode: 'cash-or-kind', form: 'monthly', source: 'none' };
  if (category !== 'sufficient') {
    if (headRefuser) {
      const Gd = Math.max(0, G_dep);
      const floor = pct(Gd, cfg.protection.dependentsFloorPct);                 // حماية المعالين 60%
      const after = Math.min(Gd, Math.max(G_house, floor, 0));
      const since = headRefuser.src.refusingSince;
      const waited = since ? monthsBetween(since, evalDate) : 0;
      monthly.phase = waited >= cfg.protection.graceMonths ? 2 : 1;
      monthly.afterGrace = after;
      monthly.amount = monthly.phase === 1 ? Gd : after;
    } else monthly.amount = Math.max(0, G);
  }

  /* 8) طريقة التسليم (أ3، أ12) */
  const head = present.find((m) => m.src.rel === 'head');
  const hasSpouse = present.some((m) => m.src.rel === 'spouse');
  const adultsWithVice = present.filter((m) => m.adult && m.src.addiction);
  if (headRefuser) {
    monthly.mode = hasSpouse ? 'in-kind-via-mother' : 'in-kind-only';
    flags.add('refuser-head'); flags.add('job-offer-and-advice'); flags.add('nafaqa-lawsuit-guidance');
    if (monthly.phase === 2) flags.add('food-and-education-only');
  } else if (adultsWithVice.length) {
    monthly.mode = 'in-kind-only';
  } else if (head && head.male && (head.src.smoker || head.src.spendthrift)) {
    monthly.mode = 'in-kind-or-via-mother';
  }
  if (adultsWithVice.length) { flags.add('addiction-referral'); flags.add('no-repay-vice-debts'); }
  if (present.some((m) => m.src.smoker)) flags.add('smoking-quit-plan');
  if (hh.headPreventsWifeWork) flags.add('head-prevents-wife-work');
  if (category === 'partial') monthly.form = 'seasonal-or-small-monthly';
  if (present.some((m) => m.excluded)) flags.add('refuser-excluded');
  if (headCand && !headRefuser) flags.add('able-refuser-no-dependents');

  /* 9) مصدر المال (أ3) */
  if (category !== 'sufficient') {
    if ((hh.faith || 'muslim') !== 'muslim') { monthly.source = 'sadaqa-only'; flags.add('sadaqa-only-non-muslim'); }
    else if (hh.aalBayt) { monthly.source = 'sadaqa-only'; flags.add('sadaqa-only-aal-bayt'); }
    else monthly.source = category === 'partial' ? 'zakat-or-sadaqa' : 'zakat';
  }

  /* 10) وزن الأولوية w (ب4-7) — يُستعمل عند ضيق الميزانية فقط */
  const W = cfg.weights10;
  const provider = counted.some((m) => m.age >= A.adult && !m.elder && m.able && m.earn > 0 && !(m.src.rel === 'head' && !m.male));
  const femaleHead = ['widow', 'divorced', 'husbandAbsent'].includes(hh.maritalCase);
  const weightParts = {};
  if (present.some((m) => m.src.orphan && m.age < A.orphanBelow)) weightParts.orphans = W.orphans;
  if (femaleHead && !provider) weightParts.femaleHeadNoProvider = W.femaleHeadNoProvider;
  if (present.some((m) => (m.src.chronic || []).length > 0 || m.src.able === false)) weightParts.disabilityOrChronic = W.disabilityOrChronic;
  if (present.some((m) => m.elder) && !provider) weightParts.elderNoProvider = W.elderNoProvider;
  if (residents >= W.largeFamilyFrom) weightParts.largeFamily = W.largeFamily;
  if (hh.kinOrNeighbor) weightParts.kinOrNeighbor = W.kinOrNeighbor;
  if (present.some((m) => m.adult && m.src.work === 'seeking')) weightParts.seriousJobSearch = W.seriousJobSearch;
  let w10 = Math.min(W.max, W.base + sum(Object.values(weightParts), (v) => v));
  if (headRefuser) w10 = W.base;                                                     // أ8: وزن 1.0 والعطاء مشروط

  /* 11) علامات التمكين والتدريب (ب4، أ15) */
  for (const m of counted) {
    if (!m.expected || m.nonSeriousStudent) continue;
    const low = m.src.work === 'working' && m.earn < pct(monthWage, cfg.empowerment.lowOutputBelowPctOfMonth);
    if (m.src.work === 'seeking' || low) flags.add(m.src.rel === 'head' ? 'empowerment' : 'training-forsa');
    if (!m.src.work && m.earn === 0) flags.add('needs-work-status');
  }
  if (hh.wantsProject) flags.add('empowerment');
  if (hh.positiveBehavior) flags.add('seasonal-priority');

  /* 12) موعد المراجعة (ج7) */
  const reviewCandidates = [addMonths(evalDate, cfg.review.familyMonths)];
  for (const m of present) {
    if (!m.src.birth) continue;
    for (const t of [A.food0_5Max + 1, A.food6_11Max + 1, A.teenWorkFrom, A.adult, A.elder]) {
      const when = ymString(ymIndex(m.src.birth) + t * 12);
      if (ymIndex(when) > ymIndex(evalDate)) { reviewCandidates.push(when); break; }
    }
  }
  if (headRefuser && monthly.phase === 1) {
    reviewCandidates.push(addMonths(headRefuser.src.refusingSince || evalDate, cfg.protection.graceMonths));
  }
  for (const n of input.nafaqa || []) if (n.unpaid) reviewCandidates.push(addMonths(n.since || evalDate, cfg.review.relativesContactMonths));
  if (input.validUntil) reviewCandidates.push(input.validUntil);
  const future = reviewCandidates.filter((d) => ymIndex(d) > ymIndex(evalDate));
  const reviewBy = (future.length ? future : reviewCandidates).reduce((a, b) => (ymIndex(a) <= ymIndex(b) ? a : b));

  /* 13) التوثيق (أ16) */
  const v = input.verification || {};
  const verificationScore = ['documents', 'homeVisit', 'references', 'takafulInquiry'].filter((k) => v[k]).length;
  if (input.verification && verificationScore < 2) flags.add('low-verification');

  const result = {
    engineVersion: ENGINE_VERSION,
    configVersion: cfg.configVersion,
    evalDate,
    view,
    N, I, G,
    gPct: N > 0 ? Math.round((1000 * G) / N) / 10 : 0,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    w10,
    weightParts,
    points: {
      perPoint: P,
      need: toPts(N), income: toPts(I), gap: toPts(G),
      payable: toPts(monthly.amount),
      priority: Math.round((w10 * monthly.amount) / (10 * P)),
      negative: excludedShare > 0 ? -toPts(excludedShare) : 0,
    },
    monthly,
    householdView: headRefuser ? { N: N_house, I: I_house, G: G_house } : null,
    need: {
      fixed: fixed.items, fixedTotal, luxuryExcess: fixed.luxuryExcess, residents,
      members: present.map((m) => ({ id: m.id, age: m.age, share: m.share, excluded: m.excluded || m === headRefuser, items: m.items })),
    },
    incomeLines: lines,
    imputedHead: headImputedExtra,
    assets,
    flags: [...flags].sort(),
    reviewBy,
    verificationScore,
  };
  return result;
}

/* ───────────── توزيع ميزانية محدودة (ب4) ───────────── */
// A_i = min(G_i, B × w_i × G_i ÷ Σ(w × G))، ثم يُعاد توزيع الباقي على من لم يكتمل عجزه.
// لا تتجاوز مساعدة أي أسرة عجزها، وتُقدَّم «شديد الاحتياج» ثم «محتاج» ثم «محتاج جزئيًا».

function waterfill(B, items) {
  const alloc = new Map(items.map((i) => [i.id, 0]));
  let active = items.filter((i) => i.cap > 0 && i.key > 0);
  let rem = B;
  while (active.length && rem > 0) {
    const denom = sum(active, (i) => i.key);
    const sat = active.filter((i) => rem * i.key >= i.cap * denom);
    if (sat.length === 0) {
      const parts = active.map((i) => ({ i, q: Math.floor((rem * i.key) / denom), r: (rem * i.key) % denom }));
      let extra = rem - sum(parts, (p) => p.q);
      parts.sort((a, b) => b.r - a.r || (String(a.i.id) < String(b.i.id) ? -1 : 1));
      for (const p of parts) {
        let add = p.q;
        if (extra > 0 && add + 1 <= p.i.cap) { add += 1; extra -= 1; }
        alloc.set(p.i.id, add);
      }
      rem = extra;
      break;
    }
    for (const i of sat) { alloc.set(i.id, i.cap); rem -= i.cap; }
    active = active.filter((i) => !sat.includes(i));
  }
  return { alloc, rem };
}

export function allocate(budget, families, opts = {}) {
  const roundTo = opts.roundTo > 0 ? opts.roundTo : 1;
  const tiers = opts.tierPriority === false ? [['severe', 'needy', 'partial']] : [['severe'], ['needy'], ['partial']];
  let left = Math.floor(Math.max(0, budget) / roundTo);
  const amounts = new Map(families.map((f) => [f.id, 0]));
  for (const tier of tiers) {
    const items = families
      .filter((f) => tier.includes(f.category) && f.amount > 0)
      .map((f) => ({ id: f.id, cap: Math.floor(f.amount / roundTo), key: (f.w10 || 10) * f.amount }));
    const { alloc, rem } = waterfill(left, items);
    for (const [id, units] of alloc) amounts.set(id, units * roundTo);
    left = rem;
  }
  const rows = families.map((f) => {
    const a = amounts.get(f.id) || 0;
    return { id: f.id, due: f.amount, allocated: a, coveredPct: f.amount > 0 ? Math.round((100 * a) / f.amount) : 0 };
  });
  const allocated = sum(rows, (r) => r.allocated);
  return { rows, allocated, unallocated: Math.max(0, budget) - allocated };
}

/* ───────────── تصنيف الديون (أ10) — ملف مستقل لا يضاف للعجز الشهري ───────────── */

const DEBT_BASE = {
  'urgent-medical': 'D1',
  'rent': 'D2', 'living-necessity': 'D2', 'education': 'D2', 'basic-kit': 'D2', 'necessary-repair': 'D2',
  'daughter-trousseau-basic': 'D2', 'work-tool': 'D2',
  'improvement': 'D3',
  'luxury': 'D4', 'gambling': 'D4', 'drugs': 'D4', 'other-sin': 'D4',
};
const DEBT_INFO = {
  D1: { label: 'د1 ضرورة', priority: 1 },
  D2: { label: 'د2 حاجة', priority: 2 },
  D3: { label: 'د3 تحسين مباح', priority: 4 },
  D4: { label: 'د4 معصية أو إسراف', priority: 5 },
};

export function classifyDebt(debt) {
  let cls = DEBT_BASE[debt.cause];
  if (!cls) throw new Error('سبب دين غير معروف: ' + debt.cause);
  // ما يُخشى معه الحبس أو الطرد وسببه حاجة ← ضرورة
  if (cls === 'D2' && (debt.threat === 'prison' || debt.threat === 'eviction')) cls = 'D1';
  const info = DEBT_INFO[cls];
  const dueNow = debt.due === 'overdue' || debt.due === 'near';
  const actions = [];
  let eligibleNow = false;
  let source = 'none';
  if (cls === 'D1' || cls === 'D2') {
    eligibleNow = !!debt.unable && dueNow;
    source = 'zakat-gharimin';
    actions.push('pay-creditor-directly');
    if (!debt.unable) actions.push('needs-proof-of-inability');
    if (!dueNow) actions.push('not-due-yet');
  } else if (cls === 'D3') {
    source = 'qard-hasan-or-reschedule';
    actions.push('reschedule-or-qard-hasan');
    if (debt.threat) actions.push('committee-review-threat');
  } else {
    source = 'none';
    actions.push(debt.repented ? 'after-repentance-and-exhausting-others' : 'not-repaid-until-evident-repentance');
    if (debt.cause === 'gambling' || debt.cause === 'drugs') actions.push('refer-treatment');
  }
  if (debt.riba || debt.interest > 0) actions.push('negotiate-interest-and-refer-mufti');
  return {
    class: cls, label: info.label, priority: info.priority, eligibleNow, source,
    payable: eligibleNow ? (debt.principal ?? debt.amount ?? 0) : 0,
    actions,
  };
}

/* ───────────── طلبات المرة الواحدة (ب2، أ11، أ15) — ميزانية مستقلة عن الشهري ───────────── */
// family = ناتج assess للأسرة نفسها. الناتج سقف مقترح وشروط، والقرار للجنة.

export function assessOneOff(req, family, cfg) {
  const poor = !!family && family.category !== 'sufficient';
  const sadaqaOnly = !!family && family.monthly.source === 'sadaqa-only';
  const requested = Math.max(0, req.requested || 0);
  const out = { type: req.type, requested, approvedMax: 0, eligible: false, mode: 'in-kind', source: sadaqaOnly ? 'sadaqa-only' : 'zakat', conditions: [] };
  switch (req.type) {
    case 'marriage-basics':                       // أ11: القائمة الأساسية فقط، عينًا، بعد التحقق من الفقر
    case 'basic-kit': {
      out.eligible = poor;
      out.approvedMax = poor ? Math.min(requested, cfg.oneOff.basicKit.max) : 0;
      out.conditions.push('basic-list-only', 'in-kind', 'verify-poverty-first');
      if (requested > cfg.oneOff.basicKit.max) out.conditions.push('reject-excess');
      break;
    }
    case 'medical': {                              // علاج بمستندات، يُدفع للجهة مباشرة
      // المكتفي يُنظر في ما يزيد على قدرته: فائضه الشهري لسنة + أصوله السائلة
      const own = poor ? 0 : 12 * Math.max(0, -(family?.G ?? 0)) + (family?.assets?.liquid ?? 0);
      out.approvedMax = Math.max(0, requested - own);
      out.eligible = out.approvedMax > 0;
      out.mode = 'pay-provider-directly';
      out.conditions.push('documents-required', 'check-state-coverage-first');
      break;
    }
    case 'repair': {                               // ترميم ضروري بالمعاينة
      out.eligible = poor; out.approvedMax = poor ? requested : 0;
      out.conditions.push('inspection-required', 'necessary-only');
      break;
    }
    case 'empowerment': {                          // أ15: آلة أو رأس مال أو قرض حسن، مرة واحدة مع متابعة
      const flagged = !!family && (family.flags.includes('empowerment') || family.flags.includes('training-forsa'));
      out.eligible = poor || flagged; out.approvedMax = out.eligible ? requested : 0;
      out.source = sadaqaOnly ? 'sadaqa-only' : 'zakat-or-qard-hasan';
      out.conditions.push('market-price-quote', 'fits-family-experience', 'follow-up-12-months', 'cover-consumption-so-asset-not-sold');
      break;
    }
    default: throw new Error('نوع طلب غير معروف: ' + req.type);
  }
  return out;
}
