// הודעות רשמיות שממתינות לאישור: המערכת מכינה טיוטה מנתוני האתר, האחראי מאשר, ורק אחר כך שולחים.
// gov = טופס מקוון של משרד העבודה (אין ממשק להגשה אוטומטית: המערכת מכינה את השדות ופותחת את הטופס)
// email = מייל לבעלי התפקידים, נשלח מ-Gmail המחובר אחרי האישור
// letter = מכתב רשמי להדפסה וחתימה
import { db } from './db.js';
import { S, siteOrgs } from './app.js';
import { derive, ROLES, LAW } from './duties.js';
import { fmtDate } from './util.js';

export const GOV = {
  site: { label: 'הודעה על פעולת בנייה חדשה ועל מינוי בעלי תפקידים באתר', form: 'https://auth.govforms.gov.il/mw/forms/InformConstructionSiteV3@labor.gov.il',
    info: 'https://www.gov.il/he/service/notice-construction-activities-and-officials-on-the-site',
    decl: 'https://www.gov.il/BlobFolder/service/notice-construction-activities-and-officials-on-the-site/he/safety-and-health_notice-construction-activities.pdf',
    tip: 'לטופס מצרפים תצהיר חתום בידי מבצע הבנייה, המזמין ובעלי התפקידים באתר.' },
  accident: { label: 'דיווח על תאונת עבודה', form: 'https://govforms.gov.il/mw/forms/JobAccidentNotice@labor.gov.il', info: 'https://www.gov.il/he/service/report-of-a-work-accident',
    tip: 'אפשר לצרף לדיווח תמונות מהזירה ומסמכים.' },
  safety: { label: 'טופס הפסקת עבודה לפי התוספת הראשונה', form: '', info: 'https://www.gov.il/he/departments/topics/safety-at-workplace',
    tip: 'הקישור הוא לדף הבטיחות של משרד העבודה. את הטופס עצמו מאתרים שם.' }
};
export const CHANNEL = { gov: 'טופס מקוון למפקח העבודה', email: 'מייל', letter: 'מכתב רשמי' };
export const NST = { draft: 'ממתינה לאישור', approved: 'אושרה, ממתינה לשליחה', sent: 'נשלחה', cancelled: 'בוטלה' };

const WT = { new: 'בנייה חדשה', addition: 'תוספת בנייה', fitout: 'עבודות גמר ופיט-אאוט', renovation: 'עבודות שיפוץ', infra: 'תשתיות ופיתוח', demolition: 'הריסה', gas: 'החלפת מיתקן גז' };
const dt = t => t ? new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const people = (site, ...roles) => S.data.site_people.filter(p => p.site_id === site.id && roles.includes(p.role) && p.active !== false && !p.backup);
const personLine = p => p ? [p.name, p.license && 'רישום ' + p.license, p.phone, p.email, p.from_date && 'מ-' + fmtDate(p.from_date)].filter(Boolean).join(' · ') : '';
const orgLine = o => [o.name, o.reg_no && 'ח"פ ' + o.reg_no, o.contractor_reg && 'קבלן רשום ' + o.contractor_reg].filter(Boolean).join(' · ');
const eventOf = duty => duty.event_id ? S.data.events.find(e => e.id === duty.event_id) : null;

function siteFields(site) {
  const p = site.profile || {}, d = derive(p);
  const f = [
    ['שם האתר', site.name], ['כתובת האתר', site.address || ''],
    ['מספר היתר', p.permit_no || (p.permit_exempt ? 'פטור מהיתר' : '')],
    ['מהות העבודה', WT[p.work_type] || ''], ['שטח לפי ההיתר (מ"ר)', p.area ? String(p.area) : ''],
    ['מועד תחילת העבודה', fmtDate(p.start_date) || ''], ['משך צפוי (שבועות)', p.duration_weeks ? String(p.duration_weeks) : ''],
    ['מספר עובדים מרבי בו-זמנית', p.workers_max ? String(p.workers_max) : ''],
    ['המזמין (יזם)', siteOrgs(site.id, 'developer').map(orgLine).join('; ')],
    ['מבצע הבנייה', siteOrgs(site.id, 'contractor').map(orgLine).join('; ')]
  ];
  if (!d.exempt27 || people(site, 'wm').length) f.push(['מנהל העבודה', personLine(people(site, 'wm')[0])]);
  if (d.siteMgr) f.push(['מנהל האתר', personLine(people(site, 'sm')[0])]);
  if (d.clientDuties) f.push(['בקר הבטיחות', personLine(people(site, 'bakar')[0])]);
  return f;
}
const sign = (site, ...roles) => { const p = people(site, ...roles)[0]; return `\n\nבברכה,\n${p ? p.name + ', ' + ROLES[p.role] : ROLES[roles[0]]}\n${site.name}`; };
const toList = (site, ...roles) => people(site, ...roles).filter(p => p.email).map(p => ({ name: p.name, email: p.email, role: p.role }));

