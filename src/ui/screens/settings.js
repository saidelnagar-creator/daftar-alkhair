// الإعدادات، النسخ الاحتياطي، الإقفال السنوي، الأرشيف.
import { h, clear } from '../dom.js';
import { ctx, F } from '../ctx.js';
import { row, list, empty, sectionTitle, kv, badge, field, textInput, moneyInput, intInput, selectInput, toast, confirmDialog, openSheet, errorBox, saveFile, table, stat, monthOptions } from '../components.js';
import { ui } from '../widgets.js';
import { APP_VERSION } from '../../config/version.js';
import { RULES } from '../../config/rules.js';
import { SCHEMA_VERSION } from '../../core/migrations/index.js';
import { parseBackup, planImport } from '../../core/backup.js';
import { canEncrypt, decryptBackup, encryptBackup, isEncryptedBackup } from '../../core/crypto-backup.js';
import { readMirror } from '../../storage/mirror.js';
import { driveConfig, driveConnect, driveDisconnect, driveFetchBackup, driveRedirectUri, driveStatus, driveSyncNow } from '../../storage/drive-sync.js';
import { redactNeedEvents } from '../../core/need.js';
import { closedThrough, firstFiscalYear, pointValueAt, acctLabel, activeClosing } from '../../core/engine.js';
import { previewClose, closeYear, reopenYear, verifyCheckpoint, closedYears, yearFlows } from '../../core/closing.js';
import { sha256 } from '../../core/sha256.js';
import { addMonths, newId } from '../../core/util.js';
import { normalizeDigits } from '../../core/money.js';

const S = () => ctx.state;
const set = async (key, value, msg = 'تم الحفظ') => {
  try {
    await ctx.store.dispatch('settings.set', { key, value });
    toast(msg);
    return true;
  } catch (e) {
    toast(e.message, 'bad');
    return false;
  }
};

// ---------- الإعدادات ----------
export function settingsScreen() {
  const st = S().settings;
  const body = h('div', {});
  const name = textInput(st.orgName);
  body.append(sectionTitle('عام'));
  body.append(
    h(
      'div',
      { class: 'card' },
      field('اسم الصندوق / الجهة', name),
      h('button', { class: 'btn small', text: 'حفظ الاسم', onclick: () => name.value.trim() && set('orgName', name.value.trim()) }),
      h('div', { style: { height: '12px' } }),
      field(
        'شكل الأرقام',
        Object.assign(
          selectInput(
            [
              { value: 'latn', label: '0 1 2 3' },
              { value: 'arab', label: '٠ ١ ٢ ٣' },
            ],
            st.digits,
          ),
          { onchange: (e) => set('digits', e.target.value) },
        ),
      ),
      field(
        'التذكير بالنسخة الاحتياطية',
        Object.assign(
          selectInput(
            [
              { value: '3', label: 'كل 3 أيام' },
              { value: '7', label: 'كل أسبوع' },
              { value: '14', label: 'كل أسبوعين' },
              { value: '30', label: 'كل شهر' },
              { value: '0', label: 'بدون تذكير' },
            ],
            String(st.backupReminderDays ?? RULES.backupReminderDays),
          ),
          { onchange: (e) => set('backupReminderDays', Number(e.target.value)) },
        ),
      ),
    ),
  );

  // بداية الدفاتر
  const first = firstFiscalYear(S());
  body.append(sectionTitle('السنة المالية'));
  const fy = intInput(first);
  body.append(
    h(
      'div',
      { class: 'card' },
      kv('السنة المفتوحة الحالية', F.num(ctx.fiscalYear())),
      kv('آخر سنة مقفولة', closedThrough(S()) !== null ? F.num(closedThrough(S())) : 'لا يوجد'),
      closedThrough(S()) === null
        ? h('div', {}, field('أول سنة في الدفاتر', fy, 'ما يُسجَّل بتاريخ قبلها يُحسب ضمنها'), h('button', { class: 'btn small', text: 'حفظ', onclick: () => set('firstFiscalYear', Number(normalizeDigits(fy.value))) }))
        : null,
      h('button', { class: 'btn small', style: { marginTop: '8px' }, text: 'الإقفال السنوي والأرشيف', onclick: () => ctx.nav('#/closing') }),
    ),
  );

  // الخانات العشرية
  const pr = ctx.precision();
  const decLabel = (n) => (n === 0 ? 'أرقام صحيحة بلا كسور' : n === 1 ? 'خانة عشرية واحدة' : n === 2 ? 'خانتان عشريتان' : '3 خانات عشرية');
  body.append(sectionTitle('الخانات العشرية'));
  body.append(
    h(
      'div',
      { class: 'card' },
      kv('المبالغ (جنيه)', decLabel(pr.money)),
      kv('الكميات العينية', decLabel(pr.qty)),
      kv('الذهب والأصول', decLabel(pr.asset)),
      h('p', { class: 'muted small', text: 'تحدد ما يُقبل في الإدخال وكيف تُقرَّب الحسابات. التغيير يسري من الشهر الذي تختاره ولا يمس ما قبله.' }),
      h('button', { class: 'btn small', text: 'تغيير الخانات العشرية', onclick: precisionForm }),
    ),
  );

  // نقاط الاستحقاق
  const crit = st.criteria;
  body.append(sectionTitle('نقاط الاستحقاق الموحّدة'));
  const pv = pointValueAt(S(), ctx.nowMonth());
  body.append(
    h(
      'div',
      { class: 'card' },
      h('p', { class: 'muted small', style: { marginTop: 0 }, text: 'نقاط الأسرة = (عدد الأفراد × نقاط الفرد) + نقاط درجة الاحتياج + نقاط الحالات + تعديل يدوي. الدعم الشهري المقترح = النقاط × قيمة النقطة.' }),
      kv('قيمة النقطة الحالية', F.egp(pv)),
      kv('نقاط لكل فرد', F.num(crit.perMember)),
      ...crit.needLevels.map((l) => kv(`احتياج ${l.name}`, `+${F.num(l.points)}`)),
      ...crit.flags.map((f) => kv(f.name, `+${F.num(f.points)}`)),
      h('div', { class: 'btn-row', style: { marginTop: '10px' } }, h('button', { class: 'btn small', text: 'تغيير قيمة النقطة', onclick: pointValueForm }), h('button', { class: 'btn small', text: 'تعديل جدول النقاط', onclick: criteriaForm })),
    ),
  );

  // القفل
  const pin = ctx.store.meta.pin;
  body.append(sectionTitle('قفل التطبيق (PIN)'));
  body.append(
    h(
      'div',
      { class: 'card' },
      kv('الحالة', pin ? 'مفعّل' : 'غير مفعّل'),
      h('p', { class: 'muted small', text: 'القفل يمنع فتح التطبيق بدون الرقم. لا يوجد استرجاع للرقم: إن نسيته فستحتاج حذف بيانات الموقع من إعدادات Safari ثم استيراد آخر نسخة احتياطية.' }),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn small', text: pin ? 'تغيير الرقم' : 'تفعيل القفل', onclick: () => pinForm() }), pin ? h('button', { class: 'btn small danger', text: 'إلغاء القفل', onclick: removePin }) : null),
    ),
  );

  body.append(sectionTitle('عن التطبيق'));
  const persisted = h('span', { text: '…' });
  if (navigator.storage?.persisted) navigator.storage.persisted().then((p) => (persisted.textContent = p ? 'مفعّل (المتصفح لن يمسح البيانات تلقائياً)' : 'غير مؤكد — انسخ احتياطياً بانتظام'));
  else persisted.textContent = 'غير مدعوم';
  body.append(h('div', { class: 'card' }, kv('إصدار التطبيق', APP_VERSION), kv('إصدار هيكل البيانات', F.num(SCHEMA_VERSION)), kv('عدد الأحداث المسجلة', F.num(ctx.store.events.length)), kv('التخزين الدائم', persisted), kv('معرّف الجهاز', (ctx.store.meta.deviceId || '').slice(0, 10))));
  return { title: 'الإعدادات', body };
}

