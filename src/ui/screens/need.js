// حاسبة الاحتياج: نموذج التقييم بخطوات، بطاقة النتيجة، الاعتماد، السجل والمقارنة، المراجعات المستحقة،
// توزيع الشهر، ملفات الديون و«المرة الواحدة»، وإعداد الحاسبة بنسخ مؤرخة. الحساب كله في core/need*.js.
// الحاسبة استشارية: تقترح، واللجنة تعتمد. لا حركة مالية ولا تغيير مبلغ إلا باعتماد صريح.
import { h, clear } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { openSheet, field, moneyInput, dateInput, selectInput, textInput, textArea, checkbox, errorBox, toast, confirmDialog, row, list, empty, sectionTitle, chips, table, kv, badge, monthOptions, stat } from '../components.js';
import { ui, collator } from '../widgets.js';
import { needConfigAt, profileAt } from '../../core/engine.js';
import { normalizeDigits } from '../../core/money.js';
import { addMonths, newId, ymOf } from '../../core/util.js';
import { NEED_ENGINE_VERSION, runAssessment, approveAssessment, familyAssessments, currentAssessment, estimateGapPct, dueReviews, compareAssessments, proposeMonthAllocation, recalcWithConfig, nextNeedConfigVersion, suggestedApprovedMonthly, poundsToUnits, unitsToPounds, classifyDebt, assessOneOff, needAgeOf } from '../../core/need.js';
import { suggestFamilyAllocation, entitlementAt } from '../../core/families.js';
import { acctOptions } from '../forms-movements.js';
import { effectiveMonthSelect } from '../forms-entities.js';
import { executeBatch } from '../../core/inkind.js';

const S = () => ctx.state;
const cfgNow = () => needConfigAt(S(), ctx.nowMonth()).config;
const L = (group, key) => cfgNow().labels?.[group]?.[key] || key;
const egp = (pounds) => `${F.num(Number(pounds).toLocaleString('en-US'))} ج`;
const parseInt0 = (v) => {
  const s = normalizeDigits(v ?? '').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
};

// حقل رقم صحيح بالجنيه مرتبط بمفتاح في كائن (فارغ = يُحذف المفتاح).
function numField(obj, key, { placeholder = '', onchange = null, commit = false } = {}) {
  const el = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', value: obj[key] ?? '', placeholder });
  if (commit) el.addEventListener('change', () => ctx.refresh()); // بعد اكتمال الإدخال: أعد الرسم (العمر يحدد الحقول الظاهرة)
  el.addEventListener('input', () => {
    const v = parseInt0(el.value);
    if (v === null) delete obj[key];
    else obj[key] = v;
    if (onchange) onchange();
  });
  return el;
}
function selField(obj, key, options, { def = '', refresh = false, onchange = null } = {}) {
  const el = selectInput(options, obj[key] ?? def);
  el.addEventListener('change', () => {
    if (el.value === '' || el.value === def) delete obj[key];
    else obj[key] = el.value;
    if (onchange) onchange();
    if (refresh) ctx.refresh();
  });
  return el;
}
function boolField(obj, key, label, { refresh = false, invert = false } = {}) {
  const c = checkbox(label, invert ? obj[key] === false : !!obj[key]);
  c.input.addEventListener('change', () => {
    if (invert) {
      if (c.input.checked) obj[key] = false;
      else delete obj[key];
    } else if (c.input.checked) obj[key] = true;
    else delete obj[key];
    if (refresh) ctx.refresh();
  });
  return c;
}
const monthField = (obj, key) => {
  const el = h('input', { type: 'month', value: obj[key] || '' });
  el.addEventListener('change', () => {
    if (/^\d{4}-\d{2}$/.test(el.value)) obj[key] = el.value;
    else delete obj[key];
  });
  return el;
};

// مساعد حساب الدخل غير الثابت: يومية / موسمي / غير منتظم.
function incomeHelper(onPick) {
  openSheet('مساعد حساب الدخل الشهري', (body, close) => {
    const mode = selectInput(
      [
        { value: 'daily', label: 'يومية: أيام العمل الفعلية × الأجر' },
        { value: 'seasonal', label: 'موسمي: دخل السنة ÷ 12' },
        { value: 'irregular', label: 'غير منتظم: مجموع آخر 6 أشهر ÷ 6' },
      ],
      'daily',
    );
    const a = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off' });
    const b = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', value: cfgNow().dailyWage });
    const fa = field('أيام العمل في الشهر', a);
    const fb = field('أجر اليوم (جنيه)', b);
    const out = h('div', { class: 'preview' });
    const value = () => {
      const x = parseInt0(a.value);
      const y = parseInt0(b.value);
      if (x === null) return null;
      if (mode.value === 'daily') return y === null ? null : x * y;
      return Math.round(x / (mode.value === 'seasonal' ? 12 : 6));
    };
    const draw = () => {
      fa.querySelector('label').textContent = mode.value === 'daily' ? 'أيام العمل في الشهر' : mode.value === 'seasonal' ? 'صافي دخل السنة (جنيه)' : 'مجموع دخل آخر 6 أشهر (جنيه)';
      fb.style.display = mode.value === 'daily' ? '' : 'none';
      clear(out);
      const v = value();
      out.append(h('div', { class: 'pl' }, h('span', { text: 'الدخل الشهري' }), h('span', { class: 'num', text: v === null ? '—' : egp(v) })));
    };
    [mode, a, b].forEach((el) => el.addEventListener('input', draw));
    draw();
    body.append(
      field('طريقة الحساب', mode),
      fa,
      fb,
      out,
      h('button', {
        class: 'btn primary block',
        type: 'button',
        text: 'استخدام هذا الرقم',
        onclick: () => {
          const v = value();
          if (v === null) return toast('أكمل الأرقام', 'bad');
          onPick(v);
          close();
        },
      }),
    );
  });
}

const REL = { head: 'رب/ربة الأسرة', spouse: 'زوج/زوجة', child: 'ابن/بنت', parent: 'أب/أم', other: 'آخر' };
const STUDY = { none: 'لا يدرس', primary: 'ابتدائي', prep: 'إعدادي', secondary: 'ثانوي / أزهري / فني', university: 'جامعة' };
const WORK = { '': 'غير محدد', working: 'يعمل', seeking: 'يبحث ولا يجد', refusing: 'قادر ويرفض عملاً لائقاً متاحاً' };
const HOUSING = { owned: 'ملك', rent: 'إيجار', free: 'سكن مجاني مستقل', hosted: 'مقيمون عند قريب يتحمل السكن' };
const MARITAL = { married: 'متزوجون', widow: 'أرملة', divorced: 'مطلقة', husbandAbsent: 'الزوج غائب', single: 'أعزب/عزباء', orphansHosted: 'أيتام في كفالة قريب' };
const INCOME = { takaful: 'تكافل وكرامة', pension: 'معاش', assetYield: 'صافي عائد أصل (أرض/ماشية/مركبة)', remittance: 'تحويلات', relativesAid: 'مساعدات أقارب منتظمة', charityAid: 'جمعيات وجهات أخرى', inKind: 'دخل عيني مقوَّم', other: 'دخل آخر' };
const CHRONIC = { bp: 'ضغط', dmOral: 'سكر أقراص', dmInsulin: 'سكر أنسولين', disability: 'إعاقة' };
const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));
const STEPS = ['السكن', 'الأفراد', 'الدخل والنفقة', 'الأصول', 'السلوك والتوثيق', 'النتيجة'];

const blankInput = () => ({ evalDate: ctx.nowMonth(), household: { housing: 'owned', maritalCase: 'married' }, members: [], income: [], nafaqa: [], assets: {}, verification: {} });
const cleanInput = (input) => {
  const out = JSON.parse(JSON.stringify(input));
  if (out.assets && !Object.keys(out.assets).length) delete out.assets;
  if (out.verification && !Object.keys(out.verification).length) delete out.verification;
  out.income = (out.income || []).filter((x) => x.amount > 0);
  out.nafaqa = (out.nafaqa || []).filter((x) => x.paid > 0 || x.unpaid);
  if (out.household.actual && !Object.keys(out.household.actual).length) delete out.household.actual;
  return out;
};
const memberAge = (m, evalDate) => {
  try {
    return needAgeOf(m, evalDate);
  } catch {
    return null;
  }
};
const memberTitle = (m, age) => `${REL[m.rel] || ''}${m.sex === 'f' ? ' (أنثى)' : ' (ذكر)'}${age !== null ? ` — ${F.num(age)} سنة` : ''}`;

