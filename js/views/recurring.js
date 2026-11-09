// משימות חוזרות באתר: רשימה אחת לפי תדירות, רק מה שחל על האתר, עם הביצוע האחרון והמועד הבא
import { S } from '../app.js';
import { derive, LAW, ROLES, level } from '../duties.js';
import { esc, h } from '../util.js';
import { fmtDT, chip } from './common.js';
import { checkinsFor } from './checkin.js';
import { canSeeWorkers } from './workers.js';

const B = LAW.B;
// [תדירות, משימה, מקור, אחראי, מתי חל, מקור נתונים]
const ROWS = [
  ['day', 'נוכחות והשגחה באתר (צ׳ק-אין)', `תקנות 2(ב), 2ג ל${B}`, 'wm', () => true, { checkin: true }],
  ['day', 'ביקורת חפירה, מילוי, חציבה או דיפון לפני תחילת העבודה', `תקנה 122 ל${B}`, 'wm', d => d.act.excavation, { checkin: true }],
  ['day', 'ביקורת גידור והתקני בטיחות במכונות', `תקנה 142א ל${B}`, 'wm', d => d.act.machines, { checkin: true }],
  ['use', 'פיגום חדש: בדיקה עם ההתקנה ולפני השימוש', `תקנות 19, 20(ב) ל${B}`, 'wm', d => d.scaffolds, { key: 'scaffold_install_check' }],
  ['use', 'פיגום אחרי הפסקה של 3 ימים, גשם או רוח, או שינוי', `תקנה 20 ל${B}`, 'wm', d => d.scaffolds, { key: 'scaffold_recheck' }],
  ['use', 'טפסות לפני יציקה', `תקנה 84 ל${B}`, 'wm', d => d.act.formwork, { key: 'formwork_check' }],
  ['use', 'התקן הרמה (גלגלת) עם ההתקנה ולפני שימוש', `תקנה 172 ל${B}`, 'wm', d => d.act.hoist, { key: 'hoist_check' }],
  ['use', 'עובד חדש: הדרכה לפני תחילת העבודה', `תקנה 3(א) ל${LAW.H}`, 'wm', () => true, { exp: 'exp_train', tab: 'workers' }],
  ['use', 'מכונת הרמה או אביזר הרמה חדש: תסקיר לפני שימוש ראשון', `סעיפים 76, 86 ל${LAW.P}`, 'con', () => true, { exp: 'exp_equip', tab: 'equipment' }],
  ['week', 'בדיקת פיגומים ורישום בפנקס הכללי, לפחות אחת ל-7 ימים', `תקנה 20 ל${B}`, 'wm', d => d.scaffolds, { key: 'scaffold_weekly' }],
  ['month', 'בקרת יישום המענים בתוכנית הבטיחות ודוח, כל 30 יום', `תקנות 2ב(ב)(2), 2(ח) ל${B}`, 'sm', d => d.siteMgr || !d.exempt27, { key: 'sm_control' }],
  ['month', 'בקרת קיום הדרכות לעובדים ודוח, כל 30 יום', `תקנות 2ב(ב)(4), 2(ח) ל${B}`, 'sm', d => d.siteMgr || !d.exempt27, { key: 'sm_training' }],
  ['entry', 'עובד זר: הדרכה של 8 שעות במוסד מוכר, לפני תום חודש מהכניסה לישראל', `תקנה 3א ל${LAW.H}`, 'wm', () => true, { exp: 'exp_f8', tab: 'workers' }],
  ['quarter', 'ביקור בקר בטיחות, ודוח תוך 48 שעות', `תקנות 2א(ב)(1), 2א(ב)(3) ל${B}`, 'bakar', d => d.clientDuties, { key: 'bakar_visit' }],
  ['half', 'שרשראות, חבלים ואביזרי הרמה: בדיקת בודק מוסמך', `סעיף 75 ל${LAW.P}`, 'con', () => true, { exp: 'exp_equip', tab: 'equipment', eqKind: 'lift_gear' }],
  ['m14', 'מכונת הרמה: תסקיר בודק מוסמך', `סעיף 81 ל${LAW.P}`, 'con', () => true, { exp: 'exp_equip', tab: 'equipment', eqKind: 'lift_machine' }],
  ['year', 'הדרכת בטיחות פרונטלית לכל עובד ורישום בפנקס ההדרכה', `תקנות 3(א), 6 ל${LAW.H}`, 'wm', () => true, { exp: 'exp_train', tab: 'workers' }],
  ['y2', 'אישור עבודה בגובה בתוקף לכל עובד בגובה', `תקנות 5, 6(ג), 6(ד) ל${LAW.G}`, 'wm', () => true, { exp: 'exp_height', tab: 'workers' }],
  ['permit', 'עובד זר: היתר והרשאה לעבוד בישראל בתוקף', `סעיפים 1יג, 2 ל${LAW.F}`, 'wm', () => true, { exp: 'exp_permit', tab: 'workers' }]
];
const FREQ = { day: 'כל יום עבודה', use: 'לפני שימוש או אחרי אירוע', week: 'שבועי', month: 'חודשי', entry: 'חודש מהכניסה לישראל', quarter: 'רבעוני', half: 'חצי שנתי', m14: 'כל 14 חודשים', year: 'שנתי', y2: 'לפי תוקף (עד שנתיים)', permit: 'לפי תוקף ההיתר' };