function precisionForm() {
  openSheet('الخانات العشرية', (body, close) => {
    const err = errorBox();
    const now = ctx.nowMonth();
    const closed = closedThrough(S());
    const cur = ctx.precision();
    const from = selectInput(monthOptions(closed !== null ? `${closed + 1}-01` : addMonths(now, -36), addMonths(now, 12)), now);
    const opt = (max, labels) => labels.slice(0, max + 1).map((label, i) => ({ value: String(i), label }));
    const L = ['أرقام صحيحة بلا كسور', 'خانة عشرية واحدة (0.5)', 'خانتان عشريتان (0.25)', '3 خانات عشرية (0.125)'];
    const money = selectInput(opt(RULES.precisionMax.money, L), String(cur.money));
    const qty = selectInput(opt(RULES.precisionMax.qty, L), String(cur.qty));
    const asset = selectInput(opt(RULES.precisionMax.asset, L), String(cur.asset));
    body.append(
      err,
      h('p', { class: 'muted', text: 'يسري من الشهر المختار على كل ما يُدخل بتاريخ فيه أو بعده. ما سُجّل قبل ذلك يبقى كما هو ويُعرض بقيمته الحقيقية.' }),
      field('يسري من شهر', from),
      field('المبالغ (جنيه)', money),
      field('الكميات العينية (كجم، قطعة…)', qty),
      field('الذهب والأصول (جرام…)', asset),
      h('button', {
        class: 'btn primary block',
        text: 'حفظ',
        onclick: async () => {
          const v = { from: from.value, money: Number(money.value), qty: Number(qty.value), asset: Number(asset.value) };
          const versions = (S().settings.precision || []).filter((x) => x.from < v.from).concat(v);
          try {
            await ctx.store.dispatch('settings.set', { key: 'precision', value: versions });
            toast('تم تغيير الخانات العشرية');
            close();
          } catch (e) {
            err.show(e.message);
          }
        },
      }),
    );
  });
}

function pointValueForm() {
  openSheet('قيمة النقطة', (body, close) => {
    const err = errorBox();
    const now = ctx.nowMonth();
    const closed = closedThrough(S());
    const from = selectInput(monthOptions(closed !== null ? `${closed + 1}-01` : addMonths(now, -24), addMonths(now, 24)), now);
    const value = moneyInput(pointValueAt(S(), now));
    body.append(
      err,
      h('p', { class: 'muted', text: 'تسري القيمة الجديدة من الشهر المختار ولا تمس استحقاقات الشهور السابقة. تؤثر فقط على الأسر التي ليس لها مبلغ شهري يدوي.' }),
      field('تسري من شهر', from),
      field('قيمة النقطة (جنيه)', value),
      h('button', {
        class: 'btn primary block',
        text: 'حفظ',
        onclick: async () => {
          const v = value.units();
          if (v === null || v < 0) return err.show('قيمة غير صالحة');
          const versions = (S().settings.pointValue || []).filter((x) => x.from !== from.value).concat({ from: from.value, value: v }).sort((a, b) => (a.from < b.from ? -1 : 1));
          if (await set('pointValue', versions)) close();
        },
      }),
    );
  });
}