function wizardState(familyId, assessmentId) {
  const st = ui(`assess:${familyId}`, { step: 0, input: null, id: null, open: null, estimate: null });
  if (assessmentId && st.id !== assessmentId) {
    const a = S().assessments.get(assessmentId);
    if (a && a.status === 'draft') Object.assign(st, { id: a.id, input: JSON.parse(JSON.stringify(a.input)), step: 5, estimate: a.committee?.estimate ?? null });
  }
  if (!st.input) {
    // إعادة تقييم: نبدأ من آخر مدخلات محفوظة (تاريخ الميلاد يحدّث العمر وحده)
    const last = familyAssessments(S(), familyId)[0];
    st.input = last ? { ...JSON.parse(JSON.stringify(last.input)), evalDate: ctx.nowMonth() } : blankInput();
    st.id = null;
    for (const k of ['income', 'nafaqa']) if (!st.input[k]) st.input[k] = [];
    for (const k of ['assets', 'verification']) if (!st.input[k]) st.input[k] = {};
    if (!st.input.household) st.input.household = {};
  }
  return st;
}

// ---------- نموذج التقييم ----------
export function assessScreen({ familyId, assessmentId = null }) {
  const fam = S().families.get(familyId);
  if (!fam) return { title: 'تقييم', body: empty('الأسرة غير موجودة') };
  const st = wizardState(familyId, assessmentId);
  const input = st.input;
  const hh = input.household;
  const body = h('div', {});
  body.append(h('div', { class: 'steps', 'aria-label': `خطوة ${st.step + 1} من ${STEPS.length}` }, STEPS.map((_, i) => h('span', { class: i <= st.step ? 'on' : '' }))));
  body.append(chips(STEPS.map((label, i) => ({ value: i, label: `${F.num(i + 1)}. ${label}` })), st.step, (v) => ((st.step = v), ctx.refresh())));
  const go = (d) => () => {
    st.step = Math.max(0, Math.min(STEPS.length - 1, st.step + d));
    ctx.refresh();
    window.scrollTo(0, 0);
  };
  const nav = () => h('div', { class: 'btn-row', style: { marginTop: '14px' } }, st.step > 0 ? h('button', { class: 'btn', text: 'السابق', onclick: go(-1) }) : null, st.step < 5 ? h('button', { class: 'btn primary', text: st.step === 4 ? 'احسب النتيجة' : 'التالي', onclick: go(1) }) : null);

  if (st.step === 0) {
    if (!hh.actual) hh.actual = {};
    const rentF = field('الإيجار الفعلي (جنيه)', numField(hh, 'rent'));
    rentF.style.display = hh.housing === 'rent' || hh.housing === 'hosted' ? '' : 'none';
    body.append(
      h('div', { class: 'grid2' }, field('شهر التقييم', monthField(input, 'evalDate')), field('السكن', selField(hh, 'housing', opts(HOUSING), { def: '__', refresh: true }))),
      rentF,
      h('div', { class: 'grid2' }, field('نصيب الأسرة من المرافق', selField(hh, 'fixedShare', [{ value: '1', label: 'بيت مستقل (كامل)' }, { value: '0.5', label: 'بيت عائلة: النصف' }, { value: '0.33', label: 'بيت عائلة: الثلث' }, { value: '0.25', label: 'بيت عائلة: الربع' }], { def: '1', onchange: () => hh.fixedShare && (hh.fixedShare = Number(hh.fixedShare)) })), field('أفراد بطاقة التموين', numField(hh, 'rationPersons', { placeholder: '0' }))),
      h('div', { class: 'grid2' }, field('الحالة الاجتماعية', selField(hh, 'maritalCase', opts(MARITAL), { def: '__' })), field('الديانة', selField(hh, 'faith', [{ value: 'muslim', label: 'مسلمة' }, { value: 'other', label: 'غير مسلمة' }], { def: 'muslim' }))),
      boolField(hh, 'aalBayt', 'من آل البيت'),
      boolField(hh, 'kinOrNeighbor', 'قرابة أو جوار'),
      sectionTitle('فواتير فعلية (اختياري — يُؤخذ المعتاد إن تُركت)'),
      h('div', { class: 'grid2' }, field('كهرباء', numField(hh.actual, 'electricity')), field('مياه', numField(hh.actual, 'water'))),
      h('div', { class: 'grid2' }, field('غاز', numField(hh.actual, 'gas')), field('اتصالات', numField(hh.actual, 'telecom'))),
      h('div', { class: 'grid2' }, field('مواصلات', numField(hh.actual, 'transport')), field('صيانة البيت', numField(hh.actual, 'maintenance'))),
    );
  } else if (st.step === 1) {
    const add = (preset) => {
      const m = { id: newId('m').slice(0, 8), ...preset };
      input.members.push(m);
      st.open = m.id;
      ctx.refresh();
    };
    const hasHead = input.members.some((m) => m.rel === 'head');
    body.append(
      h('div', { class: 'muted small', text: 'أضف فرداً بنقرة ثم اكتب عمره — العمر يحدد بنوده (طعام، كسوة، تعليم…).' }),
      h(
        'div',
        { class: 'chips' },
        !hasHead ? h('button', { class: 'chip', text: '＋ رب أسرة', onclick: () => add({ rel: 'head', sex: 'm' }) }) : null,
        !hasHead ? h('button', { class: 'chip', text: '＋ ربة أسرة', onclick: () => add({ rel: 'head', sex: 'f' }) }) : null,
        h('button', { class: 'chip', text: '＋ زوجة', onclick: () => add({ rel: 'spouse', sex: 'f' }) }),
        h('button', { class: 'chip', text: '＋ ابن', onclick: () => add({ rel: 'child', sex: 'm' }) }),
        h('button', { class: 'chip', text: '＋ بنت', onclick: () => add({ rel: 'child', sex: 'f' }) }),
        h('button', { class: 'chip', text: '＋ أب/أم', onclick: () => add({ rel: 'parent', sex: 'f' }) }),
        h('button', { class: 'chip', text: '＋ آخر', onclick: () => add({ rel: 'other', sex: 'm' }) }),
      ),
    );
    if (!input.members.length) body.append(empty('لا أفراد بعد'));
    input.members.forEach((m, i) => {
      const age = memberAge(m, input.evalDate);
      const open = st.open === m.id;
      const card = h('div', { class: 'member-card' });
      const flagsTxt = [m.study && m.study !== 'none' ? STUDY[m.study] : '', m.work ? WORK[m.work] : '', m.earn ? `كسب ${egp(m.earn)}` : '', (m.chronic || []).length ? 'مرض مزمن' : '', m.able === false ? 'عاجز عن الكسب' : '', m.orphan ? 'يتيم' : '', m.absent ? 'غائب' : ''].filter(Boolean).join(' · ');
      card.append(h('div', { class: 'head' }, h('button', { class: 'link', text: memberTitle(m, age), onclick: () => ((st.open = open ? null : m.id), ctx.refresh()) }), h('button', { class: 'btn small danger', text: 'حذف', 'aria-label': 'حذف الفرد', onclick: () => (input.members.splice(i, 1), ctx.refresh()) })));
      if (!open) {
        card.append(h('div', { class: 'muted small', text: flagsTxt || (age === null ? 'اكتب العمر' : 'اضغط الاسم للتفاصيل') }));
        if (age === null) card.append(field('العمر (سنة)', numField(m, 'age', { commit: true })));
      } else {
        const chronic = (m.chronic || []).map((c) => (typeof c === 'string' ? { type: c } : c));
        const setChronic = () => {
          if (chronic.length) m.chronic = chronic.map((c) => (Object.keys(c).length === 1 ? c.type : c));
          else delete m.chronic;
        };
        const other = chronic.find((c) => c.type === 'other');
        card.append(
          h('div', { class: 'grid2' }, field('الصلة', selField(m, 'rel', opts(REL), { def: '__', refresh: true })), field('النوع', selField(m, 'sex', [{ value: 'm', label: 'ذكر' }, { value: 'f', label: 'أنثى' }], { def: '__', refresh: true }))),
          h('div', { class: 'grid2' }, field('العمر (سنة)', numField(m, 'age', { commit: true })), field('أو تاريخ الميلاد', monthField(m, 'birth'), 'يُفضَّل: يتحدّث العمر وحده')),
          h('div', { class: 'grid2' }, field('الدراسة', selField(m, 'study', opts(STUDY), { def: 'none', refresh: true })), field('العمل', selField(m, 'work', opts(WORK), { def: '', refresh: true }))),
          m.study && m.study !== 'none' ? boolField(m, 'serious', 'غير جاد (رسوب سنتين أو انقطاع)', { invert: true }) : null,
          field('صافي الكسب الشهري الفعلي (جنيه)', h('div', {}, numField(m, 'earn'), h('button', { class: 'link', type: 'button', text: 'مساعد: يومية / موسمي / غير منتظم', onclick: () => incomeHelper((v) => ((m.earn = v), ctx.refresh())) }))),
          m.work === 'refusing' ? field('يرفض منذ (بداية المهلة)', monthField(m, 'refusingSince')) : null,
          boolField(m, 'able', 'عاجز عن الكسب (مرض / إعاقة / ضعف)', { invert: true }),
          h('div', { class: 'label muted small', text: 'أمراض مزمنة' }),
          Object.entries(CHRONIC).map(([type, label]) => {
            const cur = chronic.find((c) => c.type === type);
            const c = checkbox(label, !!cur);
            c.input.addEventListener('change', () => {
              if (c.input.checked) chronic.push({ type });
              else chronic.splice(chronic.findIndex((x) => x.type === type), 1);
              setChronic();
              ctx.refresh();
            });
            return c;
          }),
          chronic.some((c) => c.type !== 'other')
            ? (() => {
                const c = checkbox('العلاج على نفقة الدولة / التأمين (البند صفر)', chronic.filter((x) => x.type !== 'other').every((x) => x.covered));
                c.input.addEventListener('change', () => {
                  for (const x of chronic) {
                    if (x.type === 'other') continue;
                    if (c.input.checked) x.covered = true;
                    else delete x.covered;
                  }
                  setChronic();
                });
                return c;
              })()
            : null,
          field(
            'مرض مزمن آخر — تكلفته الشهرية الفعلية',
            (() => {
              const el = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', value: other?.actual ?? '' });
              el.addEventListener('input', () => {
                const v = parseInt0(el.value);
                const idx = chronic.findIndex((c) => c.type === 'other');
                if (v === null || v === 0) {
                  if (idx >= 0) chronic.splice(idx, 1);
                } else if (idx >= 0) chronic[idx].actual = v;
                else chronic.push({ type: 'other', actual: v });
                setChronic();
              });
              return el;
            })(),
            `حتى ${egp(cfgNow().chronicOtherMax)} شهرياً والزائد ملف علاج`,
          ),
          age !== null && age < 4 ? boolField(m, 'formula', 'لبن صناعي لحاجة طبية') : null,
          age !== null && age < 4 ? boolField(m, 'diapers', 'حفاضات') : null,
          age !== null && age < 18 ? boolField(m, 'orphan', 'يتيم (مات أبوه)') : null,
          boolField(m, 'absent', 'غائب / مسجون / مفقود (لا يدخل الاحتياج)'),
          age === null || age >= 15 ? h('div', {}, boolField(m, 'smoker', 'مدخن'), boolField(m, 'addiction', 'مخدرات / قمار / مراهنات'), boolField(m, 'spendthrift', 'مبذّر')) : null,
          h('button', { class: 'btn small', text: 'تم', onclick: () => ((st.open = null), ctx.refresh()) }),
        );
      }
      body.append(card);
    });
  } else if (st.step === 2) {
    body.append(h('div', { class: 'muted small', text: 'كسب الأفراد يُدخل في خطوة «الأفراد». هنا الدخول الأخرى (كلها تُحسب 100%).' }));
    const lines = h('div', { class: 'lines' });
    input.income.forEach((inc, i) => {
      const sel = selectInput(opts(INCOME), inc.type);
      sel.addEventListener('change', () => (inc.type = sel.value));
      lines.append(h('div', { class: 'line' }, h('div', { class: 'grid' }, sel, numField(inc, 'amount', { placeholder: 'شهرياً' }), h('button', { class: 'rm', type: 'button', text: '×', 'aria-label': 'حذف', onclick: () => (input.income.splice(i, 1), ctx.refresh()) }))));
    });
    body.append(
      sectionTitle('دخول أخرى'),
      input.income.length ? lines : h('div', { class: 'muted small', text: 'لا دخول أخرى' }),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: '+ دخل', onclick: () => (input.income.push({ type: 'takaful' }), ctx.refresh()) }), h('button', { class: 'btn small', text: 'مساعد: موسمي / غير منتظم', onclick: () => incomeHelper((v) => (input.income.push({ type: 'assetYield', amount: v }), ctx.refresh())) })),
      sectionTitle('النفقة الواجبة على قريب'),
    );
    input.nafaqa.forEach((n, i) => {
      body.append(
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'grid2' }, field('المدفوع فعلاً شهرياً', numField(n, 'paid', { placeholder: 'متوسط 6 أشهر' })), field('منذ متى لا يدفع', monthField(n, 'since'))),
          boolField(n, 'unpaid', 'واجبة ولا تُدفع (تُحسب صفراً مع المتابعة)'),
          boolField(n, 'courtOrdered', 'محكوم بها (بنك ناصر)'),
          h('button', { class: 'btn small danger', text: 'حذف', onclick: () => (input.nafaqa.splice(i, 1), ctx.refresh()) }),
        ),
      );
    });
    body.append(h('button', { class: 'btn small', text: '+ نفقة', onclick: () => (input.nafaqa.push({ from: 'relative' }), ctx.refresh()) }));
  } else if (st.step === 3) {
    const as = input.assets;
    body.append(
      h('div', { class: 'banner info', text: 'لا يدخل هنا: المسكن المناسب، الأثاث، آلة الحرفة، توك توك أو دراجة للعمل، حلي الزوجة المعتاد، أرض صغيرة أو جاموسة يُحسب ريعها دخلاً، ومال لم يصل بعد.' }),
      field('مدخرات وشهادات (جنيه)', numField(as, 'savings')),
      field('قيمة الذهب الزائد عن حلي مثيلاتها', numField(as, 'goldExcess')),
      field('أصول غير منتجة زائدة (أرض/عقار زائد، مواشٍ للتجارة)', numField(as, 'idle')),
      field('منها مرصود لحاجة أساسية موثقة (جهاز بنت، علاج)', numField(as, 'earmarked')),
    );
  } else if (st.step === 4) {
    const v = input.verification;
    body.append(
      sectionTitle('السلوك'),
      boolField(hh, 'positiveBehavior', 'سلوك إيجابي (بحث عن عمل، انتظام الأولاد، ادخار، سداد)'),
      boolField(hh, 'wantsProject', 'تريد مشروعاً / تمكيناً'),
      boolField(hh, 'schoolGrant', 'منحة مشروطة بانتظام طفل يعمل في الدراسة'),
      boolField(hh, 'headPreventsWifeWork', 'الزوج يمنع زوجته من العمل مع امتناعه عن النفقة'),
      sectionTitle('التوثيق'),
      boolField(v, 'documents', 'مستندات'),
      boolField(v, 'homeVisit', 'زيارة منزلية'),
      boolField(v, 'references', 'ثقتان من القرية'),
      boolField(v, 'takafulInquiry', 'استعلام تكافل وكرامة'),
      field('تقييم مؤقت حتى شهر (اختياري)', monthField(input, 'validUntil'), 'مثلاً إصابة عائل ثلاثة أشهر'),
    );
  } else {
    let run = null;
    let error = null;
    const clean = cleanInput(input);
    try {
      if (!clean.members.length) throw new Error('أضف أفراد الأسرة أولاً');
      if (!/^\d{4}-\d{2}$/.test(clean.evalDate || '')) throw new Error('حدّد شهر التقييم');
      run = runAssessment(S(), clean);
    } catch (e) {
      error = e.message;
    }
    if (error) body.append(h('div', { class: 'banner bad', text: `تعذّر الحساب: ${error}` }));
    else {
      body.append(resultCard(run.result, needConfigAt(S(), clean.evalDate)));
      const est = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', value: st.estimate ?? '', placeholder: 'ما تراه اللجنة مناسباً شهرياً' });
      const gapBox = h('div', {});
      const drawGap = () => {
        clear(gapBox);
        const g = estimateGapPct(run.result, st.estimate);
        if (g !== null && g > 20) gapBox.append(h('div', { class: 'banner', role: 'alert', text: `الفرق بين تقدير اللجنة ونتيجة الحاسبة ${F.num(g)}% (أكبر من 20%) — علامة لمراجعة المدخلات أو أوزان الإعداد.` }));
      };
      est.addEventListener('input', () => ((st.estimate = parseInt0(est.value)), drawGap()));
      drawGap();
      const draftOf = () => ({ id: st.id || (st.id = newId('as-')), familyId, status: 'draft', evalDate: clean.evalDate, date: ctx.today(), input: clean, result: run.result, configVersion: run.configVersion, engineVersion: run.engineVersion, committee: { estimate: st.estimate ?? null } });
      body.append(
        field('تقدير اللجنة (جنيه شهرياً)', est, 'في التجربة الميدانية: يُقارن بنتيجة الحاسبة'),
        gapBox,
        h(
          'div',
          { class: 'btn-row' },
          h('button', {
            class: 'btn',
            text: 'حفظ كمسودة',
            onclick: async () => {
              try {
                await ctx.store.dispatch('need.assessment.save', draftOf());
                toast('حُفظت المسودة');
                ctx.nav(`#/family/${familyId}`);
              } catch (e) {
                toast(e.message, 'bad');
              }
            },
          }),
          h('button', { class: 'btn primary', text: 'اعتماد', onclick: () => approveForm(draftOf(), () => (Object.assign(st, { input: null, id: null, step: 0, estimate: null }), ctx.nav(`#/family/${familyId}`))) }),
        ),
      );
    }
  }
  body.append(nav());
  return { title: `تقييم الاحتياج: ${fam.name}`, subtitle: `${STEPS[st.step]} — خطوة ${F.num(st.step + 1)} من ${F.num(STEPS.length)}`, body };
}

