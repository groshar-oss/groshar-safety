// התראות וחריגות: חישוב חריגות פתוחות, נמענים והסלמה, נוסח הודעה, WhatsApp (פתיחה ידנית), מייל (Gmail מהדפדפן או mailto)
import { db } from './db.js';
import { S, siteById, visibleSites } from './app.js';
import { level, recipients, leftText, LEVELS, ROLES, CAT } from './duties.js';
import { gEnabled, gReady, gmailSend } from './google.js';
import { esc, store } from './util.js';

export const SHOW = ['crit', 'red', 'warn', 'info'];
const SETTINGS_KEY = 'safety-settings';
export const settings = () => ({ quietFrom: '20:00', quietTo: '07:00', digestAt: '07:00', emailFrom: 'warn', ...(store(SETTINGS_KEY) || {}) });
export const saveSettings = s => store(SETTINGS_KEY, { ...settings(), ...s });

// כל החריגות הפתוחות באתרים שהמשתמש רואה, מהחמורה לקלה
export function exceptions(data = S.data, sites = visibleSites(), now = Date.now()) {
  const ids = new Set(sites.map(s => s.id));
  const out = [];
  for (const i of data.duties) {
    if (i.status !== 'open' || !ids.has(i.site_id)) continue;
    const site = sites.find(s => s.id === i.site_id);
    const r = recipients(i, site, data.site_people, now);
    if (!SHOW.includes(r.level)) continue;
    out.push({ duty: i, site, ...r });
  }
  const rank = x => LEVELS[x.level].rank;
  return out.sort((a, b) => rank(b) - rank(a) || String(a.duty.due_at || '9').localeCompare(String(b.duty.due_at || '9')));
}

const fmt = t => t ? new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const ICON = { crit: '⛔', red: '🔴', warn: '🟠', info: '🔵' };
export const appUrl = () => location.href.split('#')[0];
export const dutyUrl = i => `${appUrl()}#/site/${i.site_id}/duties/${i.id}`;

// נוסח הודעה אחיד ל-WhatsApp ולמייל (בלי פרטים אישיים רגישים)
export function messageText(x) {
  const i = x.duty;
  return [
    `${ICON[x.level] || ''} ${LEVELS[x.level].label} | ${x.site.name}`,
    i.title,
    i.due_at ? `מועד: ${fmt(i.due_at)} (${leftText(i)})` : 'פתוח עד ביצוע',
    `אחראי: ${x.roles.map(r => ROLES[r]).join(', ')}`,
    x.note ? `שימו לב: ${x.note}` : '',
    `מקור: ${i.ref}`,
    `פתיחה במערכת: ${dutyUrl(i)}`
  ].filter(Boolean).join('\n');
}