function criteriaForm() {
  openSheet('جدول النقاط', (body, close) => {
    const err = errorBox();
    const crit = JSON.parse(JSON.stringify(S().settings.criteria));
    const per = intInput(crit.perMember);
    const box = h('div', {});
    const inputs = [];
    const draw = () => {
      clear(box);
      inputs.length = 0;
      const line = (obj, canRemove, arr, i) => {
        const n = textInput(obj.name);
        const p = intInput(obj.points);
        inputs.push({ obj, n, p });
        return h('div', { class: 'line' }, h('div', { class: 'grid' }, n, p, canRemove ? h('button', { class: 'rm', type: 'button', text: '×', onclick: () => (collect(), arr.splice(i, 1), draw()) }) : h('span', {})));
      };
      box.append(h('div', { class: 'label muted small', text: 'درجات الاحتياج (الاسم — النقاط)' }), h('div', { class: 'lines' }, crit.needLevels.map((l) => line(l, false))));
      box.append(h('div', { class: 'label muted small', text: 'الحالات (الاسم — النقاط)' }), h('div', { class: 'lines' }, crit.flags.map((f, i) => line(f, true, crit.flags, i))));
      box.append(h('button', { class: 'btn small', type: 'button', text: '+ حالة', onclick: () => (collect(), crit.flags.push({ id: newId('fl-'), name: '', points: 1 }), draw()) }));
    };
    const collect = () => {
      for (const { obj, n, p } of inputs) {
        obj.name = n.value.trim();
        obj.points = Number(normalizeDigits(p.value || '0'));
      }
    };
    draw();
    body.append(
      err,
      field('نقاط لكل فرد', per),
      box,
      h('div', { style: { height: '12px' } }),
      h('button', {
        class: 'btn primary block',
        text: 'حفظ',
        onclick: async () => {
          collect();
          crit.perMember = Number(normalizeDigits(per.value || '0'));
          if ([...crit.needLevels, ...crit.flags].some((x) => !x.name || !Number.isInteger(x.points)) || !Number.isInteger(crit.perMember)) return err.show('أكمل الأسماء والنقاط (أعداد صحيحة)');
          if (await set('criteria', crit)) close();
        },
      }),
    );
  });
}

// بصمة الرقم السري: SHA-256 مملّحة ومكررة (تبطئ التخمين). السجلات القديمة بلا تكرار تبقى صالحة.
export const PIN_ITERATIONS = 8000;
export function pinHash(salt, pin, iterations = 0) {
  let hash = sha256(`${salt}:${pin}`);
  for (let i = 0; i < iterations; i++) hash = sha256(hash + salt);
  return hash;
}
export const pinMatches = (rec, pin) => pinHash(rec.salt, pin, rec.iter || 0) === rec.hash;
export const makePinRecord = (pin, salt = newId()) => ({ salt, iter: PIN_ITERATIONS, len: pin.length, hash: pinHash(salt, pin, PIN_ITERATIONS) });

function pinForm() {
  openSheet('رقم القفل', (body, close) => {
    const err = errorBox();
    const a = h('input', { type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: '4 إلى 8 أرقام', maxLength: 8 });
    const b = h('input', { type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'أعد الرقم', maxLength: 8 });
    body.append(
      err,
      field('الرقم الجديد', a),
      field('تأكيد الرقم', b),
      h('button', {
        class: 'btn primary block',
        text: 'حفظ',
        onclick: async () => {
          const pin = normalizeDigits(a.value);
          if (!/^\d{4,8}$/.test(pin)) return err.show('الرقم يجب أن يكون من 4 إلى 8 أرقام');
          if (pin !== normalizeDigits(b.value)) return err.show('الرقمان غير متطابقين');
          await ctx.store.setMeta('pin', makePinRecord(pin));
          await ctx.store.setMeta('pinGuard', undefined);
          toast('تم تفعيل القفل');
          close();
          ctx.refresh();
        },
      }),
    );
  });
}

async function removePin() {
  if (!(await confirmDialog({ title: 'إلغاء القفل', message: 'سيفتح التطبيق بدون رقم.', okText: 'إلغاء القفل', danger: true }))) return;
  await ctx.store.setMeta('pin', undefined);
  toast('تم إلغاء القفل');
  ctx.refresh();
}

// ---------- النسخ الاحتياطي ----------
// تصدير مباشر (يُستدعى أيضاً من شريط التذكير في الرئيسية).
// redacted: نسخة بلا تفاصيل التقييم (لا مدخلات الحاسبة ولا ملفات الديون) — للمشاركة، ولا تُحسب نسخة كاملة.
export async function exportBackupNow({ password = null, redacted = false } = {}) {
  const store = ctx.store;
  try {
    const doc = store.exportDoc('', redacted ? { redact: redactNeedEvents } : {});
    const payload = password ? await encryptBackup(doc, password) : doc;
    const name = `daftar-alkhair-backup-${ctx.today()}${redacted ? '-no-assessments' : ''}${password ? '-protected' : ''}.json`;
    const res = await saveFile(name, JSON.stringify(payload), 'application/json');
    if (res === 'cancelled') return false;
    if (redacted) {
      toast('تم تجهيز نسخة بلا تفاصيل التقييم');
      return true;
    }
    await store.markBackedUp();
    toast(password ? 'تم تجهيز النسخة المحمية بكلمة سر' : 'تم تجهيز النسخة الاحتياطية');
    return true;
  } catch (e) {
    toast('تعذّر التصدير: ' + e.message, 'bad');
    return false;
  }
}