// ---------- بطاقة النتيجة ----------
const BASIS = { typ: 'المعتاد', actual: 'الفعلي', capped: 'قُصّ للأعلى المسموح', raised: 'رُفع للأدنى', covered: 'مغطّى', 'small-child': 'طفل صغير', 'large-family': 'أسرة كبيرة', 'non-serious': 'غير جاد' };
const basisText = (b) => String(b).split('+').map((x) => (x === 'share' ? 'نصيب من بيت مشترك' : BASIS[x] || x)).join('، ');

export function resultCard(r, ver) {
  const cfg = ver.config;
  const lab = (g, k) => cfg.labels?.[g]?.[k] || k;
  const P = r.points.perPoint;
  const pts = (v) => F.num(Math.round((10 * v) / P) / 10);
  const out = h('div', {});
  out.append(
    h(
      'div',
      { class: `result-hero ${r.category}` },
      h('div', { class: 'cat', text: r.categoryLabel }),
      h('div', { class: 'muted small', text: `نسبة العجز ${F.num(r.gPct)}%${r.view === 'dependents' ? ' — بمنظور المعالين (رب الأسرة قادر رافض)' : ''}` }),
      h('div', { class: 'tri' }, h('div', {}, h('div', { class: 'k', text: 'الاحتياج N' }), h('div', { class: 'v num', text: egp(r.N) })), h('div', {}, h('div', { class: 'k', text: 'الدخل I' }), h('div', { class: 'v num', text: egp(r.I) })), h('div', {}, h('div', { class: 'k', text: 'العجز G' }), h('div', { class: 'v num', text: egp(r.G) }))),
      h('div', { class: 'muted small', text: 'المبلغ الشهري المستحق (سقف الاستحقاق)' }),
      h('div', { class: 'big num', text: egp(r.monthly.amount) }),
      r.monthly.afterGrace !== null && r.monthly.phase === 1 ? h('div', { class: 'small', text: `بعد انتهاء المهلة إن أصرّ: ${egp(r.monthly.afterGrace)}` }) : null,
    ),
    h(
      'div',
      { class: 'card' },
      kv('طريقة التسليم', lab('mode', r.monthly.mode)),
      kv('شكل المساعدة', lab('form', r.monthly.form)),
      kv('مصدر المال', lab('source', r.monthly.source)),
      kv('موعد المراجعة', F.month(r.reviewBy), '', { secret: false }),
      kv('درجة التوثيق', `${F.num(r.verificationScore)} من 4`, '', { secret: false }),
      kv('نسخة الإعداد / المحرك', `${F.num(ver.version)} / ${r.engineVersion}`, '', { secret: false }),
    ),
    sectionTitle('النقاط'),
    h(
      'div',
      { class: 'card' },
      kv('نقاط الاحتياج / الدخل / العجز', `${F.num(r.points.need)} / ${F.num(r.points.income)} / ${F.num(r.points.gap)}`, '', { secret: false }),
      kv('نقاط المبلغ المستحق', F.num(r.points.payable), '', { secret: false }),
      kv('وزن الأولوية', F.num(r.w10 / 10), '', { secret: false }),
      kv('نقاط الأولوية (للترتيب عند ضيق الميزانية)', F.num(r.points.priority), '', { secret: false }),
      r.points.negative ? kv('نقاط سالبة (نصيب محذوف)', F.num(r.points.negative), 'neg', { secret: false }) : null,
      kv('قيمة النقطة', egp(P), '', { secret: false }),
    ),
  );
  if (r.flags.length) out.append(sectionTitle('العلامات والإجراءات'), h('div', { class: 'card' }, h('ul', { class: 'flag-list' }, r.flags.map((f) => h('li', { text: lab('flags', f) })))));
  if (r.householdView) out.append(h('div', { class: 'card' }, kv('منظور الأسرة: الاحتياج', egp(r.householdView.N)), kv('منظور الأسرة: الدخل (مع المفترض)', egp(r.householdView.I)), kv('منظور الأسرة: العجز', egp(r.householdView.G))));
  // تفصيل البنود بنداً بنداً مع نقاط كل بند
  const rows = [];
  for (const it of r.need.fixed) rows.push([`ثابت: ${it.label}`, egp(it.value), pts(it.value), basisText(it.basis)]);
  r.need.members.forEach((m, i) => {
    rows.push([`— فرد ${F.num(i + 1)} (${F.num(m.age)} سنة)${m.excluded ? ' — نصيبه محذوف' : ''}`, egp(m.share), pts(m.share), '']);
    for (const it of m.items) rows.push([it.label, egp(it.value), pts(it.value), basisText(it.basis)]);
  });
  out.append(sectionTitle('تفصيل الاحتياج'), table([{ label: 'البند' }, { label: 'جنيه', num: true }, { label: 'نقاط', num: true }, { label: 'الأساس' }], rows, { pg: 'families' }));
  if (r.incomeLines.length) {
    out.append(
      sectionTitle('تفصيل الدخل المعترف به'),
      table(
        [{ label: 'المصدر' }, { label: 'الفعلي', num: true }, { label: 'النسبة', num: true }, { label: 'المعترف به', num: true }, { label: 'نقاط', num: true }],
        r.incomeLines.map((l) => [l.label, egp(l.actual), `${F.num(l.rate)}%`, egp(l.recognized), pts(l.recognized)]),
        { pg: 'families' },
      ),
    );
  }
  if (r.imputedHead) out.append(h('div', { class: 'muted small', style: { margin: '6px 4px' }, text: `دخل مفترض على رب الأسرة الرافض (في منظور الأسرة): ${egp(r.imputedHead)}` }));
  if (r.assets.status !== 'none') out.append(h('div', { class: 'card' }, kv('أصول سائلة', egp(r.assets.liquid)), kv('الفائض بعد احتياطي 3 أشهر', egp(Math.max(0, r.assets.surplus))), kv('النصاب', egp(r.assets.nisab))));
  return out;
}

