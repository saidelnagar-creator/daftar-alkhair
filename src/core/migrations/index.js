// سلسلة ترحيلات هيكل البيانات (schema migrations).
// القواعد (لا تُكسر):
//   1) لا تعدّل ترحيلاً قديماً أبداً — أي تغيير في الهيكل = ملف ترحيل جديد برقم تالٍ.
//   2) كل ترحيل دالة خالصة: تأخذ مستند النسخة (events + meta) بالإصدار السابق وتعيد مستنداً بالإصدار التالي.
//   3) طبقة التخزين تأخذ snapshot قبل التشغيل وتتراجع تلقائياً إذا فشل أي ترحيل.
//   4) أضف اختباراً في tests/unit/migrations.test.mjs مع ملف fixture بالإصدار القديم.
import { m002 } from './002-decimal-scales.js';
import { m003 } from './003-precision-setting.js';
import { m004 } from './004-need-inkind-waqf.js';

export const MIGRATIONS = [m002, m003, m004];

// رقم إصدار الهيكل الحالي = آخر ترحيل.
export const SCHEMA_VERSION = 4;

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationError';
  }
}

// يرقّي مستنداً إلى الإصدار الحالي. يعيد { doc, applied: [أرقام الترحيلات المنفذة] }.
export function migrateDoc(doc, { migrations = MIGRATIONS, target = SCHEMA_VERSION } = {}) {
  let version = doc.schemaVersion;
  if (!Number.isInteger(version) || version < 1) throw new MigrationError('رقم إصدار الهيكل غير صالح');
  if (version > target) throw new MigrationError('هذه النسخة من إصدار أحدث من التطبيق — حدّث التطبيق أولاً ثم أعد المحاولة');
  let cur = doc;
  const applied = [];
  while (version < target) {
    const m = migrations.find((x) => x.from === version);
    if (!m) throw new MigrationError(`لا يوجد ترحيل من الإصدار ${version}`);
    let next;
    try {
      next = m.migrate(JSON.parse(JSON.stringify(cur)));
    } catch (e) {
      throw new MigrationError(`فشل الترحيل ${m.from}→${m.to}: ${e.message}`);
    }
    if (!next || next.schemaVersion !== m.to || !Array.isArray(next.events)) throw new MigrationError(`الترحيل ${m.from}→${m.to} أعاد مستنداً غير صالح`);
    cur = next;
    version = m.to;
    applied.push(m.to);
  }
  return { doc: cur, applied };
}