function passwordSheet({ title, confirm, note, okText }) {
  return new Promise((resolve) => {
    openSheet(
      title,
      (body, close) => {
        const err = errorBox();
        const a = h('input', { type: 'password', autocomplete: 'off', placeholder: 'كلمة السر' });
        const b = h('input', { type: 'password', autocomplete: 'off', placeholder: 'أعد كلمة السر' });
        body.append(
          err,
          note ? h('p', { class: 'muted', text: note }) : null,
          field('كلمة السر', a),
          confirm ? field('تأكيد كلمة السر', b) : null,
          h('button', {
            class: 'btn primary block',
            text: okText,
            onclick: () => {
              if (a.value.length < 6) return err.show('كلمة السر 6 أحرف على الأقل');
              if (confirm && a.value !== b.value) return err.show('الكلمتان غير متطابقتين');
              close(a.value);
            },
          }),
        );
      },
      { onClose: (v) => resolve(v || null) },
    );
  });
}

// يقرأ نص ملف (عادي أو مشفَّر) ويعيد ناتج parseBackup أو null إذا أُلغي إدخال كلمة السر.
async function readBackupText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return parseBackup(text);
  }
  if (!isEncryptedBackup(obj)) return parseBackup(obj);
  const password = await passwordSheet({ title: 'نسخة محمية بكلمة سر', okText: 'فتح' });
  if (!password) return null;
  return parseBackup(await decryptBackup(obj, password));
}

export function backupScreen() {
  const store = ctx.store;
  const body = h('div', {});
  const last = store.meta.lastBackupAt;
  const unsaved = store.unsavedChanges();
  body.append(
    h('div', { class: `banner ${store.backupDue() || !last ? '' : 'info'}` }, h('span', { class: 'grow', text: `${last ? `آخر نسخة احتياطية: ${F.dateTime(last)}` : 'لم تُؤخذ نسخة احتياطية بعد.'}${unsaved ? ` — ${F.num(unsaved)} تغيير غير منسوخ` : ''}` })),
    h('p', { class: 'muted small', text: 'البيانات محفوظة على هذا الجهاز فقط. الضمان الوحيد ضد فقد الهاتف أو حذف التطبيق هو نسخة محفوظة خارجه: «الملفات» على iCloud Drive، أو أرسلها لنفسك.' }),
    h('button', { class: 'btn primary block', text: 'تصدير نسخة احتياطية (JSON)', onclick: () => exportBackupNow() }),
    h('div', { style: { height: '10px' } }),
  );
  if (canEncrypt()) {
    body.append(
      h('button', {
        class: 'btn block',
        text: 'تصدير نسخة محمية بكلمة سر',
        onclick: async () => {
          const password = await passwordSheet({ title: 'نسخة محمية بكلمة سر', confirm: true, okText: 'تشفير وتصدير', note: 'يُشفَّر الملف (AES-256) ولا يُفتح بدون كلمة السر. لا توجد طريقة لاسترجاع الكلمة إن نُسيت — احتفظ بها في مكان آمن، وأبقِ نسخة عادية في مكان خاص إن خشيت نسيانها.' });
          if (password) await exportBackupNow({ password });
        },
      }),
      h('div', { style: { height: '10px' } }),
    );
  }
  body.append(h('button', { class: 'btn block', text: 'نسخة بلا تفاصيل التقييم (للمشاركة)', onclick: () => exportBackupNow({ redacted: true }) }), h('p', { class: 'muted small', text: 'تُسقط مدخلات ونتائج حاسبة الاحتياج وملفات الديون (بيانات صحة وسلوك ودخل). تبقى الحسابات والمبالغ المعتمدة سليمة. ليست بديلاً عن النسخة الكاملة.' }));
  body.append(driveSection());
  const file = h('input', { type: 'file', style: { display: 'none' }, id: 'import-file' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const parsed = await readBackupText(await f.text());
      if (parsed) importPreview(parsed);
    } catch (e) {
      toast(e.message, 'bad');
    }
  });
  body.append(file, h('button', { class: 'btn block', text: 'استيراد نسخة احتياطية…', onclick: () => file.click() }));

  body.append(sectionTitle('الحماية على الجهاز'));
  const persisted = h('span', { text: '…' });
  const usage = h('span', { text: '…' });
  const mirrorInfo = h('span', { text: '…' });
  if (navigator.storage?.persisted) navigator.storage.persisted().then((ok) => (persisted.textContent = ok ? 'مفعّل' : 'غير مؤكد')).catch(() => (persisted.textContent = 'غير معروف'));
  else persisted.textContent = 'غير مدعوم';
  if (navigator.storage?.estimate) navigator.storage.estimate().then((e) => (usage.textContent = `${F.num(Math.max(1, Math.round((e.usage || 0) / 1024)))} ك.ب`)).catch(() => (usage.textContent = '—'));
  else usage.textContent = '—';
  let mirrorDoc = null;
  readMirror().then((doc) => {
    mirrorDoc = doc;
    mirrorInfo.textContent = doc ? `${F.dateTime(doc.exportedAt)} — ${F.num(doc.events.length)} حدث` : 'لم تُكتب بعد';
  });
  body.append(
    h(
      'div',
      { class: 'card' },
      kv('تخزين دائم (لا يمسحه المتصفح تلقائياً)', persisted),
      kv('حجم البيانات على الجهاز', usage),
      kv('النسخة المرآة الداخلية (تلقائية)', mirrorInfo),
      h('p', { class: 'muted small', text: 'النسخة المرآة تُحدَّث تلقائياً بعد كل تغيير في مخزن مستقل عن قاعدة البيانات، ويعرض التطبيق استرجاعها إذا وجد قاعدته فارغة. هي على نفس الهاتف فلا تحمي من فقده أو حذف التطبيق.' }),
      h('button', {
        class: 'btn small',
        text: 'استرجاع من النسخة المرآة',
        onclick: async () => {
          if (!mirrorDoc) return toast('لا توجد نسخة مرآة بعد', 'bad');
          try {
            importPreview(parseBackup(mirrorDoc));
          } catch (e) {
            toast(e.message, 'bad');
          }
        },
      }),
    ),
  );

  body.append(sectionTitle('النسخ التلقائية قبل العمليات الحساسة'));
  const snaps = h('div', {}, empty('…'));
  body.append(snaps, h('p', { class: 'muted small', text: `تُؤخذ نسخة تلقائياً قبل كل استيراد أو إقفال أو تراجع أو ترقية للهيكل (يُحتفظ بآخر ${F.num(RULES.snapshotsKeep)}). هذه النسخ على الجهاز نفسه ولا تغني عن التصدير.` }));
  store.listSnapshots().then((all) => {
    snaps.replaceChildren(
      all.length
        ? list(
            all.map((s) =>
              row({
                title: s.reason,
                subtitle: `${F.dateTime(s.createdAt)} · ${F.num(s.eventsCount)} حدث`,
                badge: badge('استرجاع', 'warn'),
                onclick: async () => {
                  if (!(await confirmDialog({ title: 'استرجاع هذه النسخة؟', message: `سيعود الدفتر إلى حالته في ${F.dateTime(s.createdAt)}.\nستُؤخذ نسخة تلقائية من الوضع الحالي أولاً.`, okText: 'استرجاع', danger: true }))) return;
                  try {
                    await store.restoreSnapshot(s.id);
                    toast('تم الاسترجاع');
                  } catch (e) {
                    toast(e.message, 'bad');
                  }
                },
              }),
            ),
          )
        : empty('لا توجد نسخ تلقائية بعد'),
    );
  });
  return { title: 'النسخ الاحتياطي', body };
}