// ---------- الاعتماد ----------
function approveForm(draft, onDone) {
  const r = draft.result;
  openSheet('اعتماد التقييم', (body, close) => {
    const err = errorBox();
    const from = effectiveMonthSelect(ctx.nowMonth());
    const cur = entitlementAt(S(), draft.familyId, ctx.nowMonth());
    const setAmount = checkbox('وافقت اللجنة على تحديث المبلغ الشهري للأسرة', r.monthly.amount > 0);
    const pct = selectInput([100, 90, 80, 75, 70, 60, 50, 40, 30, 25].map((p) => ({ value: String(p), label: `${p}% من المستحق` })), '100');
    const amount = moneyInput(suggestedApprovedMonthly(r, ctx.steps().money, 100));
    const note = textArea('', 'ملاحظة / سبب القرار (اختياري)');
    const amountBox = h('div', {}, h('div', { class: 'grid2' }, field('نسبة الاستحقاق المعتمدة', pct), field('المبلغ الشهري المعتمد (جنيه)', amount)));
    const info = h('div', { class: 'preview' });
    const draw = () => {
      amountBox.style.display = setAmount.input.checked ? '' : 'none';
      clear(info);
      info.append(h('div', { class: 'pl' }, h('span', { text: 'المستحق حسب الحاسبة' }), h('span', { class: 'num', text: egp(r.monthly.amount) })));
      info.append(h('div', { class: 'pl' }, h('span', { text: 'المبلغ الشهري الحالي للأسرة' }), h('span', { class: 'num', text: F.egp(cur) })));
      const a = amount.units();
      if (setAmount.input.checked && a !== null && a > poundsToUnits(r.monthly.amount)) info.append(h('div', { class: 'pl neg' }, h('span', { text: 'تنبيه: المبلغ المعتمد أكبر من العجز' }), h('span', {})));
    };
    pct.addEventListener('change', () => (amount.setUnits(suggestedApprovedMonthly(r, ctx.steps().money, Number(pct.value))), draw()));
    [setAmount.input, amount].forEach((el) => el.addEventListener('input', draw));
    draw();
    const save = async () => {
      const monthly = setAmount.input.checked ? amount.units() : null;
      if (setAmount.input.checked && monthly === null) return err.show('أدخل المبلغ المعتمد');
      try {
        await ctx.store.run((book) => approveAssessment(book, draft, { monthly, appliedFrom: from.value, estimate: draft.committee?.estimate ?? null, note: note.value.trim() }, { now: new Date() }));
        toast('تم الاعتماد وتحديث ملف الأسرة');
        close(true);
        onDone();
      } catch (e) {
        err.show(e.message);
      }
    };
    body.append(
      err,
      h('p', { class: 'muted', text: 'الاعتماد يحفظ التقييم ثابتاً (المدخلات + النتيجة + نسخة الإعداد) ويحدّث ملف الأسرة من الشهر المختار: عدد الأفراد، درجة الاحتياج، الفئات — والمبلغ الشهري فقط إن وافقت اللجنة. لا تُنشأ أي حركة مالية.' }),
      info,
      field('يسري من شهر', from),
      setAmount,
      amountBox,
      field('ملاحظة', note),
      h('button', { class: 'btn primary block', type: 'button', text: 'اعتماد', onclick: save }),
    );
  });
}

