// ترحيل 2 → 3: عدد الخانات العشرية صار إعداداً بتاريخ سريان (`precision`) والافتراضي للدفاتر الجديدة مبالغ صحيحة.
// الدفاتر الموجودة بالإصدار 2 كُتبت تحت قاعدة «المبالغ بخانة عشرية واحدة»؛ نثبّت تلك القاعدة صراحةً على تاريخها
// حتى لا يتغير أي حساب مشتق (تكلفة مخزون/أصول) بأثر رجعي. صاحب الدفتر يغيّرها من الإعدادات من الشهر الذي يريد.
// لا تعدّل هذا الملف بعد النشر.
export const m003 = {
  from: 2,
  to: 3,
  description: 'إعداد الخانات العشرية بتاريخ سريان؛ الدفاتر القديمة تحتفظ بخانة عشرية واحدة للمبالغ',
  migrate(doc) {
    const has = doc.events.some((e) => e.type === 'settings.set' && e.data && e.data.key === 'precision');
    if (has) return { ...doc, schemaVersion: 3 };
    const first = doc.events[0];
    const ev = { id: 'mig3-precision', ts: first ? first.ts : '2000-01-01T00:00:00.000Z', type: 'settings.set', data: { key: 'precision', value: [{ from: '2000-01', money: 1, qty: 2, asset: 3 }] } };
    return { ...doc, schemaVersion: 3, events: [ev, ...doc.events] };
  },
};