// ---------- النسخ التلقائي على Google Drive ----------
const DRIVE_STATE = { ok: ['يعمل — كل التغييرات مرفوعة', 'ok'], pending: ['يعمل — تغييرات في انتظار الرفع', 'info'], 'needs-auth': ['يحتاج تجديد الاتصال', 'warn'], error: ['خطأ في آخر محاولة', 'bad'], off: ['غير مفعّل', ''] };

function driveSection() {
  const store = ctx.store;
  const c = driveConfig(store) || {};
  const st = driveStatus(store);
  const sb = DRIVE_STATE[st.state];
  const out = h('div', {});
  out.append(sectionTitle('نسخ احتياطي تلقائي مستمر على Google Drive'));
  const card = h('div', { class: 'card' }, kv('الحالة', badge(sb[0], sb[1]), '', { secret: false }));
  if (st.lastAt) card.append(kv('آخر رفع', F.dateTime(st.lastAt), '', { secret: false }));
  if (st.pending) card.append(kv('تغييرات لم تُرفع', F.num(st.pending), '', { secret: false }));
  if (st.error) card.append(kv('الخطأ', st.error, 'neg', { secret: false }));
  if (c.lastError && st.state !== 'error') card.append(kv('ملاحظة', c.lastError, 'neg', { secret: false }));
  out.append(card);
  if (!c.clientId) {
    out.append(h('p', { class: 'muted small', text: 'بعد كل تغيير تُرفع نسخة كاملة تلقائياً إلى ملف واحد في حسابك على Drive (يحتفظ Drive بإصداراته السابقة). التطبيق لا يرى في حسابك إلا هذا الملف. يحتاج إعداداً لمرة واحدة: «معرّف عميل» مجاني من Google Cloud — الخطوات في دليل الاستخدام.' }));
  }
  const btns = h('div', { class: 'btn-row' });
  if (c.clientId && st.state === 'needs-auth') btns.append(h('button', { class: 'btn primary', text: c.auto ? 'تجديد الاتصال بـ Drive' : 'اتصال', onclick: () => driveConnect(store, { silent: !!c.lastAt }).catch((e) => toast(e.message, 'bad')) }));
  if (c.clientId && c.auto && ['ok', 'pending', 'error'].includes(st.state)) {
    btns.append(
      h('button', {
        class: 'btn primary',
        text: 'رفع الآن',
        onclick: async () => {
          const r = await driveSyncNow(store, { force: true });
          toast(r.ok ? 'تم الرفع إلى Drive' : r.reason === 'needs-auth' ? 'جدّد الاتصال أولاً' : r.error || 'تعذّر الرفع', r.ok ? '' : 'bad');
          ctx.refresh();
        },
      }),
      h('button', {
        class: 'btn',
        text: 'استرجاع من Drive',
        onclick: async () => {
          try {
            const parsed = await readBackupText(await driveFetchBackup(store));
            if (parsed) importPreview(parsed);
          } catch (e) {
            toast(e.message, 'bad');
          }
        },
      }),
    );
  }
  btns.append(h('button', { class: 'btn', text: c.clientId ? 'إعداد Drive' : 'تفعيل النسخ على Drive', onclick: () => driveSetupForm() }));
  out.append(btns);
  return out;
}