// מספר ישראלי לפורמט בינלאומי ל-wa.me
export function intlPhone(p) {
  let d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d.length >= 11 ? d : '';
}
export const waLink = (phone, text) => `https://wa.me/${intlPhone(phone)}?text=${encodeURIComponent(text)}`;
export const waShare = text => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const mailtoLink = (emails, subject, body) => `mailto:${[].concat(emails).filter(Boolean).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

// רישום שליחה (WhatsApp נרשם כ"נפתח לשליחה", לא כ"נמסר")
export async function logNotification(duty, lv, person, channel, status) {
  const row = { site_id: duty.site_id, duty_id: duty.id, level: lv, channel, status, recipient_name: person?.name || '', recipient: channel === 'email' ? person?.email || '' : person?.phone || '',
    person_id: person?.id || null, sent_at: new Date().toISOString(), sent_by: window.__actor || S.user?.email || '' };
  try { const [r] = await db.insert('notifications', row); S.data.notifications.push(r); return r; } catch (e) { console.warn('notif', e); return null; }
}
export const notifsFor = dutyId => S.data.notifications.filter(n => n.duty_id === dutyId).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)));

// ===== מייל אוטומטי =====
// כשמשתמש עם חיבור Gmail פותח את המערכת: שולחים לכל נמען מייל אחד שמרכז את החריגות החדשות שלו
// (חריגה חדשה או עלייה ברמה). שעות שקטות חלות רק על אזהרות.
const inQuiet = (st, d = new Date()) => {
  const m = d.getHours() * 60 + d.getMinutes(), p = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
  const f = p(st.quietFrom), t = p(st.quietTo);
  return f > t ? m >= f || m < t : m >= f && m < t;
};
export function pendingEmails(now = Date.now()) {
  const st = settings();
  const minRank = LEVELS[st.emailFrom]?.rank ?? 3;
  const quiet = inQuiet(st, new Date(now));
  const by = new Map();
  for (const x of exceptions(S.data, visibleSites(), now)) {
    if (LEVELS[x.level].rank < minRank) continue;
    if (quiet && x.level === 'warn') continue;
    for (const p of [...x.to, ...x.cc]) {
      if (!p.email) continue;
      const sent = S.data.notifications.some(n => n.duty_id === x.duty.id && n.channel === 'email' && n.level === x.level && n.recipient === p.email && n.status === 'sent');
      if (sent) continue;
      if (!by.has(p.email)) by.set(p.email, { person: p, items: [] });
      by.get(p.email).items.push(x);
    }
  }
  return [...by.values()];
}

export function emailHtml(items, title) {
  const rows = items.map(x => `<tr><td style="padding:6px;border-bottom:1px solid #ddd;color:${LEVELS[x.level].color};font-weight:700;white-space:nowrap">${LEVELS[x.level].label}</td>
    <td style="padding:6px;border-bottom:1px solid #ddd"><b>${esc(x.site.name)}</b><br>${esc(x.duty.title)}<br><small style="color:#666">${esc(x.duty.ref)}</small></td>
    <td style="padding:6px;border-bottom:1px solid #ddd;white-space:nowrap">${esc(leftText(x.duty))}</td>
    <td style="padding:6px;border-bottom:1px solid #ddd"><a href="${dutyUrl(x.duty)}">פתיחה</a></td></tr>`).join('');
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px"><h2 style="color:#1C232C">${esc(title)}</h2>
    <table style="border-collapse:collapse;width:100%">${rows}</table>
    <p style="color:#666;font-size:12px">נשלח ממערכת ניהול הבטיחות של צי הנדסה. הפרטים המלאים מוצגים במערכת אחרי התחברות.</p></div>`;
}

let running = false;
export async function autoEmail() {
  if (running || !gEnabled() || !gReady()) return 0;
  running = true; let n = 0;
  try {
    for (const { person, items } of pendingEmails()) {
      const top = items.some(x => x.level === 'crit') ? 'crit' : items.some(x => x.level === 'red') ? 'red' : 'warn';
      const subject = `${ICON[top]} ${items.length === 1 ? `${LEVELS[items[0].level].label} | ${items[0].site.name} | ${items[0].duty.title}` : `${items.length} התראות בטיחות חדשות`}`;
      try {
        await gmailSend({ to: person.email, subject: subject.slice(0, 180), html: emailHtml(items, 'התראות בטיחות') });
        for (const x of items) await logNotification(x.duty, x.level, person, 'email', 'sent');
        n++;
      } catch (e) {
        for (const x of items) await logNotification(x.duty, x.level, person, 'email', 'failed: ' + e.message);
        if (e.auth) break;
      }
    }
  } finally { running = false; }
  return n;
}

// סיכום יומי: לכל נמען, כל החריגות הפתוחות שלו (לא רק החדשות)
export function digestFor() {
  const by = new Map();
  for (const x of exceptions()) for (const p of [...x.to, ...x.cc]) {
    if (!p.email) continue;
    if (!by.has(p.email)) by.set(p.email, { person: p, items: [] });
    by.get(p.email).items.push(x);
  }
  return [...by.values()];
}
export async function sendDigest() {
  let n = 0;
  for (const { person, items } of digestFor()) {
    await gmailSend({ to: person.email, subject: `סיכום בטיחות יומי: ${items.length} פריטים פתוחים`, html: emailHtml(items, `סיכום בטיחות יומי ל${person.name}`) });
    n++;
  }
  store('safety-digest-last', new Date().toISOString().slice(0, 10));
  return n;
}
export { siteById, CAT };