// ---------- عرض تقييم محفوظ + مقارنة ----------
export function assessmentScreen({ id }) {
  const a = S().assessments.get(id);
  if (!a) return { title: 'تقييم', body: empty('التقييم غير موجود') };
  const fam = S().families.get(a.familyId);
  const st = ui(`assessment:${id}`, { cmp: '' });
  const body = h('div', {});
  const ver = { version: a.configVersion, config: (S().needConfigs.find((c) => c.version === a.configVersion) || needConfigAt(S(), a.evalDate)).config };
  const c = a.committee || {};
  body.append(
    h(
      'div',
      { class: 'card' },
      kv('الحالة', a.status === 'approved' ? 'معتمد' : 'مسودة', a.status === 'approved' ? 'pos' : '', { secret: false }),
      kv('تاريخ التقييم', F.date(a.date), '', { secret: false }),
      a.appliedFrom ? kv('يسري من', F.month(a.appliedFrom), '', { secret: false }) : null,
      c.estimate !== null && c.estimate !== undefined ? kv('تقدير اللجنة', egp(c.estimate)) : null,
      c.monthly !== null && c.monthly !== undefined ? kv('المبلغ الشهري المعتمد', F.egp(c.monthly)) : a.status === 'approved' ? kv('المبلغ الشهري', 'لم يتغير بهذا الاعتماد', '', { secret: false }) : null,
      c.coveragePct !== null && c.coveragePct !== undefined ? kv('نسبة الاستحقاق المعتمدة', `${F.num(c.coveragePct)}%`, '', { secret: false }) : null,
      c.note ? kv('ملاحظة اللجنة', c.note, '', { secret: false }) : null,
    ),
  );
  if (a.status === 'draft') {
    body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', text: 'متابعة التعديل', onclick: () => ctx.nav(`#/assess/${a.familyId}/${a.id}`) }), h('button', { class: 'btn primary', text: 'اعتماد', onclick: () => approveForm(a, () => ctx.nav(`#/family/${a.familyId}`)) })));
  }
  const others = familyAssessments(S(), a.familyId).filter((x) => x.id !== id);
  if (others.length) {
    const sel = selectInput(others.map((x) => ({ value: x.id, label: `${F.date(x.date)} — ${x.result.categoryLabel}${x.status === 'draft' ? ' (مسودة)' : ''}` })), st.cmp, { placeholder: 'قارن بتقييم آخر…' });
    sel.addEventListener('change', () => ((st.cmp = sel.value), ctx.refresh()));
    body.append(field('مقارنة', sel));
    const o = S().assessments.get(st.cmp);
    if (o) {
      const [older, newer] = o.date <= a.date ? [o, a] : [a, o];
      const cmp = compareAssessments(older, newer);
      const fmt = (v, t) => (v === null || v === undefined ? '—' : t === 'egp' ? egp(v) : t === 'units' ? F.egp(v) : t === 'num' ? F.num(v) : String(v));
      body.append(
        table([{ label: 'البند' }, { label: F.date(older.date), num: true }, { label: F.date(newer.date), num: true }], cmp.rows.map(([k, x, y, t]) => [k, fmt(x, t), fmt(y, t)]), { pg: 'families' }),
        cmp.flagsAdded.length ? h('div', { class: 'card' }, h('div', { class: 'muted small', text: 'علامات استجدّت' }), h('ul', { class: 'flag-list' }, cmp.flagsAdded.map((f) => h('li', { text: L('flags', f) })))) : null,
        cmp.flagsRemoved.length ? h('div', { class: 'card' }, h('div', { class: 'muted small', text: 'علامات زالت' }), h('ul', { class: 'flag-list' }, cmp.flagsRemoved.map((f) => h('li', { text: L('flags', f) })))) : null,
      );
    }
  }
  body.append(resultCard(a.result, ver));
  return { title: `تقييم: ${fam?.name || ''}`, subtitle: `${a.result.categoryLabel} — ${F.month(a.evalDate)}`, body };
}

// ---------- قسم الحاسبة في ملف الأسرة ----------
const FILE_STATUS = { open: ['مفتوح', 'warn'], approved: ['موافق عليه', 'info'], paid: ['سُدّد', 'ok'], rejected: ['مرفوض', 'bad'], closed: ['مغلق', ''] };
const DEBT_CAUSES = { 'urgent-medical': 'علاج عاجل', rent: 'إيجار', 'living-necessity': 'ضرورة معيشة', education: 'مصروفات دراسة', 'basic-kit': 'جهاز أساسي', 'necessary-repair': 'ترميم ضروري', 'daughter-trousseau-basic': 'جهاز بنت (الأساسي)', 'work-tool': 'آلة عمل', improvement: 'تحسين مباح (دهان/سيراميك)', luxury: 'كماليات / إسراف', gambling: 'قمار', drugs: 'مخدرات', 'other-sin': 'معصية أخرى' };
const ONEOFF_TYPES = { 'marriage-basics': 'جهاز عروس (الأساسي)', 'basic-kit': 'جهاز أساسي', medical: 'علاج', repair: 'ترميم', empowerment: 'تمكين (آلة / رأس مال)' };

export function familyNeedSection(familyId) {
  const out = [];
  const cur = currentAssessment(S(), familyId);
  const all = familyAssessments(S(), familyId);
  out.push(sectionTitle('تقييم الاحتياج', h('button', { text: all.length ? 'إعادة التقييم' : 'تقييم الاحتياج', onclick: () => ctx.nav(`#/assess/${familyId}`) })));
  if (!all.length) out.push(empty('لم تُقيَّم بعد — الحاسبة تقترح الفئة والمبلغ وطريقة التسليم، واللجنة تعتمد.'));
  if (cur) {
    const due = cur.result.reviewBy <= ctx.nowMonth();
    out.push(
      h(
        'div',
        { class: 'card' },
        kv('الفئة', cur.result.categoryLabel, '', { secret: false }),
        kv('العجز الشهري', `${egp(cur.result.G)} (${F.num(cur.result.gPct)}%)`),
        kv('المستحق حسب الحاسبة', egp(cur.result.monthly.amount)),
        cur.committee?.coveragePct !== null && cur.committee?.coveragePct !== undefined ? kv('نسبة الاستحقاق المعتمدة', `${F.num(cur.committee.coveragePct)}%`, '', { secret: false }) : null,
        kv('طريقة التسليم', L('mode', cur.result.monthly.mode), '', { secret: false }),
        kv('مصدر المال', L('source', cur.result.monthly.source), '', { secret: false }),
        kv('موعد المراجعة', `${F.month(cur.result.reviewBy)}${due ? ' — حلّ' : ''}`, due ? 'neg' : '', { secret: false }),
      ),
    );
  }
  if (all.length) {
    out.push(h('div', { class: 'muted small', style: { margin: '8px 4px 4px' }, text: 'سجل التقييمات (تغيّر الاستحقاق مع الوقت)' }));
    out.push(
      list(
        all.map((a) =>
          row({
            title: `${F.date(a.date)} — ${a.result.categoryLabel}`,
            subtitle: [`عجز ${F.num(a.result.gPct)}%`, a.committee?.coveragePct !== null && a.committee?.coveragePct !== undefined ? `معتمد ${F.num(a.committee.coveragePct)}%` : '', a.appliedFrom ? `من ${F.month(a.appliedFrom)}` : ''].filter(Boolean).join(' · '),
            value: egp(a.result.monthly.amount),
            badge: a.status === 'draft' ? badge('مسودة', 'warn') : badge('معتمد', 'ok'),
            onclick: () => ctx.nav(`#/assessment/${a.id}`),
            pk: 'families|assessments',
          }),
        ),
      ),
    );
  }
  // ملفات مستقلة لا تدخل العجز الشهري
  const files = [...S().needFiles.values()].filter((f) => f.familyId === familyId && !f.archived).sort((a, b) => (a.date < b.date ? 1 : -1));
  out.push(sectionTitle('ديون وطلبات «مرة واحدة»', h('span', {}, h('button', { text: '+ دين', onclick: () => debtForm(familyId) }), ' ', h('button', { text: '+ طلب', onclick: () => oneOffForm(familyId) }))));
  if (!files.length) out.push(empty('لا ملفات — الديون والجهاز والعلاج والترميم والتمكين ملفات مستقلة عن الشهري.'));
  else
    out.push(
      list(
        files.map((f) => {
          const sb = FILE_STATUS[f.status] || ['', ''];
          const isDebt = f.kind === 'debt';
          return row({
            title: isDebt ? `دين: ${DEBT_CAUSES[f.data.cause] || f.data.cause} — ${f.result?.label || ''}` : `${ONEOFF_TYPES[f.data.type] || f.data.type}`,
            subtitle: `${F.date(f.date)} · ${isDebt ? L('source', f.result?.source) : `السقف المقترح ${egp(f.result?.approvedMax ?? 0)}`}`,
            value: egp(isDebt ? f.data.amount || 0 : f.data.requested || 0),
            badge: badge(sb[0], sb[1]),
            onclick: () => fileSheet(f),
            pk: 'families|needfiles',
          });
        }),
      ),
    );
  return out;
}

