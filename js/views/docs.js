// מסמכים להדפסה: כתב הסמכה לנציג מבצע הבנייה, ושלט אתר לפי תקנה 7
import { S, siteOrgs } from '../app.js';
import { derive, ACTIVITIES, CAT, ROLES, LAW } from '../duties.js';
import { esc, fmtDate } from '../util.js';

const page = (title, body) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&display=swap" rel="stylesheet">
<style>body{font-family:Heebo,Arial,sans-serif;color:#16213e;max-width:780px;margin:24px auto;padding:0 18px;line-height:1.6;background:#fff}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}.mut{color:#6b7491;font-size:13px}table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border:1px solid #c9d1e8;padding:6px 8px;text-align:right;vertical-align:top}th{background:#eef1fa}.sig{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:36px}
.sig div{border-top:1px solid #16213e;padding-top:6px;font-size:13px}.bar{position:sticky;top:0;background:#fff;padding:8px 0;margin-bottom:10px;border-bottom:1px solid #e3e7f1}
button{font:inherit;padding:6px 16px;border-radius:8px;border:1px solid #2f5bea;background:#2f5bea;color:#fff;cursor:pointer}
.sign{border:6px solid #0f1f4b;border-radius:14px;padding:22px 26px;font-size:20px}.sign h1{font-size:34px;text-align:center;margin-bottom:14px}.sign td{font-size:19px;padding:9px 12px}
.note{font-size:12px;color:#6b7491;margin-top:10px}@media print{.bar{display:none}body{margin:0}}</style></head>
<body><div class="bar"><button onclick="print()">הדפסה / שמירה כ-PDF</button></div>${body}</body></html>`;

function open(html) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) location.href = url;
}

// רשימת חובות מנהל העבודה שהנציג מבצע באתר הזה (לפי הפרופיל)
export function wmDutiesFor(site) {
  const d = derive(site.profile || {});
  const out = [
    ['נוכחות והשגחה באתר בכל יום עבודה, וצ\'ק-אין במערכת', 'תקנות 2(ב), 2ג'],
    ['פיקוח מטעם מבצע הבנייה על עמידה בהוראות הבטיחות לפי התקנות, וביצוע כל חובה שהוטלה על מנהל עבודה לפי כל דין', 'תקנה 2ג'],
    ['הכרת הקבלנים שנכנסים לאתר ווידוא שהם עובדים לפי הוראות הבטיחות ובתיאום ביניהם', 'ע"א 1051/14'],
    ['רישום הבדיקות וההוראות בפנקס הכללי, ושמירת העתק באתר', 'תקנה 2(ט)']
  ];
  if (d.scaffolds) out.push(['בדיקת רכיבי פיגום ופסילה; בדיקת פיגום עם ההתקנה, אחת ל-7 ימים, אחרי הפסקה ואחרי שינוי; רישום בפנקס', 'תקנות 19, 20']);
  for (const [k, [what, ref]] of Object.entries(ACTIVITIES)) if (d.act[k]) out.push([what + ': ' + ref.replace(/ \(.*\)$/, ''), ref.match(/\((.*)\)/)?.[1] || ref]);
  return out;
}

export function authLetter(site, person) {
  const con = siteOrgs(site.id, 'contractor').map(o => o.name).join(', ') || '________________';
  const backups = S.data.site_people.filter(p => p.site_id === site.id && p.role === 'rep' && p.backup && p.active !== false && p.id !== person.id);
  const rows = wmDutiesFor(site).map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('');
  open(page('כתב הסמכה · ' + person.name, `
    <h1>כתב הסמכה לנציג מבצע הבנייה באתר</h1>
    <div class="mut">לפי תקנה 2(ז) ל${esc(LAW.B)} (תיקון התשפ"ו-2025)</div>
    <h2>הצדדים והאתר</h2>
    <table><tr><th>מבצע הבנייה</th><td>${esc(con)}</td></tr><tr><th>האתר</th><td>${esc(site.name)}, ${esc(site.address || '')}</td></tr>
      <tr><th>הנציג</th><td>${esc(person.name)}${person.phone ? ' · ' + esc(person.phone) : ''}${person.email ? ' · ' + esc(person.email) : ''}</td></tr>
      ${backups.length ? `<tr><th>ממלא מקום</th><td>${backups.map(b => esc(b.name) + (b.phone ? ' · ' + esc(b.phone) : '')).join('<br>')}</td></tr>` : ''}
      <tr><th>מתאריך</th><td>${esc(fmtDate(person.from_date) || '________')}${person.to_date ? ' עד ' + esc(fmtDate(person.to_date)) : ''}</td></tr></table>
    <h2>ההסמכה</h2>
    <p>העבודות באתר הן מסוג העבודות שבתקנה 2(ז), ולכן מבצע הבנייה אינו חייב במינוי מנהל עבודה, וכל עוד לא מינה מנהל עבודה חלות עליו גם החובות החלות על מנהל עבודה.</p>
    <p>מבצע הבנייה מסמיך בזה את הנציג לבצע מטעמו, באתר, את חובות מנהל העבודה המפורטות להלן, ולהיות נוכח ומשגיח באתר בכל יום שבו מתבצעת עבודה. כשהנציג אינו באתר, ממלא מקומו מבצע את החובות.</p>
    <table><tr><th>החובה</th><th>מקור</th></tr>${rows}</table>
    <p><b>האחריות לפי הדין נשארת על מבצע הבנייה.</b> ההסמכה אינה מינוי מנהל עבודה לפי תקנה 2(א)(1), ואינה מעבירה את האחריות מבצע הבנייה לנציג.</p>
    <p>הנציג מאשר שקרא את החובות, שהוא מבין אותן, ושידווח מיד למבצע הבנייה על כל סיכון שאינו קביל או על כל מצב שבו אינו יכול לבצע אותן.</p>
    <div class="sig"><div>מבצע הבנייה: שם, תפקיד, חתימה וחותמת</div><div>הנציג: ${esc(person.name)}, חתימה</div><div>תאריך</div><div>תאריך</div></div>
    <p class="note">את הכתב החתום מצרפים במערכת לחובה "רישום נציג מבצע הבנייה באתר", ומצרפים עותק לפנקס הכללי באתר (תקנה 2(ט)). המסמך הופק ממערכת ניהול הבטיחות של גרושר פרויקטים ואינו חוות דעת משפטית.</p>`));
}

// שלט אתר: הפרטים של תקנה 7. באתר 2(ז) בלי מנהל עבודה מוצג הנציג (המלצה; הנוסח של תקנה 7 לא כולל פטור מפורש)
export function siteSign(site) {
  const d = derive(site.profile || {});
  const P = r => S.data.site_people.filter(p => p.site_id === site.id && p.role === r && p.active !== false && !p.backup);
  const con = siteOrgs(site.id, 'contractor'), dev = siteOrgs(site.id, 'developer');
  const wm = P('wm')[0], rep = P('rep')[0], bakar = P('bakar')[0], sm = P('sm')[0];
  const WT = { new: 'בנייה חדשה', addition: 'תוספת בנייה', fitout: 'עבודות גמר ופיט-אאוט', renovation: 'עבודות שיפוץ', infra: 'תשתיות ופיתוח', demolition: 'הריסה', gas: 'החלפת מיתקן גז' };
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const wmRow = wm ? `${esc(wm.name)}${wm.phone ? ' · ' + esc(wm.phone) : ''}`
    : d.exempt27 ? `אין חובת מינוי (תקנה 2(ז)).<br>אחראי מטעם מבצע הבנייה: ${rep ? esc(rep.name) + (rep.phone ? ' · ' + esc(rep.phone) : '') : '________'}` : '<b style="color:#c62828">לא מונה. אסור לעבוד בלי מנהל עבודה</b>';
  open(page('שלט אתר · ' + site.name, `<div class="sign"><h1>אתר בנייה</h1><table>
    ${row('מבצע הבנייה', con.map(o => esc(o.name)).join(', ') || '________')}
    ${row('מנהל העבודה', wmRow)}
    ${row('מהות העבודה', esc(WT[site.profile?.work_type] || '') + (site.address ? ' · ' + esc(site.address) : ''))}
    ${dev.length ? row('המזמין', dev.map(o => esc(o.name)).join(', ')) : ''}
    ${d.clientDuties ? row('בקר הבטיחות', bakar ? `${esc(bakar.name)}${bakar.license ? ' · ' + esc(bakar.license) : ''}` : '________') : ''}
    ${d.siteMgr ? row('מנהל האתר', sm ? `${esc(sm.name)}${sm.license ? ' · ' + esc(sm.license) : ''}` : '________') : ''}
    </table></div>
    <p class="note">לפי תקנה 7 ל${esc(LAW.B)}: שם מבצע הבנייה ומענו, שם מנהל העבודה ומענו, מהות העבודה, ושם המזמין, בקר הבטיחות ומנהל האתר עם מספרי רישום, כשהם קיימים. כדאי להוסיף את כתובות המען בשלט המודפס.
    ${d.exempt27 && !wm ? '<br>באתר בלי חובת מינוי מנהל עבודה, תקנה 7 לא אומרת מה לכתוב בשדה הזה. הצגת האחראי מטעם מבצע הבנייה היא המלצה של המערכת.' : ''}</p>`));
}
export { CAT, ROLES };