export function tabRecurring(s) {
  const d = derive(s.profile || {});
  const duties = S.data.duties.filter(x => x.site_id === s.id);
  const now = Date.now();
  const holder = r => (r === 'wm' && d.exempt27 && !S.data.site_people.some(p => p.site_id === s.id && p.role === 'wm' && p.active !== false)) ? ROLES.rep.replace(/ \(.*\)$/, '') : r === 'sm' && !d.siteMgr ? 'מנהל העבודה (אין מנהל אתר)' : ROLES[r];
  const seeW = canSeeWorkers(s.id);
  const row = ([f, title, ref, who, applies, src]) => {
    if (!applies(d)) return '';
    let last = '', next = '', lv = '';
    if (src.checkin) {
      const c = checkinsFor(s.id)[0]; last = c ? fmtDT(c.at) : '';
      const t = duties.find(x => x.key === 'daily_checkin' && x.status === 'open'); if (t) { next = fmtDT(t.due_at); lv = level(t, now); }
    } else if (src.key) {
      const all = duties.filter(x => x.key === src.key);
      const done = all.filter(x => x.status === 'done').sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)))[0];
      const open = all.filter(x => x.status === 'open').sort((a, b) => String(a.due_at || '9').localeCompare(String(b.due_at || '9')))[0];
      last = done ? fmtDT(done.done_at) : ''; next = open ? (open.due_at ? fmtDT(open.due_at) : 'פתוח') : f === 'use' ? 'לפי אירוע' : ''; lv = open ? level(open, now) : '';
    } else if (src.exp) {
      let open = duties.filter(x => x.status === 'open' && x.key.startsWith(src.exp + ':'));
      if (src.eqKind) open = open.filter(x => (S.data.equipment || []).find(e => e.id === x.key.split(':')[1])?.kind === src.eqKind);
      const bad = open.filter(x => ['crit', 'red'].includes(level(x, now))).length, warn = open.filter(x => level(x, now) === 'warn').length;
      const first = open.sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))[0];
      next = first ? `הקרוב: ${fmtDT(first.due_at)}` : src.tab === 'workers' && !seeW ? '' : 'אין';
      last = bad ? `<span class="neg">${bad} פג או חסר</span>` : warn ? `<span style="color:#e08a00">${warn} פג בקרוב</span>` : open.length ? `${open.length} בתוקף` : '';
      lv = bad ? 'crit' : warn ? 'warn' : '';
    }
    const link = src.tab ? `#/site/${s.id}/${src.tab}` : src.checkin ? `#/site/${s.id}/log` : `#/site/${s.id}/duties`;
    return `<a class="rrow" href="${link}"><div><b>${esc(title)}</b><div class="small mut">${esc(holder(who))} · § ${esc(ref)}</div></div>
      <div class="small rr2">${lv && ['crit', 'red', 'warn'].includes(lv) ? chip(lv) + ' ' : ''}${last ? `<div>${src.exp ? last : 'אחרון: ' + last}</div>` : ''}${next ? `<div class="mut">${src.exp ? next : 'הבא: ' + next}</div>` : ''}</div></a>`;
  };
  const groups = Object.keys(FREQ).map(f => [f, ROWS.filter(r => r[0] === f).map(row).join('')]).filter(([, x]) => x);
  return h(`<div><div class="card"><h2>משימות חוזרות באתר</h2><p class="small mut">רק המשימות שחלות על האתר לפי הפרופיל המשפטי. לחיצה פותחת את המקום שבו מבצעים ומתעדים.</p></div>
    ${groups.map(([f, x]) => `<div class="card"><h3>${FREQ[f]}</h3>${x}</div>`).join('')}</div>`);
}