function fileSheet(f) {
  const isDebt = f.kind === 'debt';
  openSheet(isDebt ? 'ملف دين' : 'طلب مرة واحدة', (body, close) => {
    const r = f.result || {};
    const set = (status) => async () => {
      try {
        await ctx.store.dispatch('need.file.upsert', { id: f.id, status });
        toast('تم');
        close(true);
      } catch (e) {
        toast(e.message, 'bad');
      }
    };
    body.append(
      h(
        'div',
        { class: 'card' },
        isDebt ? kv('السبب', DEBT_CAUSES[f.data.cause] || f.data.cause, '', { secret: false }) : kv('النوع', ONEOFF_TYPES[f.data.type] || f.data.type, '', { secret: false }),
        kv(isDebt ? 'المبلغ' : 'المطلوب', egp(isDebt ? f.data.amount || 0 : f.data.requested || 0)),
        isDebt ? kv('التصنيف', `${r.label} — أولوية ${F.num(r.priority)}`, '', { secret: false }) : kv('السقف المقترح', egp(r.approvedMax ?? 0)),
        isDebt ? kv('يُسدَّد الآن؟', r.eligibleNow ? `نعم — ${egp(r.payable)}` : 'لا', r.eligibleNow ? 'pos' : '', { secret: false }) : kv('مؤهل؟', r.eligible ? 'نعم' : 'لا', r.eligible ? 'pos' : 'neg', { secret: false }),
        kv('المصدر', L('source', r.source), '', { secret: false }),
        !isDebt ? kv('التسليم', L('mode', r.mode), '', { secret: false }) : null,
        f.note ? kv('ملاحظة', f.note, '', { secret: false }) : null,
      ),
      h('ul', { class: 'flag-list' }, (isDebt ? r.actions || [] : r.conditions || []).map((x) => h('li', { text: L(isDebt ? 'debt' : 'oneOff', x) }))),
      h('div', { class: 'muted small', style: { margin: '8px 0' }, text: 'الحاسبة تقترح والقرار للجنة. الصرف الفعلي يُسجَّل حركةً عادية (للدائن أو الجهة مباشرة).' }),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: 'موافقة', onclick: set('approved') }), h('button', { class: 'btn small', text: isDebt ? 'سُدّد' : 'نُفّذ', onclick: set('paid') }), h('button', { class: 'btn small', text: 'رفض', onclick: set('rejected') }), h('button', { class: 'btn small', text: 'إغلاق الملف', onclick: set('closed') })),
    );
  });
}

function debtForm(familyId) {
  openSheet('ملف دين', (body, close) => {
    const err = errorBox();
    const d = { cause: 'urgent-medical', due: 'overdue' };
    const out = h('div', { class: 'preview' });
    const draw = () => {
      clear(out);
      const r = classifyDebt({ ...d, threat: d.threat || undefined });
      out.append(h('div', { class: 'pl' }, h('span', { text: 'التصنيف' }), h('span', { text: `${r.label} (أولوية ${F.num(r.priority)})` })));
      out.append(h('div', { class: 'pl' }, h('span', { text: 'المصدر' }), h('span', { text: L('source', r.source) })));
      out.append(h('div', { class: 'pl' }, h('span', { text: 'يُسدَّد الآن' }), h('span', { class: `num ${r.eligibleNow ? 'pos' : ''}`, text: r.eligibleNow ? egp(r.payable) : 'لا' })));
      for (const a of r.actions) out.append(h('div', { class: 'pl muted' }, h('span', { text: '• ' + L('debt', a) }), h('span', {})));
    };
    const note = textInput('', 'الدائن / ملاحظة');
    body.addEventListener('input', draw);
    body.addEventListener('change', draw);
    body.append(
      err,
      field('سبب الدين', selField(d, 'cause', opts(DEBT_CAUSES), { def: '__' })),
      h('div', { class: 'grid2' }, field('المبلغ (جنيه)', numField(d, 'amount')), field('الأجل', selField(d, 'due', [{ value: 'overdue', label: 'حالّ' }, { value: 'near', label: 'قريب الحلول' }, { value: 'later', label: 'لم يحن' }], { def: '__' }))),
      field('تهديد', selField(d, 'threat', [{ value: '', label: 'لا يوجد' }, { value: 'prison', label: 'حبس (إيصال أمانة)' }, { value: 'eviction', label: 'طرد من السكن' }], { def: '' })),
      boolField(d, 'unable', 'عاجز عن السداد (مثبت)'),
      boolField(d, 'riba', 'فيه فوائد ربوية / تقسيط استهلاكي'),
      boolField(d, 'repented', 'توبة ظاهرة (لديون المعصية)'),
      out,
      field('ملاحظة', note),
      h('button', {
        class: 'btn primary block',
        type: 'button',
        text: 'حفظ الملف',
        onclick: async () => {
          if (!d.amount) return err.show('أدخل مبلغ الدين');
          try {
            await ctx.store.dispatch('need.file.upsert', { id: newId('nf-'), kind: 'debt', familyId, date: ctx.today(), status: 'open', data: { ...d }, result: classifyDebt(d), note: note.value.trim() });
            toast('حُفظ ملف الدين');
            close(true);
          } catch (e) {
            err.show(e.message);
          }
        },
      }),
    );
    draw();
  });
}

function oneOffForm(familyId) {
  const cur = currentAssessment(S(), familyId);
  openSheet('طلب مرة واحدة', (body, close) => {
    const err = errorBox();
    const q = { type: 'medical' };
    const out = h('div', { class: 'preview' });
    const calc = () => assessOneOff({ type: q.type, requested: q.requested || 0 }, cur ? cur.result : null, needConfigAt(S(), ctx.nowMonth()).config);
    const draw = () => {
      clear(out);
      const r = calc();
      out.append(h('div', { class: 'pl' }, h('span', { text: 'مؤهل' }), h('span', { class: r.eligible ? 'pos' : 'neg', text: r.eligible ? 'نعم' : 'لا' })));
      out.append(h('div', { class: 'pl' }, h('span', { text: 'السقف المقترح' }), h('span', { class: 'num', text: egp(r.approvedMax) })));
      out.append(h('div', { class: 'pl' }, h('span', { text: 'التسليم' }), h('span', { text: L('mode', r.mode) })));
      for (const c of r.conditions) out.append(h('div', { class: 'pl muted' }, h('span', { text: '• ' + L('oneOff', c) }), h('span', {})));
    };
    const note = textInput('', 'تفاصيل / الجهة');
    body.addEventListener('input', draw);
    body.addEventListener('change', draw);
    body.append(
      err,
      cur ? null : h('div', { class: 'banner info', text: 'الأسرة بلا تقييم معتمد — قيّمها أولاً ليُحسب التأهل بدقة.' }),
      field('النوع', selField(q, 'type', opts(ONEOFF_TYPES), { def: '__' })),
      field('المبلغ المطلوب (جنيه)', numField(q, 'requested')),
      out,
      field('ملاحظة', note),
      h('button', {
        class: 'btn primary block',
        type: 'button',
        text: 'حفظ الطلب',
        onclick: async () => {
          if (!q.requested) return err.show('أدخل المبلغ المطلوب');
          try {
            await ctx.store.dispatch('need.file.upsert', { id: newId('nf-'), kind: 'oneoff', familyId, date: ctx.today(), status: 'open', data: { type: q.type, requested: q.requested }, result: calc(), note: note.value.trim() });
            toast('حُفظ الطلب');
            close(true);
          } catch (e) {
            err.show(e.message);
          }
        },
      }),
    );
    draw();
  });
}

