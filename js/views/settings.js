// הגדרות ותצוגה: ערכת צבעים, מייל (Gmail), שעות שקטות, תצוגה מקדימה של מיילים שממתינים, סיכום יומי
import { S, isAdmin, render } from '../app.js';
import { isCloud } from '../db.js';
import { settings, saveSettings, pendingEmails, autoEmail, sendDigest, digestFor } from '../alerts.js';
import { gconf, setGconf, gConnect, gDisconnect, gReady, gEnabled, gmailSend, isEmail } from '../google.js';
import { LEVELS } from '../duties.js';
import { esc, h, $, $$, toast, store, select, field } from '../util.js';

export function viewSettings() {
  const theme = store('safety-theme') || 'auto';
  const st = settings(), g = gconf(), on = gEnabled() && gReady();
  const pend = pendingEmails();
  const el = h(`<div><div class="top"><div><h1>הגדרות ותצוגה</h1></div></div>
    <div class="cols even">
      <div class="card"><h2>ערכת צבעים</h2>
        <div class="seg" id="th">${[['auto', 'לפי המכשיר'], ['light', 'בהיר'], ['dark', 'כהה']].map(([k, v]) => `<button data-t="${k}" class="${theme === k ? 'on' : ''}">${v}</button>`).join('')}</div>
        <p class="small mut" style="margin-top:12px">חיבור: <b>${isCloud() ? 'ענן (Supabase), עם משתמשים והרשאות' : 'מצב הדגמה, הנתונים נשמרים רק בדפדפן הזה'}</b><br>משתמש: <b dir="ltr">${esc(S.user?.email || '')}</b></p></div>

      <div class="card"><h2>WhatsApp</h2>
        <p class="small">בשלב הזה אין חיבור ל-WhatsApp. בכל התראה יש כפתור לכל נמען: הכפתור פותח את WhatsApp במחשב או בטלפון עם הודעה מוכנה, ושולחים בלחיצה אחת. המערכת רושמת "נפתח לשליחה" עם השעה והנמען.</p>
        <p class="small mut">הטלפונים נלקחים מרשימת בעלי התפקידים בכל אתר. מספר ישראלי (05X) מומר אוטומטית לפורמט בינלאומי.</p></div>
    </div>

    <div class="card"><h2>מייל</h2>
      <p class="small mut">המיילים נשלחים מתיבת ה-Gmail שלך, בהרשאת שליחה בלבד (בלי קריאת דואר). כשהמערכת פתוחה אצלך ומחוברת, כל חריגה חדשה או חריגה שהחמירה נשלחת במייל לאחראי ולמי שמקבל לידיעה, פעם אחת לכל רמה. בלי חיבור, כפתור "מייל" בכל התראה פותח את תוכנת המייל עם הודעה מוכנה.</p>
      <div class="note small">מגבלה של שלב 1: המייל האוטומטי נשלח רק כשמישהו עם חיבור Gmail פותח את המערכת. שליחה מהשרת גם כשהמערכת סגורה היא שלב הבא.</div>
      <p>מצב: <b class="${on ? 'pos' : ''}">${on ? 'מחובר' : gEnabled() ? 'צריך להתחבר מחדש (החיבור פג אחרי שעה או בסגירת הלשונית)' : 'לא מחובר'}</b></p>
      <form id="gf"><div class="grid g2">
        <label class="fld"><span>מזהה OAuth Client ID של Google</span><input name="clientId" dir="ltr" value="${esc(g.clientId)}" placeholder="xxxx.apps.googleusercontent.com"><small>ההסבר בחוברת ההתקנה</small></label>
        ${select('לשלוח מייל מרמה', 'emailFrom', { warn: LEVELS.warn.label + ' ומעלה', red: LEVELS.red.label + ' ומעלה', crit: 'קריטי בלבד' }, st.emailFrom)}
        ${field('שעות שקטות מ-', 'quietFrom', st.quietFrom, { type: 'time' })}${field('עד', 'quietTo', st.quietTo, { type: 'time' })}
      </div><p class="small mut">בשעות השקטות לא נשלחות אזהרות. חריגות והתראות קריטיות נשלחות תמיד.</p>
      <h3 style="margin:14px 0 4px">כתובת השולח במיילים</h3>
      <p class="small mut">המיילים ממשיכים לצאת ישירות מהמערכת דרך Gmail. כאן קובעים מה יראה הנמען בשורת השולח. הכתובת חייבת להיות מוגדרת קודם ב-Gmail תחת "שליחת דואר בשם", אחרת Gmail ישלח מכתובת ה-Gmail עצמה.</p>
      <div class="grid g2">
        ${field('שם השולח', 'fromName', g.fromName, { attrs: 'maxlength="80" placeholder="יונתן גרושר | צי הנדסה"' })}
        ${field('כתובת השולח (ריק = כתובת ה-Gmail)', 'fromEmail', g.fromEmail, { type: 'email', attrs: 'dir="ltr" placeholder="Jonatan@groshar.co.il"' })}
        ${field('תשובות יגיעו אל (ריק = כתובת השולח)', 'replyTo', g.replyTo, { type: 'email', attrs: 'dir="ltr"' })}
        <label class="chk"><input type="checkbox" name="bccSelf"${g.bccSelf ? ' checked' : ''}> <span>עותק מוסתר של כל מייל לכתובת השולח</span></label>
      </div>
        <div class="actions"><button class="btn ghost" type="submit">שמירה</button>${on ? '<button class="btn ghost" type="button" id="gtest">מייל בדיקה</button><button class="btn ghost" type="button" id="gdis">ניתוק</button>' : '<button class="btn" type="button" id="gcon">התחברות ל-Gmail</button>'}</div></form></div>

    <div class="card"><h2>מיילים שממתינים לשליחה <span class="mut small">${pend.length} נמענים</span></h2>
      ${pend.length ? pend.map(p => `<div class="prow"><div><b>${esc(p.person.name)}</b> <span class="small mut" dir="ltr">${esc(p.person.email)}</span></div><div class="small">${p.items.map(x => `${esc(LEVELS[x.level].label)}: ${esc(x.duty.title)}`).slice(0, 4).join('<br>')}${p.items.length > 4 ? `<br>ועוד ${p.items.length - 4}` : ''}</div></div>`).join('') : '<div class="empty">אין מיילים שממתינים</div>'}
      <div class="actions">${on && pend.length ? '<button class="btn" id="sendNow">שליחה עכשיו</button>' : ''}${on && (isAdmin() || S.ctx.demoRole) ? `<button class="btn ghost" id="digest">שליחת סיכום יומי (${digestFor().length} נמענים)</button>` : ''}</div>
      <p class="small mut">סיכום יומי: מייל אחד לכל נמען עם כל הפריטים הפתוחים שלו. נשלח אחרון: ${esc(store('safety-digest-last') || 'עוד לא')}.</p></div></div>`);
  $$('[data-t]', el).forEach(b => b.onclick = () => {
    const t = b.dataset.t; store('safety-theme', t === 'auto' ? null : t);
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    $$('[data-t]', el).forEach(x => x.classList.toggle('on', x === b));
  });
  const f = $('#gf', el);
  f.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f));
    const fe = (v.fromEmail || '').trim(), rt = (v.replyTo || '').trim();
    if (fe && !isEmail(fe)) return toast('כתובת השולח לא תקינה', 'bad');
    if (rt && !isEmail(rt)) return toast('כתובת "תשובות יגיעו אל" לא תקינה', 'bad');
    setGconf({ clientId: v.clientId.trim(), fromName: (v.fromName || '').trim(), fromEmail: fe, replyTo: rt, bccSelf: !!v.bccSelf }); saveSettings({ emailFrom: v.emailFrom, quietFrom: v.quietFrom || '20:00', quietTo: v.quietTo || '07:00' }); toast('נשמר'); render(); };
  $('#gcon', el)?.addEventListener('click', async () => {
    const v = Object.fromEntries(new FormData(f)); if (v.clientId.trim()) setGconf({ clientId: v.clientId.trim() });
    try { await gConnect(); toast('מחובר ל-Gmail'); render(); } catch (e) { toast(e.message, 'bad'); }
  });
  $('#gdis', el)?.addEventListener('click', () => { gDisconnect(); toast('נותק'); render(); });
  // מייל בדיקה לכתובת השולח: רואים בתיבה מה מופיע בשורת השולח
  $('#gtest', el)?.addEventListener('click', async () => {
    const g = gconf(); const to = isEmail(g.fromEmail) ? g.fromEmail.trim() : prompt('לאיזו כתובת לשלוח את מייל הבדיקה?') || '';
    if (!isEmail(to)) return toast('אין כתובת לבדיקה', 'bad');
    try { await gmailSend({ to, subject: 'מייל בדיקה · צי הנדסה · ניהול בטיחות', html: `<p>זה מייל בדיקה מהמערכת.</p><p>אם בשורת השולח מופיע ${esc(g.fromEmail || 'כתובת ה-Gmail')}, ההגדרה עובדת. אם מופיעה כתובת ה-Gmail במקום, צריך להשלים ב-Gmail את "שליחת דואר בשם" (ראו חוברת ההתקנה).</p>` }); toast('מייל בדיקה נשלח ל-' + to); }
    catch (e) { toast(e.message, 'bad'); }
  });
  $('#sendNow', el)?.addEventListener('click', async e => { e.target.disabled = true; try { const n = await autoEmail(); toast(`נשלחו ${n} מיילים`); } catch (x) { toast(x.message, 'bad'); } render(); });
  $('#digest', el)?.addEventListener('click', async e => { e.target.disabled = true; try { const n = await sendDigest(); toast(`נשלח סיכום ל-${n} נמענים`); } catch (x) { toast(x.message, 'bad'); } render(); });
  return el;
}
