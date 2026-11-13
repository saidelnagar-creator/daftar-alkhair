// الإعداد الافتراضي لحاسبة الاحتياج (نسخة 2026-11 من الدليل). كل قيمة هنا قابلة للتعديل من الواجهة بنسخ مؤرخة (need.config.set).
// جداول لا منطق — المبالغ بالجنيه الصحيح كما في الدليل.
export const NEED_DEFAULT_CONFIG = Object.freeze({
  "configVersion": "2026-11",
  "source": "دليل تقييم استحقاق الأسرة للمساعدة (ريف الوجه البحري) — أرقام نوفمبر 2026",
  "note": "كل القيم هنا اجتهاد إداري قابل للتعديل من واجهة التطبيق. الأسعار تُراجع كل 3 أشهر و R كل 6 أشهر.",
  "R": 2200,
  "pointsPerR": 100,
  "gold21PricePerGram": 5995,
  "nisabGrams": 85,
  "dailyWage": 300,
  "imputedWorkDays": 20,
  "ages": {
    "food0_5Max": 5,
    "food6_11Max": 11,
    "food12_17Max": 17,
    "smallChildClothingMax": 5,
    "teenWorkFrom": 15,
    "adult": 18,
    "elder": 60,
    "orphanBelow": 18
  },
  "items": {
    "food_adult": {
      "min": 1100,
      "typ": 1300,
      "max": 1600,
      "label": "طعام بالغ"
    },
    "food_12_17": {
      "min": 1000,
      "typ": 1200,
      "max": 1450,
      "label": "طعام 12–17"
    },
    "food_6_11": {
      "min": 800,
      "typ": 1000,
      "max": 1200,
      "label": "طعام 6–11"
    },
    "food_0_5": {
      "min": 550,
      "typ": 700,
      "max": 900,
      "label": "طعام 0–5"
    },
    "formula": {
      "min": 600,
      "typ": 900,
      "max": 1200,
      "label": "لبن صناعي (حاجة طبية)"
    },
    "diapers": {
      "min": 300,
      "typ": 450,
      "max": 600,
      "label": "حفاضات"
    },
    "clothing": {
      "min": 150,
      "typ": 200,
      "max": 300,
      "label": "كسوة"
    },
    "hygiene": {
      "min": 80,
      "typ": 100,
      "max": 150,
      "label": "نظافة"
    },
    "health": {
      "min": 30,
      "typ": 50,
      "max": 100,
      "label": "صحة أساسية"
    },
    "edu_primary": {
      "min": 100,
      "typ": 150,
      "max": 250,
      "label": "ابتدائي"
    },
    "edu_prep": {
      "min": 150,
      "typ": 250,
      "max": 400,
      "label": "إعدادي مع التقوية"
    },
    "edu_secondary": {
      "min": 250,
      "typ": 400,
      "max": 700,
      "label": "ثانوي أو أزهري أو فني"
    },
    "edu_university": {
      "min": 500,
      "typ": 800,
      "max": 1200,
      "label": "جامعة لطالب جاد"
    },
    "chronic_bp": {
      "min": 150,
      "typ": 250,
      "max": 400,
      "belowMin": "actual",
      "label": "ضغط"
    },
    "chronic_dmOral": {
      "min": 200,
      "typ": 400,
      "max": 600,
      "belowMin": "actual",
      "label": "سكر أقراص"
    },
    "chronic_dmInsulin": {
      "min": 500,
      "typ": 800,
      "max": 1100,
      "belowMin": "actual",
      "label": "سكر أنسولين"
    },
    "chronic_disability": {
      "min": 400,
      "typ": 800,
      "max": 1500,
      "belowMin": "actual",
      "label": "إعاقة"
    },
    "rent": {
      "min": 800,
      "typ": 1500,
      "max": 2500,
      "belowMin": "actual",
      "label": "إيجار قروي"
    },
    "maintenance": {
      "min": 100,
      "typ": 150,
      "max": 250,
      "label": "صيانة بيت مملوك"
    },
    "electricity": {
      "min": 130,
      "typ": 200,
      "max": 300,
      "label": "كهرباء"
    },
    "water": {
      "min": 40,
      "typ": 60,
      "max": 100,
      "label": "مياه"
    },
    "gas": {
      "min": 275,
      "typ": 275,
      "max": 410,
      "label": "غاز"
    },
    "telecom": {
      "min": 100,
      "typ": 150,
      "max": 250,
      "label": "اتصالات"
    },
    "transport": {
      "min": 150,
      "typ": 250,
      "max": 400,
      "label": "مواصلات"
    }
  },
  "smallChildClothing": 150,
  "gasLargeFamily": {
    "fromResidents": 6,
    "amount": 410
  },
  "sharedItems": [
    "maintenance",
    "electricity",
    "water",
    "gas"
  ],
  "chronicOtherMax": 1500,
  "ration": {
    "perPerson": 50,
    "fullUpTo": 4,
    "perExtra": 25
  },
  "incomeRates": {
    "default": 100,
    "voluntary": 70
  },
  "imputed": {
    "teenOutOfSchoolPct": 25,
    "nonSeriousStudent": 1000
  },
  "student": {
    "nonSeriousCost": 300
  },
  "assets": {
    "bufferMonths": 3,
    "sufficientMonths": 12
  },
  "protection": {
    "dependentsFloorPct": 60,
    "graceMonths": 3
  },
  "thresholds": {
    "stopPct": 5,
    "partialBelowPct": 20,
    "severeFromPct": 50
  },
  "weights10": {
    "base": 10,
    "max": 18,
    "orphans": 3,
    "femaleHeadNoProvider": 2,
    "disabilityOrChronic": 2,
    "elderNoProvider": 2,
    "largeFamily": 1,
    "largeFamilyFrom": 6,
    "kinOrNeighbor": 1,
    "seriousJobSearch": 1
  },
  "empowerment": {
    "lowOutputBelowPctOfMonth": 50
  },
  "review": {
    "familyMonths": 6,
    "pricesMonths": 3,
    "RMonths": 6,
    "relativesContactMonths": 3
  },
  "oneOff": {
    "basicKit": {
      "min": 60000,
      "max": 80000,
      "label": "جهاز أساسي: ثلاجة، غسالة، بوتاجاز، تلفزيون واحد، مراتب ومفروشات، أدوات مطبخ"
    }
  },
  "reference": {
    "minWagePrivate": 7000,
    "minWagePublic": 8000,
    "cigarettePack": 48,
    "zakatFitrMin": 35,
    "povertyLineOfficial2019": 857
  },
  "labels": {
    "category": {
      "severe": "شديد الاحتياج",
      "needy": "محتاج",
      "partial": "محتاج جزئيًا",
      "sufficient": "مكتفٍ لا يُعطى"
    },
    "mode": {
      "cash-or-kind": "نقدي أو عيني حسب تفضيل الأسرة",
      "in-kind-via-mother": "عيني يُسلَّم للزوجة/الأم",
      "in-kind-or-via-mother": "عيني أو نقدي يُسلَّم للأم",
      "in-kind-only": "عيني فقط",
      "pay-provider-directly": "يُدفع للجهة مباشرة (مستشفى/صيدلية/مدرسة/مالك)",
      "in-kind": "عيني"
    },
    "form": {
      "monthly": "شهري",
      "seasonal-or-small-monthly": "موسمي أو شهري صغير"
    },
    "source": {
      "zakat": "زكاة",
      "zakat-or-sadaqa": "زكاة أو صدقة",
      "sadaqa-only": "صدقة تطوع فقط (لا زكاة)",
      "none": "لا يُعطى: نصح وتوجيه",
      "zakat-gharimin": "زكاة (سهم الغارمين) للدائن مباشرة",
      "qard-hasan-or-reschedule": "جدولة أو قرض حسن (لا زكاة الآن)",
      "zakat-or-qard-hasan": "زكاة (آلة أو رأس مال) أو قرض حسن"
    },
    "flags": {
      "empowerment": "علامة تمكين: رب أسرة قادر عاطل أو قليل الإنتاج (آلة/رأس مال/قرض حسن مرة واحدة مع متابعة)",
      "training-forsa": "ابن قادر يبحث ولا يجد: «فرصة» وتدريب وتوظيف",
      "refuser-head": "رب الأسرة قادر ويرفض العمل: العطاء مشروط وللمعالين فقط",
      "job-offer-and-advice": "عرض عمل ونصح خلال المهلة",
      "food-and-education-only": "انتهت المهلة: طعام وتعليم فقط",
      "nafaqa-lawsuit-guidance": "إرشاد الأسرة إلى دعوى النفقة",
      "head-prevents-wife-work": "الزوج يمنع زوجته من العمل مع امتناعه عن النفقة: إرشاد قانوني",
      "refuser-excluded": "فرد قادر رافض حُذف نصيبه (نقاط سالبة) ولا يُعطى",
      "able-refuser-no-dependents": "قادر رافض بلا معالين: لا يُعطى؛ إطعام عيني من الصدقة عند الضرورة",
      "smoking-quit-plan": "مدخن في الأسرة: علم سلوكي وخطة إقلاع",
      "addiction-referral": "مخدرات/قمار/مراهنات: إحالة للعلاج",
      "no-repay-vice-debts": "لا تُسدَّد ديون القمار والمخدرات",
      "child-labor": "طفل دون 15 يعمل: تُعرض منحة مشروطة بالانتظام في الدراسة",
      "school-grant-conditional": "المساعدة مشروطة بانتظام الطفل في الدراسة وتركه العمل",
      "teen-out-of-school": "ابن 15–17 خارج الدراسة: إعادة للتعليم أو تدريب مهني",
      "non-serious-student": "طالب غير جاد: تكلفة دنيا ودخل مفترض",
      "contact-relatives": "قريب موسر تلزمه النفقة ولا يدفع: تواصل اللجنة معه 3 أشهر",
      "nasser-bank": "نفقة محكوم بها ولا تُدفع: تُصرف من بنك ناصر الاجتماعي",
      "coordinate-charities": "تأخذ من جهات أخرى: تنسيق لمنع الازدواج",
      "rent-excess-luxury": "الإيجار فوق السقف: الزائد لا يُحسب",
      "spending-above-ceiling": "إنفاق فعلي فوق سقف العرف: مؤشر يستدعي التحقق",
      "medical-file": "تكلفة علاج تفوق السقف الشهري: تُفتح كملف علاج مستقل",
      "assets-partial": "أصول فائضة جزئية: حُسب منها دخل شهري (÷ 12)",
      "assets-sufficient-now": "أصول فائضة تكفي سنة: مكتفية الآن، تُعاد عند نفادها",
      "assets-rich": "فائض الأصول بلغ النصاب: غنية عند الجميع",
      "sadaqa-only-non-muslim": "أسرة غير مسلمة: من صدقة التطوع لا من زكاة المال",
      "sadaqa-only-aal-bayt": "آل البيت: من صدقة التطوع حتى تُحسم المسألة مع المفتي",
      "seasonal-priority": "سلوك إيجابي: أولوية في التمكين والمواسم (لا زيادة فوق العجز)",
      "needs-work-status": "بيانات ناقصة: حالة عمل بالغ قادر غير محددة",
      "low-verification": "توثيق ضعيف: أقل من وسيلتين من أربع"
    },
    "debt": {
      "pay-creditor-directly": "يُدفع للدائن مباشرة (ويجوز أقساطًا)",
      "needs-proof-of-inability": "يلزم إثبات العجز عن السداد",
      "not-due-yet": "لم يحلّ أجله بعد",
      "reschedule-or-qard-hasan": "جدولة مع الدائن أو قرض حسن",
      "committee-review-threat": "تهديد بحبس/طرد في دين تحسيني: يُعرض على اللجنة",
      "not-repaid-until-evident-repentance": "لا يُسدَّد إلا بعد توبة ظاهرة واستنفاد ما قبله",
      "after-repentance-and-exhausting-others": "تاب: يُنظر فيه آخر الأولويات بعد استنفاد ما قبله",
      "refer-treatment": "إحالة للعلاج",
      "negotiate-interest-and-refer-mufti": "الفوائد: تفاوض على إسقاطها وتُعرض على المفتي؛ الأصل بحسب سببه"
    },
    "oneOff": {
      "basic-list-only": "القائمة الأساسية فقط",
      "in-kind": "عينًا لا نقدًا",
      "verify-poverty-first": "بعد التحقق من الفقر",
      "reject-excess": "يُرفض الزائد عن الأساسي",
      "documents-required": "بمستندات",
      "check-state-coverage-first": "يُستنفد التأمين الصحي/نفقة الدولة أولًا",
      "inspection-required": "بمعاينة",
      "necessary-only": "الضروري فقط",
      "market-price-quote": "بسعر السوق (عرض سعر)",
      "fits-family-experience": "أصل يلائم خبرة الأسرة وقريب من السوق",
      "follow-up-12-months": "متابعة 12 شهرًا",
      "cover-consumption-so-asset-not-sold": "تغطية الاستهلاك حتى لا يُباع الأصل"
    }
  }
});