function driveSetupForm() {
  const store = ctx.store;
  const c = driveConfig(store) || {};
  openSheet('إعداد النسخ على Google Drive', (body, close) => {
    const err = errorBox();
    const clientId = textInput(c.clientId || '', 'xxxxxxxx.apps.googleusercontent.com');
    clientId.dir = 'ltr';
    const password = h('input', { type: 'password', autocomplete: 'off', value: c.password || '', placeholder: 'اختياري' });
    const redact = h('input', { type: 'checkbox', checked: !!c.redactNeed });
    const uri = driveRedirectUri();
    const saveCfg = async (connect) => {
      const id = clientId.value.trim();
      if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) return err.show('معرّف العميل يبدأ بأرقام وينتهي بـ .apps.googleusercontent.com');
      if (password.value && password.value.length < 6) return err.show('كلمة السر 6 أحرف على الأقل');
      await store.setMeta('drive', { ...c, clientId: id, auto: true, password: password.value || undefined, redactNeed: redact.checked || undefined, ...(id !== c.clientId ? { token: undefined, expiresAt: 0, fileId: undefined, lastEvents: 0 } : {}) });
      close(true);
      if (connect) driveConnect(store).catch((e) => toast(e.message, 'bad'));
      else ctx.refresh();
    };
    body.append(
      err,
      h('ol', { class: 'flag-list' }, h('li', { text: 'افتح console.cloud.google.com بحسابك وأنشئ مشروعاً (مجاني).' }), h('li', { text: 'فعّل «Google Drive API» من APIs & Services ← Library.' }), h('li', { text: 'OAuth consent screen: النوع External، وأضف بريدك في Test users.' }), h('li', { text: 'Credentials ← Create credentials ← OAuth client ID ← Web application.' }), h('li', { text: 'في Authorized redirect URIs و Authorized JavaScript origins ضع رابط التطبيق التالي حرفياً:' })),
      h('div', { class: 'card', dir: 'ltr', style: { wordBreak: 'break-all', userSelect: 'all' }, text: uri }),
      field('معرّف العميل (Client ID)', clientId),
      field('كلمة سر لتشفير النسخة المرفوعة', password, 'اختياري: يُشفَّر الملف قبل الرفع. تُحفظ الكلمة على هذا الجهاز؛ إن نُسيت لا تُفتح النسخة.'),
      h('label', { class: 'check' }, redact, 'ارفع نسخة بلا تفاصيل التقييم (أخف خصوصيةً، لكنها ليست نسخة كاملة)'),
      h('button', { class: 'btn primary block', type: 'button', text: 'حفظ والاتصال بحساب Google', onclick: () => saveCfg(true) }),
      c.clientId ? h('button', { class: 'btn block', style: { marginTop: '8px' }, type: 'button', text: 'حفظ فقط', onclick: () => saveCfg(false) }) : null,
      c.clientId
        ? h('button', {
            class: 'btn danger block',
            style: { marginTop: '8px' },
            type: 'button',
            text: 'إيقاف النسخ على Drive',
            onclick: async () => {
              await driveDisconnect(store);
              close(true);
              toast('أُوقف النسخ على Drive (الملف المرفوع باقٍ في حسابك)');
            },
          })
        : null,
    );
  });
}

function importPreview(parsed) {
  const plan = planImport(ctx.store.events, parsed);
  openSheet('معاينة الاستيراد', (body, close) => {
    const err = errorBox();
    const c = (x) => [F.num(x.movements), F.num(x.subscribers), F.num(x.families), x.lastDate ? F.date(x.lastDate) : '—'];
    body.append(
      err,
      h('div', { class: 'card' }, kv('تاريخ الملف', F.dateTime(plan.exportedAt)), kv('إصدار هيكل الملف', `${F.num(plan.originalVersion)}${plan.migrated.length ? ` ← رُقّي إلى ${F.num(SCHEMA_VERSION)}` : ''}`), kv('سلامة الملف (checksum)', 'سليم', 'pos')),
      table(
        [{ label: '' }, { label: 'حركات', num: true }, { label: 'مشتركون', num: true }, { label: 'أسر', num: true }, { label: 'آخر حركة', num: true }],
        [
          ['على هذا الجهاز الآن', ...c(plan.current)],
          ['في الملف', ...c(plan.incoming)],
          ...(plan.merge.result ? [['بعد الدمج', ...c(plan.merge.result)]] : []),
        ],
      ),
      h('p', { class: 'muted small', text: `الدمج يضيف ${F.num(plan.merge.added)} حدثاً جديداً من الملف ويُبقي ما على الجهاز (${F.num(plan.merge.common)} حدث مشترك). الاستبدال يمسح ما على الجهاز ويضع محتوى الملف مكانه. في الحالتين تُؤخذ نسخة تلقائية أولاً.` }),
    );
    const run = async (mode) => {
      if (mode === 'replace' && plan.current.movements > 0) {
        if (!(await confirmDialog({ title: 'استبدال كل البيانات؟', message: 'سيُستبدل كل ما على هذا الجهاز بمحتوى الملف.', okText: 'استبدال', danger: true }))) return;
      }
      try {
        await ctx.store.importBackup(parsed, mode);
        toast(mode === 'replace' ? 'تم الاستيراد (استبدال)' : 'تم الاستيراد (دمج)');
        close();
        ctx.nav('#/');
      } catch (e) {
        err.show('تعذّر الاستيراد: ' + e.message);
      }
    };
    body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', text: plan.current.movements ? 'دمج' : 'استيراد', onclick: () => run(plan.current.movements ? 'merge' : 'replace') }), plan.current.movements ? h('button', { class: 'btn danger', text: 'استبدال', onclick: () => run('replace') }) : null));
  });
}

