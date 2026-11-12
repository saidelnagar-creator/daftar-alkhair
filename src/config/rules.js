// قواعد العمل — جداول إعداد لا منطق. أي تغيير في القواعد يتم هنا (أو من الإعدادات داخل التطبيق)
// وليس داخل دوال المحاسبة. انظر CLAUDE.md قبل التعديل.

export const RULES = Object.freeze({
  // كل القيم تُخزَّن أعداداً صحيحة بهذه المعاملات:
  //   المبالغ بأعشار الجنيه (خانة عشرية واحدة) — الكميات العينية بالمئات (خانتان) — كميات الأصول/الذهب بالآلاف (3 خانات)
  scales: Object.freeze({ money: 10, qty: 100, asset: 1000 }),

  // الخانات العشرية المسموحة في الإدخال والحساب لكل فئة (تُغيَّر من الإعدادات بتاريخ سريان).
  // الحد الأقصى تحدده معاملات التخزين أعلاه: مبالغ 0–1، عيني 0–2، أصول/ذهب 0–3.
  precisionDefault: Object.freeze({ money: 0, qty: 2, asset: 3 }),
  precisionMax: Object.freeze({ money: 1, qty: 2, asset: 3 }),

  // التقريب: نصف لأعلى (بعيداً عن الصفر)، وعند التوزيع آخر بند يأخذ الباقي فلا يضيع فرق.
  rounding: 'half-up',
  distributeRemainder: 'last',

  // تخصيص دفعة المشترك: الأقدم أولاً، ثم الزائد مقدماً لشهور قادمة (شهور كاملة فقط)،
  // وما يتبقى أقل من شهر كامل يصبح «زيادة عامة».
  allocation: Object.freeze({
    order: 'oldest-first',
    excess: 'advance', // 'advance' | 'extra'
    partialRemainder: 'extra', // 'extra' | 'advance'
    maxAdvanceMonths: 24,
  }),

  // تخصيص الصرف للأسرة: شهور الاستحقاق الأقدم أولاً، ثم مقدماً لشهور كاملة، والباقي «إضافة عامة».
  familyAllocation: Object.freeze({
    order: 'oldest-first',
    excess: 'advance',
    partialRemainder: 'extra',
    maxAdvanceMonths: 12,
  }),

  backupReminderDays: 7, // تذكير دوري بالنسخة الاحتياطية
  backupReminderEvents: 25, // أو عند تراكم هذا العدد من التغييرات غير المنسوخة
  snapshotsKeep: 12, // عدد النسخ التلقائية المحفوظة على الجهاز
  pinLockMinutes: 2, // قفل PIN بعد هذه المدة في الخلفية
});