// ---------- مراجعات مستحقة ----------
export function reviewsScreen() {
  const due = dueReviews(S(), ctx.nowMonth());
  const never = [...S().families.values()].filter((f) => !f.archived && !currentAssessment(S(), f.id)).sort((a, b) => collator.compare(a.name, b.name));
  const body = h('div', {});
  body.append(sectionTitle(`مراجعات حلّ موعدها (${F.num(due.length)})`));
  body.append(due.length ? list(due.map((d) => row({ title: d.family.name, subtitle: `موعد المراجعة ${F.month(d.reviewBy)} · ${d.assessment.result.categoryLabel}`, badge: badge(d.reviewBy < ctx.nowMonth() ? 'فات' : 'حلّ', d.reviewBy < ctx.nowMonth() ? 'bad' : 'warn'), onclick: () => ctx.nav(`#/family/${d.family.id}`) }))) : empty('لا مراجعات مستحقة'));
  body.append(sectionTitle(`أسر بلا تقييم معتمد (${F.num(never.length)})`));
  body.append(never.length ? list(never.map((f) => row({ title: f.name, subtitle: 'اضغط لبدء التقييم', onclick: () => ctx.nav(`#/assess/${f.id}`) }))) : empty('كل الأسر مقيَّمة'));
  return { title: 'مراجعات التقييم', body };
}