// ---------- الإقفال السنوي ----------
export function closingScreen() {
  const st = ui('closing', { off: {}, reason: '' });
  const year = ctx.fiscalYear();
  const body = h('div', {});
  let p;
  try {
    p = previewClose(S(), year, { today: ctx.today() });
  } catch (e) {
    return { title: 'الإقفال السنوي', body: empty(e.message) };
  }
  body.append(h('div', { class: 'banner info', text: `معاينة إقفال سنة ${F.num(year)} — لا يتغير شيء قبل الضغط على «إقفال».` }));
  for (const w of p.warnings) body.append(h('div', { class: 'banner', text: w }));
  body.append(h('div', { class: 'stats' }, stat('وارد السنة', F.money(p.flows.inflow), { valueClass: 'pos' }), stat('منصرف السنة', F.money(p.flows.outflow), { valueClass: 'neg' }), stat('إجمالي السيولة آخر السنة', F.money(p.totalCash), { cls: 'wide primary', hint: 'يتحول رصيداً افتتاحياً للسنة الجديدة' })));
  body.append(sectionTitle('الناتج النهائي لكل صندوق'));
  body.append(
    table(
      [{ label: 'الصندوق' }, { label: 'نقد', num: true }, { label: 'أصول (المدفوع)', num: true }, { label: 'أصول (الحالي)', num: true }],
      p.funds.filter((f) => f.cash || f.assetsCost || !f.fund.archived).map((f) => [f.fund.name, F.money(f.cash), F.money(f.assetsCost), F.money(f.assetsValue)]),
    ),
  );
  if (p.assets.length) {
    body.append(sectionTitle('الأصول'));
    body.append(table([{ label: 'الأصل' }, { label: 'الكمية', num: true }, { label: 'المدفوع', num: true }, { label: 'الحالي', num: true }], p.assets.map((a) => [a.asset.name, `${F.aqty(a.qty)} ${a.asset.unit}`, F.money(a.cost), F.money(a.value)])));
  }
  if (p.items.length) {
    body.append(sectionTitle('المخزن'));
    body.append(table([{ label: 'الصنف' }, { label: 'الكمية', num: true }, { label: 'القيمة', num: true }], p.items.map((x) => [x.item.name, `${F.qty(x.qty)} ${x.item.unit}`, F.money(x.cost)])));
  }
  const key = (e, id, m) => `${e}:${id}:${m}`;
  const dueList = (title, entity, data, nameOf) => {
    if (!data.length) return;
    body.append(sectionTitle(title));
    const rows = [];
    for (const a of data) {
      const who = nameOf(a);
      const boxes = [];
      const allOn = () => a.months.every((m) => st.off[key(entity, who.id, m.month)]);
      const toggle = h('button', { class: 'btn small', type: 'button', text: allOn() ? 'إلغاء التأشير' : entity === 'family' ? 'الكل لن يُصرف' : 'الكل لن يُسدد' });
      toggle.addEventListener('click', () => {
        const on = !allOn();
        for (const { cb, k, w } of boxes) {
          cb.checked = on;
          if (on) st.off[k] = w;
          else delete st.off[k];
        }
        toggle.textContent = on ? 'إلغاء التأشير' : entity === 'family' ? 'الكل لن يُصرف' : 'الكل لن يُسدد';
      });
      rows.push(h('div', { class: 'row' }, h('div', { class: 'main' }, h('div', { class: 'title', text: who.name }), h('div', { class: 'subtitle', text: `${F.num(a.months.length)} شهر — ${F.egp(a.total)}` })), h('div', { class: 'end' }, toggle)));
      for (const m of a.months) {
        const k = key(entity, who.id, m.month);
        const w = { entity, entityId: who.id, month: m.month };
        const cb = h('input', { type: 'checkbox', checked: !!st.off[k], 'aria-label': `${who.name} ${F.month(m.month)}: ${entity === 'family' ? 'لن يُصرف' : 'لن يُسدد'}` });
        cb.addEventListener('change', () => (cb.checked ? (st.off[k] = w) : delete st.off[k]));
        boxes.push({ cb, k, w });
        rows.push(h('label', { class: 'row', style: { minHeight: '46px', paddingInlineStart: '28px' } }, h('div', { class: 'main' }, h('div', { class: 'subtitle', text: `${F.month(m.month)} — متبقي ${F.egp(m.remaining)}` })), h('div', { class: 'end' }, h('span', { class: 'small muted', text: entity === 'family' ? 'لن يُصرف ' : 'لن يُسدد ' }), cb)));
      }
    }
    body.append(list(rows));
  };
  dueList(`متأخرات المشتركين (${F.num(p.arrears.reduce((a, x) => a + x.months.length, 0))} شهر) — غير المؤشَّر يبقى «مطلوباً» ويُرحَّل`, 'subscriber', p.arrears, (a) => a.subscriber);
  dueList('استحقاقات أسر لم تُصرف — غير المؤشَّر يُرحَّل', 'family', p.familyDues, (a) => a.family);
  const reason = textInput(st.reason, 'سبب «لن يُسدد» للشهور المؤشَّرة');
  reason.addEventListener('input', () => (st.reason = reason.value));
  if (p.arrears.length || p.familyDues.length) body.append(field('سبب الشطب (للمؤشَّر عليه)', reason));
  body.append(
    h('button', {
      class: 'btn primary block',
      text: `إقفال سنة ${F.num(year)} وبدء ${F.num(year + 1)}`,
      onclick: async () => {
        const writeoffs = Object.values(st.off).map((w) => ({ ...w, reason: st.reason.trim() }));
        if (writeoffs.length && !st.reason.trim()) return toast('اكتب سبب «لن يُسدد» للشهور المؤشَّرة', 'bad');
        const ok = await confirmDialog({
          title: `إقفال سنة ${F.num(year)}؟`,
          message: `• تُؤخذ نسخة تلقائية قبل الإقفال.\n• تصبح حركات ${F.num(year)} للقراءة فقط.\n• تُرحَّل الأرصدة افتتاحيةً لسنة ${F.num(year + 1)} بنفس الأشخاص والأسر وإعداداتهم.\n• ${F.num(writeoffs.length)} شهر يُسجَّل «لن يُسدد» والباقي يظل مطلوباً.\nيمكن التراجع عن الإقفال لاحقاً.`,
          okText: 'إقفال',
        });
        if (!ok) return;
        try {
          await ctx.store.snapshot(`قبل إقفال سنة ${year}`);
          await ctx.store.run((book) => closeYear(book, year, { writeoffs, date: ctx.today(), now: new Date() }));
          st.off = {};
          toast(`تم إقفال ${year} — بدأت سنة ${year + 1}`);
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    }),
  );

  const closed = closedYears(S());
  body.append(sectionTitle('السنوات المقفولة (الأرشيف)'));
  if (!closed.length) body.append(empty('لا توجد سنوات مقفولة بعد'));
  else {
    body.append(
      list(
        [...closed].reverse().map((y) => {
          const v = verifyCheckpoint(S(), y);
          return row({ title: `سنة ${F.num(y)}`, subtitle: `أُقفلت ${F.date(activeClosing(S(), y).date)}`, badge: v.ok ? badge('الأرشيف سليم', 'ok') : badge('اختلاف!', 'bad'), onclick: () => ctx.nav(`#/archive/${y}`) });
        }),
      ),
    );
    const last = closed[closed.length - 1];
    body.append(
      h('button', {
        class: 'btn danger block',
        text: `تراجع عن إقفال سنة ${F.num(last)}`,
        onclick: async () => {
          const reasonText = await confirmDialog({ title: `التراجع عن إقفال ${F.num(last)}؟`, message: 'تعود السنة مفتوحة للتعديل، وتُلغى قرارات «لن يُسدد» التي اتُّخذت ضمن ذلك الإقفال. تُؤخذ نسخة تلقائية أولاً.', okText: 'تراجع', danger: true, input: { label: 'السبب (اختياري)' } });
          if (!reasonText) return;
          try {
            await ctx.store.snapshot(`قبل التراجع عن إقفال ${last}`);
            await ctx.store.run((book) => reopenYear(book, last, { reason: reasonText === true ? '' : reasonText, now: new Date() }));
            toast(`عادت سنة ${last} مفتوحة`);
          } catch (e) {
            toast(e.message, 'bad');
          }
        },
      }),
    );
  }
  return { title: 'الإقفال السنوي', subtitle: `السنة المفتوحة ${F.num(year)}`, body };
}

// ---------- أرشيف سنة مقفولة (قراءة فقط) ----------
export function archiveScreen({ year }) {
  const y = Number(year);
  const c = activeClosing(S(), y);
  if (!c) return { title: 'الأرشيف', body: empty('هذه السنة غير مقفولة') };
  const cp = c.checkpoint;
  const flows = yearFlows(S(), y);
  const v = verifyCheckpoint(S(), y);
  const body = h('div', {});
  body.append(h('div', { class: 'banner info', text: `سنة ${F.num(y)} مقفولة — للقراءة فقط. أُقفلت بتاريخ ${F.date(c.date)}.` }));
  if (!v.ok) body.append(h('div', { class: 'banner bad', text: 'تحذير: أرصدة الأرشيف المخزَّنة لا تطابق إعادة الحساب من الحركات.' }));
  body.append(h('div', { class: 'stats' }, stat('وارد السنة', F.money(flows.inflow), { valueClass: 'pos' }), stat('منصرف السنة', F.money(flows.outflow), { valueClass: 'neg' }), stat('السيولة عند الإقفال', F.money(cp.totalCash), { cls: 'wide primary' })));
  body.append(sectionTitle('أرصدة الإقفال (= افتتاح السنة التالية)'));
  const cash = Object.entries(cp.cash);
  body.append(cash.length ? table([{ label: 'الحساب' }, { label: 'الرصيد', num: true }], cash.map(([a, x]) => [acctLabel(S(), a), F.money(x)])) : empty('لا أرصدة نقدية'));
  const assets = Object.entries(cp.assets);
  if (assets.length) body.append(table([{ label: 'الأصل' }, { label: 'الكمية', num: true }, { label: 'المدفوع', num: true }], assets.map(([id, a]) => [S().lists.assets.get(id)?.name || id, F.aqty(a.qty), F.money(a.cost)])));
  const items = Object.entries(cp.items);
  if (items.length) body.append(table([{ label: 'الصنف' }, { label: 'الكمية', num: true }, { label: 'القيمة', num: true }], items.map(([id, a]) => [S().lists.items.get(id)?.name || id, F.qty(a.qty), F.money(a.cost)])));
  body.append(sectionTitle(`متأخرات رُحّلت عند الإقفال (${F.num(cp.arrears.length)} شهر)`));
  body.append(cp.arrears.length ? table([{ label: 'المشترك' }, { label: 'الشهر' }, { label: 'المتبقي', num: true }], cp.arrears.map((a) => [S().subscribers.get(a.subscriberId)?.name || '', F.month(a.month), F.money(a.remaining)])) : empty('لا متأخرات'));
  body.append(
    h(
      'div',
      { class: 'btn-row' },
      h('button', {
        class: 'btn',
        text: 'تقارير السنة',
        onclick: () => {
          Object.assign(ui('reports', {}), { period: String(y), tab: 'month' });
          ctx.nav('#/reports');
        },
      }),
      h('button', {
        class: 'btn',
        text: 'حركات السنة',
        onclick: () => {
          Object.assign(ui('ledger', {}), { q: '', kind: '', fund: '', from: y <= firstFiscalYear(S()) ? '' : `${y}-01-01`, to: `${y}-12-31`, voided: false });
          ctx.nav('#/ledger');
        },
      }),
    ),
  );
  return { title: `أرشيف ${F.num(y)}`, body };
}
