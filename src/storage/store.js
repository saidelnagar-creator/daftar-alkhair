// طبقة التخزين: تحفظ سجل الأحداث في IndexedDB وتدير الترحيلات والنسخ التلقائية.
// فصل الكود عن البيانات: تحديث الكود (ملفات جديدة/Service Worker) لا يلمس هذه القاعدة أبداً؛
// أي تغيير في الهيكل يمر فقط عبر سلسلة الترحيلات مع snapshot قبله ورجوع تلقائي عند الفشل.
import { RULES } from '../config/rules.js';
import { DB_NAME } from '../config/version.js';
import { Book, seedEvents } from '../core/book.js';
import { exportDoc, mergeEvents, parseBackup } from '../core/backup.js';
import { MIGRATIONS, SCHEMA_VERSION, migrateDoc } from '../core/migrations/index.js';
import { newId } from '../core/util.js';
import { openDB, reqP, tx } from './idb.js';

export class StoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

export class Store {
  constructor(db) {
    this.db = db;
    this.book = new Book([]);
    this.meta = {};
    this.listeners = new Set();
    this.migrationInfo = null;
    this.isFresh = false;
  }

  get state() {
    return this.book.state;
  }

  get events() {
    return this.book.events;
  }

  // يفتح القاعدة، يزرع القوائم الافتراضية عند أول تشغيل، ويرقّي الهيكل إن لزم.
  static async open({ dbName = DB_NAME, indexedDB = globalThis.indexedDB, migrations = MIGRATIONS, schemaVersion = SCHEMA_VERSION, now = () => new Date() } = {}) {
    const db = await openDB(dbName, indexedDB);
    const store = new Store(db);
    store.now = now;
    const [rows, metaKeys, metaVals] = await tx(db, ['events', 'meta'], 'readonly', (s) => Promise.all([reqP(s.events.getAll()), reqP(s.meta.getAllKeys()), reqP(s.meta.getAll())]));
    metaKeys.forEach((k, i) => (store.meta[k] = metaVals[i]));
    let events = rows.sort((a, b) => a.seq - b.seq).map((r) => r.ev);

    if (store.meta.schemaVersion === undefined) {
      // أول تشغيل على هذا الجهاز
      events = seedEvents();
      const meta = { schemaVersion, deviceId: newId('d'), createdAt: now().toISOString() };
      await store._writeAll(events, meta);
      store.isFresh = true; // قاعدة أُنشئت الآن: main.js يتحقق هل كانت هناك بيانات اختفت
    } else if (store.meta.schemaVersion > schemaVersion) {
      throw new StoreError('بيانات هذا الجهاز من إصدار أحدث من كود التطبيق. حدّث التطبيق (أعد فتحه مع اتصال بالإنترنت) ثم حاول ثانية. بياناتك سليمة ولم تُمس.', 'newer-data');
    } else if (store.meta.schemaVersion < schemaVersion) {
      // ترحيل الهيكل: snapshot أولاً، ثم الترحيل في الذاكرة، ثم كتابة ذرية. أي فشل = لا تغيير.
      const from = store.meta.schemaVersion;
      const snapId = await store._saveSnapshot({ schemaVersion: from, events }, `قبل ترحيل الهيكل ${from}→${schemaVersion}`);
      let migrated;
      try {
        migrated = migrateDoc({ schemaVersion: from, events }, { migrations, target: schemaVersion });
        new Book(migrated.doc.events); // تأكد أن الناتج يُبنى بلا أخطاء
        await store._writeAll(migrated.doc.events, { schemaVersion });
      } catch (e) {
        throw new StoreError(`تعذّر ترقية هيكل البيانات (${e.message}). لم يتغير شيء في بياناتك، ونسخة احتياطية تلقائية محفوظة على الجهاز.`, 'migration-failed');
      }
      events = migrated.doc.events;
      store.migrationInfo = { from, to: schemaVersion, applied: migrated.applied, snapshotId: snapId };
    }
    store.book = new Book(events);
    return store;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify() {
    for (const fn of this.listeners) fn(this);
  }

  // كتابة ذرية لكل السجل + مفاتيح meta (تُستخدم للزرع، الترحيل، الاستيراد، الاسترجاع).
  async _writeAll(events, meta = {}) {
    await tx(this.db, ['events', 'meta'], 'readwrite', (s) => {
      s.events.clear();
      events.forEach((ev, i) => s.events.put({ seq: i, ev }));
      for (const [k, v] of Object.entries(meta)) s.meta.put(v, k);
    });
    Object.assign(this.meta, meta);
  }

  async _append(events, startSeq) {
    await tx(this.db, ['events'], 'readwrite', (s) => {
      events.forEach((ev, i) => s.events.add({ seq: startSeq + i, ev }));
    });
  }

  async setMeta(key, value) {
    await tx(this.db, ['meta'], 'readwrite', (s) => {
      if (value === undefined) s.meta.delete(key);
      else s.meta.put(value, key);
    });
    if (value === undefined) delete this.meta[key];
    else this.meta[key] = value;
  }

  // حدث واحد: تحقق في الذاكرة ثم حفظ؛ فشل الحفظ يتراجع عن الذاكرة.
  async dispatch(type, data) {
    return (await this.run((b) => b.dispatch(type, data, { now: this.now() }))).result;
  }

  // معاملة مركبة: fn تعمل على نسخة تجريبية؛ الأحداث الجديدة تُحفظ ككتلة واحدة ثم تُعتمد.
  async run(fn) {
    const trial = this.book.fork();
    const result = fn(trial);
    const added = trial.events.slice(this.book.events.length);
    if (added.length) {
      await this._append(added, this.book.events.length);
      this.book = trial;
      this._notify();
    }
    return { result, added };
  }

  // ----- النسخ التلقائية على الجهاز -----
  async _saveSnapshot({ schemaVersion, events }, reason) {
    const id = `${this.now().toISOString()}-${newId().slice(0, 6)}`;
    const snap = { id, createdAt: this.now().toISOString(), reason, schemaVersion, eventsCount: events.length, events };
    await tx(this.db, ['snapshots'], 'readwrite', (s) => {
      s.snapshots.put(snap);
    });
    await this._pruneSnapshots();
    return id;
  }

  async _pruneSnapshots() {
    const keys = await tx(this.db, ['snapshots'], 'readonly', (s) => reqP(s.snapshots.getAllKeys()));
    const extra = keys.sort().slice(0, Math.max(0, keys.length - RULES.snapshotsKeep));
    if (extra.length) await tx(this.db, ['snapshots'], 'readwrite', (s) => extra.forEach((k) => s.snapshots.delete(k)));
  }

  snapshot(reason) {
    return this._saveSnapshot({ schemaVersion: SCHEMA_VERSION, events: this.book.events.slice() }, reason);
  }

  async listSnapshots() {
    const all = await tx(this.db, ['snapshots'], 'readonly', (s) => reqP(s.snapshots.getAll()));
    return all.map(({ events, ...rest }) => rest).sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  async getSnapshot(id) {
    return tx(this.db, ['snapshots'], 'readonly', (s) => reqP(s.snapshots.get(id)));
  }

  // استرجاع نسخة تلقائية (مع أخذ نسخة من الوضع الحالي أولاً).
  async restoreSnapshot(id) {
    const snap = await this.getSnapshot(id);
    if (!snap) throw new StoreError('النسخة غير موجودة', 'no-snapshot');
    const { doc } = migrateDoc({ schemaVersion: snap.schemaVersion, events: snap.events });
    const book = new Book(doc.events);
    await this.snapshot('قبل استرجاع نسخة تلقائية');
    await this._writeAll(doc.events, { schemaVersion: SCHEMA_VERSION });
    this.book = book;
    this._notify();
  }

  // ----- التصدير والاستيراد -----
  exportDoc(note = '', { redact = null } = {}) {
    return exportDoc(this.book.events, { now: this.now(), deviceId: this.meta.deviceId, note, redact });
  }

  async markBackedUp() {
    await this.setMeta('lastBackupAt', this.now().toISOString());
    await this.setMeta('lastBackupEvents', this.book.events.length);
    this._notify();
  }

  // عدد الأحداث التي لم تدخل أي نسخة احتياطية مُصدَّرة بعد.
  unsavedChanges() {
    return Math.max(0, this.book.events.length - (this.meta.lastBackupEvents ?? seedEvents().length));
  }

  // هل حان وقت التذكير بالنسخة الاحتياطية؟ (مرور المدة، أو تراكم تغييرات كثيرة)
  backupDue() {
    const days = this.state.settings.backupReminderDays ?? RULES.backupReminderDays;
    if (!days) return false;
    const unsaved = this.unsavedChanges();
    if (!unsaved) return false;
    if (unsaved >= RULES.backupReminderEvents) return true;
    const last = this.meta.lastBackupAt || this.meta.createdAt;
    return !last || (this.now() - new Date(last)) / 86400000 >= days;
  }

  // استيراد: parsed = ناتج parseBackup. mode: 'merge' | 'replace'. نسخة تلقائية قبل التنفيذ دائماً.
  async importBackup(parsed, mode) {
    const incoming = parsed.doc.events;
    const events = mode === 'replace' ? incoming.slice() : mergeEvents(this.book.events, incoming).events;
    const book = new Book(events); // يفشل هنا قبل أي كتابة إن كان السجل غير صالح
    await this.snapshot(mode === 'replace' ? 'قبل استيراد (استبدال)' : 'قبل استيراد (دمج)');
    await this._writeAll(events, { schemaVersion: SCHEMA_VERSION });
    this.book = book;
    this._notify();
    return { events: events.length };
  }

  async importText(text, mode) {
    return this.importBackup(parseBackup(text), mode);
  }

  close() {
    this.db.close();
  }
}