// ---------- توزيع الشهر ----------
export function allocationScreen() {
  const st = ui('allocation', { zakat: null, sadaqa: null, roundTo: 10, tier: true, edits: {}, zAcct: 'general', sAcct: 'general', month: ctx.nowMonth() });
  const body = h('div', {});
  const z = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', value: st.zakat ?? '' });
  const s = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', value: st.sadaqa ?? '' });
  z.addEventListener('change', () => ((st.zakat = parseInt0(z.value)), (st.edits = {}), ctx.refresh()));
  s.addEventListener('change', () => ((st.sadaqa = parseInt0(s.value)), (st.edits = {}), ctx.refresh()));
  const round = selectInput([1, 10, 50, 100].map((n) => ({ value: String(n), label: n === 1 ? 'بلا تقريب' : `لأقرب ${n}` })), String(st.roundTo));
  round.addEventListener('change', () => ((st.roundTo = Number(round.value)), (st.edits = {}), ctx.refresh()));
  const tier = checkbox('تقديم «شديد الاحتياج» كاملاً ثم «محتاج» ثم «جزئي»', st.tier);
  tier.input.addEventListener('change', () => ((st.tier = tier.input.checked), (st.edits = {}), ctx.refresh()));
  const prop = proposeMonthAllocation(S(), { zakat: st.zakat || 0, sadaqa: st.sadaqa || 0, roundTo: st.roundTo, tierPriority: st.tier });
  body.append(h('p', { class: 'muted', text: 'أدخل ميزانية الزكاة وميزانية الصدقة لهذا الشهر: الحاسبة تقترح نصيب كل أسرة (لا تتجاوز أسرة عجزها)، وتعدّله قبل تحويله إلى حركات صرف.' }), h('div', { class: 'grid2' }, field('ميزانية الزكاة (جنيه)', z), field('ميزانية الصدقة (جنيه)', s)), h('div', { class: 'grid2' }, field('التقريب', round), field('شهر الاستحقاق', (() => {
    const m = selectInput(monthOptions(addMonths(ctx.nowMonth(), -2), addMonths(ctx.nowMonth(), 3)), st.month);
    m.addEventListener('change', () => ((st.month = m.value), ctx.refresh()));
    return m;
  })())), tier);
  if (!prop.rows.length) {
    body.append(empty('لا أسر لها تقييم معتمد بمبلغ مستحق — قيّم الأسر واعتمد أولاً.'), h('div', { class: 'btn-row' }, h('button', { class: 'btn', text: 'أسر تحتاج تقييماً', onclick: () => ctx.nav('#/reviews') })));
    return { title: 'توزيع الشهر', body };
  }
  const val = (r, k) => st.edits[r.id]?.[k] ?? r[k];
  let totZ = 0;
  let totS = 0;
  const cards = prop.rows.map((r) => {
    const zi = h('input', { class: 'num-cell', type: 'text', inputMode: 'numeric', autocomplete: 'off', value: val(r, 'zakat'), 'aria-label': `زكاة ${r.name}`, disabled: r.source === 'sadaqa-only' });
    const si = h('input', { class: 'num-cell', type: 'text', inputMode: 'numeric', autocomplete: 'off', value: val(r, 'sadaqa'), 'aria-label': `صدقة ${r.name}` });
    const upd = (k, el) => () => {
      st.edits[r.id] = { ...(st.edits[r.id] || {}), [k]: parseInt0(el.value) ?? 0 };
      ctx.refresh();
    };
    zi.addEventListener('change', upd('zakat', zi));
    si.addEventListener('change', upd('sadaqa', si));
    const total = val(r, 'zakat') + val(r, 'sadaqa');
    totZ += val(r, 'zakat');
    totS += val(r, 'sadaqa');
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'kv' }, h('span', { class: 'k', text: r.name }), h('span', { class: 'v' }, badge(L('category', r.category), r.category === 'severe' ? 'bad' : r.category === 'needy' ? 'warn' : 'info'))),
      h('div', { class: 'muted small', text: `المستحق ${egp(r.due)} · المقترح ${egp(total)} · التغطية ${F.num(Math.round((100 * total) / r.due))}%${total > r.due ? ' — يتجاوز العجز!' : ''} · ${L('source', r.source)}` }),
      h('div', { class: 'grid2', style: { marginTop: '6px' } }, field('من الزكاة', zi), field('من الصدقة', si)),
    );
  });
  const over = prop.rows.filter((r) => val(r, 'zakat') + val(r, 'sadaqa') > r.due).length;
  const zA = selectInput(acctOptions({ earmarks: false }), st.zAcct);
  const sA = selectInput(acctOptions({ earmarks: false }), st.sAcct);
  zA.addEventListener('change', () => (st.zAcct = zA.value));
  sA.addEventListener('change', () => (st.sAcct = sA.value));
  body.append(
    h('div', { class: 'stats' }, stat('إجمالي المستحق', egp(prop.due), { pk: 'families|alloc-due' }), stat('المقترح', egp(totZ + totS), { cls: 'primary', hint: `زكاة ${egp(totZ)} + صدقة ${egp(totS)}`, pk: 'families|alloc-total' }), stat('التغطية', `${F.num(prop.due ? Math.round((100 * (totZ + totS)) / prop.due) : 0)}%`, { pk: 'families|alloc-pct' }), stat('باقي الميزانية', egp((st.zakat || 0) + (st.sadaqa || 0) - totZ - totS), { pk: 'families|alloc-left' })),
    over ? h('div', { class: 'banner bad', text: `${F.num(over)} أسرة مبلغها يتجاوز عجزها المعتمد.` }) : null,
    cards,
    h('div', { class: 'grid2' }, field('الزكاة تُصرف من', zA), field('الصدقة تُصرف من', sA)),
    h('button', {
      class: 'btn primary block',
      text: 'تحويل إلى حركات صرف',
      disabled: totZ + totS === 0,
      onclick: async () => {
        const date = ctx.today();
        const batchId = newId('b-');
        const mvs = [];
        const zp = S().lists.purposes.has('p-zakat-mal') ? 'p-zakat-mal' : undefined;
        const sp = S().lists.purposes.has('p-sadaqa') ? 'p-sadaqa' : undefined;
        for (const r of prop.rows) {
          for (const [k, acct, purposeId] of [['zakat', st.zAcct, zp], ['sadaqa', st.sAcct, sp]]) {
            const pounds = val(r, k);
            if (!pounds) continue;
            const amount = poundsToUnits(pounds);
            // بنود الصرف بالتدفق الموجود: استحقاق الشهور الأقدم أولاً ثم إضافة
            const lines = suggestFamilyAllocation(S(), r.id, amount, `${st.month}-15` > date ? date : date).map((l) => ({ ...l, ...(purposeId ? { purposeId } : {}) }));
            mvs.push({ kind: 'distribution', date, familyId: r.id, acct, amount, lines, batchId, note: `توزيع ${F.month(st.month)} — ${k === 'zakat' ? 'زكاة' : 'صدقة'}` });
          }
        }
        if (!(await confirmDialog({ title: 'تحويل الاقتراح إلى حركات صرف', message: `${F.num(mvs.length)} حركة بإجمالي ${egp(totZ + totS)}.${over ? '\nتنبيه: بعض الأسر تتجاوز عجزها.' : ''}`, okText: 'تنفيذ الصرف' }))) return;
        try {
          await ctx.store.run((book) => executeBatch(book, mvs, { now: new Date() }));
          toast(`تم صرف ${F.num(mvs.length)} حركة`);
          Object.assign(st, { zakat: null, sadaqa: null, edits: {} });
          ctx.refresh();
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    }),
  );
  void unitsToPounds;
  void ymOf;
  void profileAt;
  return { title: 'توزيع الشهر', subtitle: 'اقتراح الحاسبة قابل للتعديل', body };
}

// ---------- إعداد الحاسبة (نسخ مؤرخة) ----------
const CFG_NUMBERS = [
  ['R', 'المرجع R (جنيه) — النقطة = R ÷ 100'],
  ['gold21PricePerGram', 'سعر جرام الذهب عيار 21'],
  ['dailyWage', 'اليومية (جنيه)'],
  ['imputedWorkDays', 'أيام الشهر المرجعي للقادر'],
  ['chronicOtherMax', 'سقف المرض المزمن الآخر شهرياً'],
];
const CFG_NESTED = [
  ['thresholds', 'stopPct', 'عتبة «مكتفٍ» (العجز ≤ %)'],
  ['thresholds', 'partialBelowPct', 'عتبة «محتاج» (العجز ≥ %)'],
  ['thresholds', 'severeFromPct', 'عتبة «شديد الاحتياج» (العجز ≥ %)'],
  ['incomeRates', 'voluntary', 'نسبة احتساب كسب المرأة والطالب الجاد %'],
  ['protection', 'dependentsFloorPct', 'حماية معالي الرافض %'],
  ['protection', 'graceMonths', 'مهلة الرافض (شهور)'],
  ['imputed', 'nonSeriousStudent', 'دخل مفترض: طالب غير جاد'],
  ['imputed', 'teenOutOfSchoolPct', 'دخل مفترض 15–17 (% من الشهر المرجعي)'],
  ['review', 'familyMonths', 'مراجعة الأسرة كل (شهور)'],
  ['gasLargeFamily', 'amount', 'غاز الأسرة الكبيرة (6+)'],
  ['weights10', 'orphans', 'وزن: أيتام (×0.1)'],
  ['weights10', 'femaleHeadNoProvider', 'وزن: أرملة/مطلقة بلا عائل (×0.1)'],
  ['weights10', 'disabilityOrChronic', 'وزن: إعاقة أو مرض مزمن (×0.1)'],
  ['weights10', 'elderNoProvider', 'وزن: مسن بلا عائل (×0.1)'],
  ['weights10', 'largeFamily', 'وزن: 6 أفراد فأكثر (×0.1)'],
  ['weights10', 'kinOrNeighbor', 'وزن: قرابة أو جوار (×0.1)'],
  ['weights10', 'seriousJobSearch', 'وزن: بحث جاد عن عمل (×0.1)'],
  ['weights10', 'max', 'الحد الأقصى للوزن (×0.1)'],
];

export function needConfigScreen() {
  const cur = needConfigAt(S(), ctx.nowMonth());
  const st = ui('needConfig', { draft: null, tab: 'main' });
  if (!st.draft) st.draft = JSON.parse(JSON.stringify(cur.config));
  const d = st.draft;
  const body = h('div', {});
  const changed = JSON.stringify(d) !== JSON.stringify(cur.config);
  body.append(
    h('div', { class: 'card' }, kv('النسخة السارية', `${F.num(cur.version)} — من ${F.month(cur.from)}`, '', { secret: false }), kv('المحرك', NEED_ENGINE_VERSION, '', { secret: false }), kv('قيمة النقطة', egp(d.R / d.pointsPerR), '', { secret: false }), cur.note ? kv('بيان', cur.note, '', { secret: false }) : null),
    h('div', { class: 'muted small', style: { margin: '0 4px 8px' }, text: 'كل رقم ووزن وعتبة اجتهاد إداري. التعديل ينشئ نسخة جديدة تسري من شهرها ولا تمس تقييمات الماضي ولا أي مبلغ معتمد.' }),
    chips(
      [
        { value: 'main', label: 'الأرقام الأساسية' },
        { value: 'items', label: 'جدول الأسعار' },
        { value: 'weights', label: 'النِّسب والأوزان والعتبات' },
        { value: 'history', label: 'النسخ' },
      ],
      st.tab,
      (v) => ((st.tab = v), ctx.refresh()),
    ),
  );
  const cell = (obj, key) => {
    const el = h('input', { class: 'num-cell', type: 'text', inputMode: 'numeric', autocomplete: 'off', value: obj[key] });
    el.addEventListener('change', () => {
      const v = parseInt0(el.value);
      if (v !== null) obj[key] = v;
      ctx.refresh();
    });
    return el;
  };
  if (st.tab === 'main') for (const [k, label] of CFG_NUMBERS) body.append(h('div', { class: 'cfg-row two' }, h('span', { text: label }), cell(d, k)));
  else if (st.tab === 'items') {
    body.append(h('div', { class: 'cfg-row head' }, h('span', { text: 'البند' }), h('span', { text: 'الأدنى' }), h('span', { text: 'المعتاد' }), h('span', { text: 'الأعلى' })));
    for (const it of Object.values(d.items)) body.append(h('div', { class: 'cfg-row' }, h('span', { text: it.label }), cell(it, 'min'), cell(it, 'typ'), cell(it, 'max')));
  } else if (st.tab === 'weights') for (const [g, k, label] of CFG_NESTED) body.append(h('div', { class: 'cfg-row two' }, h('span', { text: label }), cell(d[g], k)));
  else {
    const all = S().needConfigs.length ? [...S().needConfigs].reverse() : [cur];
    body.append(list(all.map((c) => row({ title: `نسخة ${F.num(c.version)} — من ${F.month(c.from)}`, subtitle: [c.note, c.ts && c.ts > '2001' ? F.dateTime(c.ts) : ''].filter(Boolean).join(' · '), badge: c.version === cur.version ? badge('سارية', 'ok') : null }))));
  }
  if (changed) {
    const impact = recalcWithConfig(S(), d);
    body.append(sectionTitle(`أثر التعديل على التقييمات السارية (${F.num(impact.length)} أسرة تتغير)`));
    body.append(
      impact.length
        ? list(impact.map((x) => row({ title: x.family.name, subtitle: x.error ? x.error : `${x.before.categoryLabel}${x.categoryChanged ? ` ← ${x.after.categoryLabel}` : ''} · المستحق ${egp(x.before.monthly.amount)} ← ${egp(x.after.monthly.amount)}`, badge: x.categoryChanged ? badge('تتغير الفئة', 'warn') : null, onclick: () => ctx.nav(`#/family/${x.family.id}`) })))
        : empty('لا أسرة تتغير فئتها أو مبلغها'),
    );
    const from = effectiveMonthSelect(ctx.nowMonth());
    const note = textInput('', 'بيان التعديل (مثلاً: تحديث أسعار الربع)');
    body.append(
      h('div', { class: 'grid2' }, field('تسري من شهر', from), field('بيان', note)),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn', text: 'تراجع عن التعديل', onclick: () => ((st.draft = null), ctx.refresh()) }),
        h('button', {
          class: 'btn primary',
          text: 'حفظ نسخة جديدة',
          onclick: async () => {
            try {
              const version = nextNeedConfigVersion(S());
              await ctx.store.dispatch('need.config.set', { from: from.value, version, config: { ...d, configVersion: `${from.value}#${version}` }, note: note.value.trim() });
              toast(`حُفظت النسخة ${version} — المبالغ المعتمدة لم تتغير`);
              st.draft = null;
              ctx.refresh();
            } catch (e) {
              toast(e.message, 'bad');
            }
          },
        }),
      ),
    );
  }
  return { title: 'إعداد حاسبة الاحتياج', subtitle: `نسخة ${F.num(cur.version)}`, body };
}