// התבנית לכל חובה. build מחזיר את התוכן ההתחלתי של הטיוטה
export const NOTICES = {
  con_notice_start: { channel: 'gov', gov: 'site', build: site => ({ fields: [['סוג ההודעה', 'התחלת פעולות בנייה ומינוי בעלי תפקידים'], ...siteFields(site)] }) },
  con_wm: { channel: 'gov', gov: 'site', build: site => ({ fields: [['סוג ההודעה', 'מינוי מנהל עבודה'], ...siteFields(site)] }) },
  con_sm: { channel: 'gov', gov: 'site', build: site => ({ fields: [['סוג ההודעה', 'מינוי מנהל אתר'], ...siteFields(site)] }) },
  con_wm_replace: { channel: 'gov', gov: 'site', build: site => ({ fields: [['סוג ההודעה', 'מינוי מנהל עבודה חדש'], ...siteFields(site)] }) },
  dev_bakar_replace: { channel: 'gov', gov: 'site', build: site => ({ fields: [['סוג ההודעה', 'מינוי בקר בטיחות מחליף'], ...siteFields(site)] }) },
  con_role_left_notice: { channel: 'gov', gov: 'site', build: (site, duty) => { const e = eventOf(duty);
    return { fields: [['סוג ההודעה', 'בעל תפקיד הפסיק לכהן'], ['מועד הפסקת הכהונה', dt(e?.occurred_at)], ['פרטים', e?.description || ''], ...siteFields(site)] }; } },
  con_notice_end: { channel: 'gov', gov: 'site', build: (site, duty) => ({ fields: [['סוג ההודעה', 'סיום עבודות הבנייה'], ['מועד סיום העבודה', fmtDate(eventOf(duty)?.occurred_at || new Date().toISOString())], ...siteFields(site)] }) },
  accident_notice: { channel: 'gov', gov: 'accident', build: (site, duty) => { const e = eventOf(duty);
    const a = (S.data.accident_reports || []).find(r => r.event_id === e?.id);
    return { fields: [['מקום התאונה', [site.name, site.address, a?.place].filter(Boolean).join(', ')], ['המעסיק', siteOrgs(site.id, 'contractor').map(orgLine).join('; ')],
      ['מועד התאונה', dt(a?.occurred_at || e?.occurred_at)], ['תיאור התאונה', a?.how || e?.description || ''], ['פרטי הנפגע (שם, ת"ז, תפקיד)', a ? [a.injured_name, a.injured_id].filter(Boolean).join(', ') : ''],
      ['חומרת הפגיעה', a ? [a.injury, a.evac ? 'פונה אל ' + a.evac : ''].filter(Boolean).join('. ') : '']] }; } },
  so_stop_notice: { channel: 'gov', gov: 'safety', build: (site, duty) => { const e = eventOf(duty);
    return { fields: [['האתר', [site.name, site.address].filter(Boolean).join(', ')], ['מבצע הבנייה', siteOrgs(site.id, 'contractor').map(orgLine).join('; ')],
      ['הממונה על הבטיחות', personLine(people(site, 'so')[0])], ['מועד הפסקת העבודה', dt(e?.occurred_at)], ['הסיבה להפסקה', e?.description || '']] }; } },

  dev_bakar: { channel: 'email', to: ['con'], build: site => { const b = people(site, 'bakar')[0];
    return { subject: `פרטי בקר הבטיחות · ${site.name}`, body: `שלום,\n\nלהלן פרטי בקר הבטיחות שמונה לאתר ${site.name}:\n${b ? personLine(b) : '(עוד לא נרשם בקר בטיחות בלשונית בעלי תפקידים)'}\n\nהודעה לפי ${LAW.B}, תקנות 1א(א)(3) ו-2א(א).${sign(site, 'dev')}` }; } },
  dev_bakar_left: { channel: 'email', to: ['con'], build: (site, duty) => { const e = eventOf(duty);
    return { subject: `בקר הבטיחות סיים כהונה · ${site.name}`, body: `שלום,\n\nבקר הבטיחות באתר ${site.name} סיים את כהונתו${e ? ' ביום ' + dt(e.occurred_at) : ''}.${e?.description ? '\n' + e.description : ''}\nעד מינוי בקר מחליף, חובות הבקר חלות על היזם (תקנה 1א(ב)).${sign(site, 'dev')}` }; } },
  sm_stop_report: { channel: 'email', to: ['con', 'dev', 'bakar'], build: (site, duty) => { const e = eventOf(duty);
    return { subject: `הפסקת עבודה באתר ${site.name}`, body: `שלום,\n\nהופסקה העבודה באתר ${site.name}${e ? ' ביום ' + dt(e.occurred_at) : ''}, בשל סיכון שאינו קביל שחסרים משאבים למענה עליו.\n${e?.description || ''}\n\nדיווח לפי תקנה 2ב(ב)(5).${sign(site, 'sm', 'wm')}` }; } },
  so_report48: { channel: 'email', to: ['wm', 'sm'], build: (site, duty) => { const e = eventOf(duty);
    return { subject: `דיווח ממונה הבטיחות · ${site.name}`, body: `שלום,\n\nממצאי הממונה על הבטיחות באתר ${site.name}${e ? ' מיום ' + dt(e.occurred_at) : ''}:\n${e?.description || ''}\n\nמפגעים מדיווחים קודמים שטרם הוסרו:\n\n\nדיווח לפי תקנה 5א(א). העתק מצורף לפנקס הכללי.${sign(site, 'so')}` }; } },
  bakar_report: { channel: 'email', to: ['dev', 'con'], build: (site, duty) => { const e = eventOf(duty);
    return { subject: `דוח ביקור בקר הבטיחות · ${site.name}`, body: `שלום,\n\nדוח ממצאי ביקור בקר הבטיחות באתר ${site.name}${e ? ' מיום ' + dt(e.occurred_at) : ''}:\n${e?.description || ''}\n\nממצאים:\n\n\nהמלצות:\n\n\nדוח לפי תקנה 2א(ב)(3). מבצע הבנייה מצרף אותו לפנקס הכללי.${sign(site, 'bakar')}` }; } },

  dev_multi: { channel: 'letter', build: site => { const cons = siteOrgs(site.id, 'contractor');
    return { subject: 'הודעה על קבלת אחריות כוללת של מבצע בנייה (תקנה 6(ד))', fields: [['אל', 'מפקח העבודה האזורי'], ['האתר', [site.name, site.address].filter(Boolean).join(', ')],
      ['המזמין', siteOrgs(site.id, 'developer').map(orgLine).join('; ')], ['הקבלנים הראשיים באתר', cons.map(orgLine).join('; ')], ['הקבלן שמקבל את האחריות הכוללת', cons[0] ? orgLine(cons[0]) : '']],
      body: `העבודה באתר מוטלת על יותר מקבלן ראשי אחד. הקבלן הנקוב לעיל מקבל בזה על עצמו בכתב את האחריות הכוללת כמבצע הבנייה באתר, לפי תקנה 6(ד) ל${LAW.B}.` }; } }
};
export const noticeFor = duty => S.data.notices?.filter(n => n.duty_id === duty.id && n.status !== 'cancelled').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
export const needsApproval = duty => !!NOTICES[duty.key] && duty.status === 'open' && (noticeFor(duty)?.status ?? 'draft') === 'draft';

export function draftFor(site, duty) {
  const t = NOTICES[duty.key]; if (!t) return null;
  const b = t.build(site, duty);
  return { site_id: site.id, duty_id: duty.id, key: duty.key, channel: t.channel, status: 'draft', title: duty.title,
    to_list: t.channel === 'email' ? toList(site, ...t.to) : [], subject: b.subject || duty.title, body: b.body || '', fields: b.fields || [] };
}
export async function ensureDraft(site, duty) {
  const cur = noticeFor(duty); if (cur) return cur;
  const row = draftFor(site, duty); if (!row) return null;
  const [r] = await db.insert('notices', row); (S.data.notices ||= []).push(r); return r;
}
export async function saveNotice(n, patch) {
  const r = await db.update('notices', n.id, { ...patch, updated_at: new Date().toISOString() });
  Object.assign(S.data.notices.find(x => x.id === n.id), r); return S.data.notices.find(x => x.id === n.id);
}
// טקסט אחד לכל השדות (להעתקה לטופס או למייל)
export const fieldsText = n => (n.fields || []).map(([k, v]) => `${k}: ${v || ''}`).join('\n');
export const emptyFields = n => (n.fields || []).filter(([, v]) => !String(v || '').trim()).map(([k]) => k);
