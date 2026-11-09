// נתוני הדגמה: יזם, שני קבלנים ראשיים ושלושה אתרים במצבים שונים. התאריכים יחסיים להיום כדי שההתראות יהיו רלוונטיות.
import { sync, spawnForEvent, dayKey } from './duties.js';

export function demoData(uuid) {
  const now = Date.now(), D = 864e5, H = 36e5;
  const day = k => new Date(now + k * D).toISOString().slice(0, 10);
  const at = k => new Date(now + k * H).toISOString();
  const T = { orgs: [], memberships: [], sites: [], site_orgs: [], site_people: [], duties: [], events: [], notifications: [], files: [], audit_log: [], checkins: [], notices: [], signatures: [], workers: [], trainings: [], training_signatures: [], equipment: [], inspections: [] };
  const org = (name, kind, reg) => { const o = { id: uuid(), name, kind, reg_no: reg, demo: true, created_at: at(-24 * 60) }; T.orgs.push(o); return o; };
  const dev = org('אופק יזמות והשקעות בע"מ (דמו)', 'developer', '515000001');
  const con1 = org('א.ב. בנייה והנדסה בע"מ (דמו)', 'contractor', '515000002');
  const con2 = org('ש.מ. קבלנות גמר בע"מ (דמו)', 'contractor', '515000003');
  const con3 = org('ר.ג. תשתיות בע"מ (דמו)', 'contractor', '515000004');

  let ph = 1;
  const person = (site, role, name, extra = {}) => T.site_people.push({ id: uuid(), site_id: site.id, role, name, phone: '050-000' + String(ph++).padStart(4, '0'),
    email: `demo${ph}@example.com`, active: true, backup: false, from_date: site.profile.start_date, created_at: at(-24 * 30), ...extra });

  const mkSite = (name, address, profile, orgs, status) => {
    const s = { id: uuid(), name, address, profile, status, demo: true, created_at: at(-24 * 90) };
    T.sites.push(s);
    for (const [o, kind] of orgs) T.site_orgs.push({ id: uuid(), site_id: s.id, org_id: o.id, kind });
    return s;
  };
  const fill = s => { const { add } = sync(s, []); for (const r of add) T.duties.push({ id: uuid(), created_at: at(-24 * 20), ...r }); };
  const done = (s, key, daysAgo, note = 'בוצע (דמו)', ref = '') => {
    const i = T.duties.find(x => x.site_id === s.id && x.key === key && x.status === 'open'); if (!i) return;
    Object.assign(i, { status: 'done', done_at: at(-24 * daysAgo), closed_at: at(-24 * daysAgo), done_by: 'דמו', evidence_note: note, evidence_ref: ref });
  };
  const resync = s => { const cur = T.duties.filter(x => x.site_id === s.id); const { add } = sync(s, cur); for (const r of add) T.duties.push({ id: uuid(), created_at: at(-1), ...r }); };
  const event = (s, type, hoursAgo, description, by) => {
    const ev = { id: uuid(), site_id: s.id, type, occurred_at: at(-hoursAgo), description, reported_by: by, created_at: at(-hoursAgo) };
    T.events.push(ev);
    for (const r of spawnForEvent(s, ev)) T.duties.push({ id: uuid(), created_at: at(-hoursAgo), ...r });
    return ev;
  };
  // צ'ק-אין לימים שעברו (חוץ מימים שמסומנים כ"פוספס"), והיום נשאר פתוח לפי הבחירה
  const checkins = (s, who, { skip = [], today = false, checks = {} } = {}) => {
    const tk = +dayKey(now);
    for (const i of T.duties.filter(x => x.site_id === s.id && x.key === 'daily_checkin' && x.status === 'open')) {
      if (i.seq === tk && !today) continue;
      if (skip.includes(i.seq)) continue;
      const t = new Date(i.due_at).getTime() - 75 * 6e4;
      const p = T.site_people.find(x => x.site_id === s.id && x.name === who);
      const c = { id: uuid(), site_id: s.id, duty_id: i.id, day: i.seq, person_id: p?.id, person_name: who, role: p?.role || 'wm', backup: !!p?.backup, at: new Date(t).toISOString(),
        lat: null, lng: null, accuracy: null, checks: Object.fromEntries(Object.entries(checks).map(([k, title]) => [k, { ok: true, note: '', title }])), note: 'עבודות לפי לוח הזמנים (דמו)', by: who, created_at: new Date(t).toISOString() };
      T.checkins.push(c);
      Object.assign(i, { status: 'done', done_at: c.at, closed_at: c.at, done_by: p?.role === 'rep' ? who.replace(/ \(.*\)$/, '') + ' (נציג מבצע הבנייה, מטעם מבצע הבנייה)' : who, evidence_note: 'נוכחות והשגחה באתר (דמו)', evidence_ref: "צ'ק-אין" });
    }
  };

  // אתר 1: בניין מגורים גדול בשלב שלד, היה פעיל לפני 16.10.2026
  const s1 = mkSite('מגדלי הים (דמו)', 'רח\' הים 12, בת ים', {
    work_type: 'new', permit_required: true, permit_no: '20250417', owner: dev.name, area: 18000, workers_max: 70, duration_weeks: 120,
    contractors: 1, foreign_workers: true, scaffolds: true, active_before: true, start_date: day(-120),
    stages: { excavation: day(-120), foundation: day(-80), skeleton: day(-40) }
  }, [[dev, 'developer'], [con1, 'contractor']], 'active');
  person(s1, 'dev', 'דנה לוי (נציגת היזם)'); person(s1, 'bakar', 'אינג\' רון כהן (בקר בטיחות)', { license: 'פנקס המהנדסים 123456' });
  person(s1, 'con', 'אבי ברק (מנכ"ל א.ב. בנייה)'); person(s1, 'sm', 'אינג\' מיכל שגיא (מנהלת אתר)', { license: 'פנקס המהנדסים 223344' });
  person(s1, 'wm', 'יוסי אדרי (מנהל עבודה)', { license: 'מרשם מנהלי עבודה 7788' }); person(s1, 'wm', 'סאמר חוראני (מנהל עבודה מחליף)', { backup: true });
  person(s1, 'so', 'נועה פרץ (ממונה בטיחות)'); person(s1, 'fa', 'משה דוד (אחראי עזרה ראשונה)');
  fill(s1);
  ['dev_bakar', 'dev_plan_check', 'dev_resources', 'con_wm', 'con_sm', 'con_plan', 'con_notice_start', 'con_sign', 'con_firstaid'].forEach(k => done(s1, k, 9, 'בוצע (דמו)', k === 'con_notice_start' ? 'אישור הגשה 2026-55120' : ''));
  done(s1, 'dev_start_approval', 8, 'אישור התחלה נחתם (דמו)');
  done(s1, 'bakar_stage_excavation', 100); done(s1, 'bakar_stage_foundation', 70);
  done(s1, 'training_annual', 110); done(s1, 'sm_control', 26); done(s1, 'sm_training', 31); done(s1, 'scaffold_weekly', 6);
  resync(s1);
  done(s1, 'sm_training', 1);
  resync(s1);
  event(s1, 'unacceptable', 28, 'פתח לא מגודר בקומה 9 ליד פיר המעלית, עובדים ללא רתמה (דמו)', 'אינג\' רון כהן (בקר בטיחות)');
  done(s1, 'con_respond', 0.8);
  event(s1, 'bakar_visit', 40, 'ביקור בשלב השלד, קומות 7 עד 10 (דמו)', 'אינג\' רון כהן (בקר בטיחות)');
  checkins(s1, 'יוסי אדרי (מנהל עבודה)', { checks: { machines: 'ביקורת גידור והתקני בטיחות במכונות (תקנה 142א)' } });

  // אתר 2: פיט-אאוט משרדים בבניין קיים, לפני התחלת עבודה
  const s2 = mkSite('משרדי הייטק הרצליה פיתוח (דמו)', 'רח\' המנופים 8, הרצליה', {
    work_type: 'fitout', completion_cert: true, engineer_needed: true, permit_required: true, permit_no: '20260212', owner: dev.name,
    area: 3200, workers_max: 25, duration_weeks: 20, contractors: 1, start_date: day(10), scaffolds: false, stages: { finishes: day(10) }
  }, [[dev, 'developer'], [con2, 'contractor']], 'planning');
  person(s2, 'dev', 'דנה לוי (נציגת היזם)'); person(s2, 'con', 'שירן מזרחי (ש.מ. קבלנות גמר)'); person(s2, 'wm', 'אלי ביטון (מנהל עבודה)', { license: 'מרשם מנהלי עבודה 9911' });
  fill(s2);
  done(s2, 'con_wm', 2, 'כתב מינוי (דמו)'); done(s2, 'con_plan', 1, 'תוכנית ארגון בטיחות חתומה (דמו)'); done(s2, 'dev_plan_check', 1);

  // אתר 3: תוספת למרכז מסחרי, פעיל מלפני התיקון, עם פערים וכמה קבלנים ראשיים
  const s3 = mkSite('מרכז מסחרי ראשון לציון (דמו)', 'שד\' רוטשילד 50, ראשון לציון', {
    work_type: 'addition', permit_required: true, permit_no: '20240988', owner: dev.name, area: 9500, workers_max: 40, duration_weeks: 60,
    contractors: 2, single_responsible: false, scaffolds: true, active_before: true, start_date: day(-200)
  }, [[dev, 'developer'], [con1, 'contractor'], [con3, 'contractor']], 'active');
  person(s3, 'dev', 'דנה לוי (נציגת היזם)'); person(s3, 'con', 'אבי ברק (מנכ"ל א.ב. בנייה)'); person(s3, 'wm', 'רמי גבאי (מנהל עבודה)', { license: 'מרשם מנהלי עבודה 4455' });
  fill(s3);
  ['con_wm', 'con_plan', 'con_notice_start', 'con_sign', 'con_firstaid'].forEach(k => done(s3, k, 150));
  done(s3, 'training_annual', 190); done(s3, 'scaffold_weekly', 10); done(s3, 'sm_control', 20); done(s3, 'sm_training', 20);
  resync(s3);
  event(s3, 'weather_stop', 30, 'הפסקת עבודה יומיים בגלל סערה (דמו)', 'רמי גבאי (מנהל עבודה)');
  checkins(s3, 'רמי גבאי (מנהל עבודה)', { today: true });

  // אתר 4: שיפוץ משרדים במבנה עם תעודת גמר, בלי שינוי קונסטרוקטיבי: פטור ממינוי מנהל עבודה (תקנה 2(ז)), נציג מבצע הבנייה באתר
  const s4 = mkSite('שיפוץ משרדים מגדל אלון, תל אביב (דמו)', 'יגאל אלון 94, תל אביב', {
    work_type: 'fitout', completion_cert: true, engineer_needed: false, permit_required: false, permit_exempt: false, owner: 'מגדל אלון ניהול (דמו)',
    area: 1400, workers_max: 18, duration_weeks: 14, contractors: 1, start_date: day(-21), scaffolds: true,
    activities: { machines: true }, work_days: [0, 1, 2, 3, 4], checkin_by: '09:00'
  }, [[con2, 'contractor']], 'active');
  person(s4, 'con', 'שירן מזרחי (ש.מ. קבלנות גמר)'); person(s4, 'rep', 'מוטי אזולאי (נציג מבצע הבנייה)', { license: 'קורס מנהלי עבודה 2019' });
  person(s4, 'rep', 'גלעד פרץ (ממלא מקום)', { backup: true }); person(s4, 'fa', 'מוטי אזולאי (נציג מבצע הבנייה)');
  fill(s4);
  done(s4, 'con_exempt_proof', 20, 'תעודת גמר 2009 והצהרת אדריכל שלא נדרש אישור מהנדס רשוי (דמו)', 'תעודת גמר 41/2009');
  done(s4, 'con_rep', 20, 'כתב הסמכה חתום, מצורף לפנקס הכללי (דמו)', 'הסמכה 1/26');
  ['con_sign', 'con_firstaid'].forEach(k => done(s4, k, 20)); done(s4, 'training_annual', 21); done(s4, 'scaffold_weekly', 3, 'נבדק, תקין (דמו)', 'פנקס עמ\' 12');
  resync(s4);
  const tk4 = T.duties.filter(x => x.site_id === s4.id && x.key === 'daily_checkin').map(x => x.seq).sort((a, b) => a - b);
  checkins(s4, 'מוטי אזולאי (נציג מבצע הבנייה)', { skip: [tk4.at(-3)], checks: { machines: 'ביקורת גידור והתקני בטיחות במכונות (תקנה 142א)' } });

  // פנקס עובדים, הדרכות וציוד (דמו). אין צילומים אמיתיים בדמו
  const born = y => new Date(now - y * 365.25 * D).toISOString().slice(0, 10);
  const worker = (site, name, extra = {}) => { const w = { id: uuid(), site_id: site.id, name, id_type: 'il', id_number: '000000018', id_photo_path: `${site.id}/workers/demo/id.jpg`, birth_date: born(30),
    company: '', trade: '', phone: '', foreign_worker: false, height: false, active: true, added_by_email: 'demo', created_at: at(-24 * 25), ...extra }; T.workers.push(w); return w; };
  const w1 = worker(s4, 'אחמד חאג׳ (דמו)', { company: con2.name, trade: 'גבס', height: true, height_until: day(9), height_path: `${s4.id}/workers/demo/h.jpg` });
  const w2 = worker(s4, 'יבגני קוזלוב (דמו)', { company: 'אלקטרו פלוס (קבלן משנה, דמו)', trade: 'חשמל', birth_date: born(41) });
  const w3 = worker(s4, 'Somchai Kaew (דמו)', { id_type: 'passport', id_number: 'AA1234567', company: con2.name, trade: 'טיח', foreign_worker: true, nationality: 'תאילנד',
    entry_date: day(-20), permit_no: '2026-77881', permit_until: day(200), birth_date: born(28) });
  worker(s4, 'דניאל אברהם (דמו)', { company: con2.name, trade: 'צבע', birth_date: born(19), created_at: at(-3) });
  const tr = { id: uuid(), site_id: s4.id, kind: 'intro', topic: 'הדרכת אתר: סיכוני האתר, פיגומים, גידור מכונות, עזרה ראשונה, יציאות חירום', trainer_name: 'מוטי אזולאי', trainer_title: 'נציג מבצע הבנייה, קורס מנהלי עבודה',
    language: 'עברית, ערבית', content: '', held_at: at(-24 * 20), pdf_path: null, closed_at: at(-24 * 20 + 1), created_by_email: 'demo', created_at: at(-24 * 20) };
  T.trainings.push(tr);
  for (const w of [w1, w2, w3]) T.training_signatures.push({ id: uuid(), training_id: tr.id, site_id: s4.id, worker_id: w.id, worker_name: w.name, statement: 'קיבלתי הדרכה (דמו)',
    image: '', signed_at: at(-24 * 20 + 0.3), signed_by_email: 'demo', created_at: at(-24 * 20 + 0.3) });
  const eq = (site, kind, name, ident, inspected, next) => { const e = { id: uuid(), site_id: site.id, kind, name, ident, owner: '', active: true, created_at: at(-24 * 60) }; T.equipment.push(e);
    if (inspected) T.inspections.push({ id: uuid(), site_id: site.id, equipment_id: e.id, inspected_at: inspected, next_due: next, inspector: 'בודק מוסמך (דמו)', cert_path: null, note: '', created_by_email: 'demo', created_at: at(-24 * 60) }); };
  eq(s1, 'lift_machine', 'עגורן צריח', 'TC-118', day(-400), day(25));
  eq(s1, 'lift_gear', 'שרשראות הרמה ומענבים', 'סט 3', day(-170), day(12));
  eq(s4, 'lift_machine', 'במת הרמה מספריים', 'SL-22', day(-60), day(365));
  return T;
}
