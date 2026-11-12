// الدفتر: مصفوفة أحداث + الحالة المشتقة. كل تغيير يمر من dispatch (تحقق ثم إلحاق).
import { DEFAULT_EXPENSE_TYPES, DEFAULT_FAMILY_CATEGORIES, DEFAULT_FUNDS, DEFAULT_ITEMS, DEFAULT_PURPOSES } from '../config/defaults.js';
import { applyEvent, buildState, nextVoucher } from './engine.js';
import { validateEvent } from './validate.js';
import { computeLedger } from './ledger.js';
import { ValidationError, newId } from './util.js';

export const SEED_TS = '2000-01-01T00:00:00.000Z';

// أحداث الزرع: القوائم الافتراضية بمعرّفات ثابتة (فلا تتكرر عند الدمج).
export function seedEvents() {
  const out = [];
  const add = (list, item) => out.push({ id: `seed-${list}-${item.id}`, ts: SEED_TS, type: 'list.upsert', data: { list, item } });
  DEFAULT_FUNDS.forEach((x) => add('funds', x));
  DEFAULT_PURPOSES.forEach((x) => add('purposes', x));
  DEFAULT_EXPENSE_TYPES.forEach((x) => add('expenseTypes', x));
  DEFAULT_FAMILY_CATEGORIES.forEach((x) => add('familyCategories', x));
  DEFAULT_ITEMS.forEach((x) => add('items', x));
  return out;
}

export class Book {
  constructor(events = []) {
    this.events = events.slice();
    this.state = buildState(this.events);
  }

  static seeded() {
    return new Book(seedEvents());
  }

  make(type, data, { now = new Date(), id = null } = {}) {
    return { id: id || newId('e'), ts: typeof now === 'string' ? now : now.toISOString(), type, data };
  }

  // إضافة حدث واحد بعد التحقق.
  dispatch(type, data, opts) {
    const ev = this.make(type, data, opts);
    validateEvent(this.state, ev);
    this.events.push(ev);
    applyEvent(this.state, ev);
    return ev;
  }

  // إضافة مجموعة أحداث ككتلة واحدة: إما كلها أو لا شيء.
  dispatchAll(list, opts) {
    const start = this.events.length;
    try {
      return list.map(([type, data]) => this.dispatch(type, data, opts));
    } catch (e) {
      this.events.length = start;
      this.state = buildState(this.events);
      throw e;
    }
  }

  // نسخة تجريبية مستقلة (للمعاملات المركبة مثل الإقفال).
  fork() {
    return new Book(this.events);
  }

  // إلحاق أحداث تم التحقق منها في نسخة تجريبية.
  commit(events) {
    for (const ev of events) {
      this.events.push(ev);
      applyEvent(this.state, ev);
    }
  }

  // ----- اختصارات شائعة -----
  addMovement(mv, opts) {
    const movement = { id: mv.id || newId('m'), ...mv };
    if (!movement.voucher) movement.voucher = nextVoucher(this.state, movement.kind);
    this.dispatch('movement.add', { movement }, opts);
    return movement;
  }

  voidMovement(movementId, reason, date, opts) {
    return this.dispatch('movement.void', { movementId, reason, date }, opts);
  }

  // التعديل = إلغاء الحركة القديمة + حركة جديدة تشير إليها (سجل تدقيق كامل).
  // فحص كفاية المخزون/الأصول يتم على النتيجة النهائية للاستبدال لا على الإلغاء وحده.
  replaceMovement(oldId, mv, reason, date, opts) {
    const movement = { id: newId('m'), ...mv, replaces: oldId, voucher: nextVoucher(this.state, mv.kind) }; // التصحيح يأخذ رقم سند جديداً
    const start = this.events.length;
    const before = computeLedger(this.state).problems.length;
    try {
      this.dispatch('movement.void', { movementId: oldId, reason: reason || 'تعديل', date, replacedBy: movement.id }, opts);
      this.dispatch('movement.add', { movement }, opts);
      if (computeLedger(this.state).problems.length > before) {
        throw new ValidationError('التعديل يجعل رصيد صنف أو أصل سالباً — راجع الحركات اللاحقة');
      }
    } catch (e) {
      this.events.length = start;
      this.state = buildState(this.events);
      throw e;
    }
    return movement;
  }
}
