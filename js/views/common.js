// רכיבים משותפים: תגית רמה, כרטיס חובה, כפתורי שליחה, חלון חובה (ביצוע / לא חל / דחייה)
import { db } from '../db.js';
import { S, canAct, canWaive, siteById, syncSite, render, hasRole } from '../app.js';
import { CAT, LEVELS, ROLES, level, leftText, recipients, gateStatus, EVENTS } from '../duties.js';
import { messageText, waLink, waShare, mailtoLink, logNotification, notifsFor } from '../alerts.js';
import { esc, h, $, $$, modal, toast, field, area, fmtDate } from '../util.js';
import { checkinForm } from './checkin.js';
import { NOTICES, GOV, CHANNEL, NST, noticeFor, needsApproval, ensureDraft, saveNotice, fieldsText, emptyFields } from '../notices.js';
import { gReady, gmailSend, isEmail } from '../google.js';
import { noticeLetter } from './docs.js';
import { expiryLink } from '../workers.js';

export const fmtDT = t => t ? new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const chip = lv => `<span class="chip lv-${lv} ${LEVELS[lv].chip}">${LEVELS[lv].label}</span>`;
export const sideName = s => s === 'dev' ? 'צד היזם' : 'צד הקבלן';

// אחוז עמידה: מתוך החובות שחלות (המופע האחרון של כל חובה), כמה לא בחריגה
export function compliance(siteId, now = Date.now()) {
  const list = S.data.duties.filter(d => d.site_id === siteId && d.status !== 'na');
  const latest = new Map();
  for (const d of list) {
    const k = d.event_id ? d.id : d.key;
    const cur = latest.get(k);
    if (!cur || (cur.status !== 'open' && (d.status === 'open' || String(d.created_at) > String(cur.created_at)))) latest.set(k, d);
  }
  const arr = [...latest.values()];
  const bad = arr.filter(d => ['red', 'crit'].includes(level(d, now)));
  return { total: arr.length, bad: bad.length, pct: arr.length ? Math.round(100 * (arr.length - bad.length) / arr.length) : 100 };
}
export const gauge = c => `<div class="gauge" title="${c.total - c.bad} מתוך ${c.total} חובות בלי חריגה"><b style="color:${c.pct >= 95 ? '#13804a' : c.pct >= 80 ? '#e08a00' : '#c62828'}">${c.pct}%</b><span>עמידה בחובות</span></div>`;

// כרטיס חובה (טלפון קודם)
export function dutyCard(i, { showSite = false } = {}) {
  const site = siteById(i.site_id);
  const r = recipients(i, site, S.data.site_people);
  const lv = r.level;
  return `<a class="duty lv-${lv}" href="#/site/${i.site_id}/duties/${i.id}">
    <div class="dh">${chip(lv)}${i.critical ? '<span class="chip red">חובה קריטית</span>' : ''}<span class="chip">${sideName(i.side)}</span>${showSite ? `<span class="chip violet">${esc(site?.name || '')}</span>` : ''}${needsApproval(i) ? '<span class="chip amber">הודעה ממתינה לאישור</span>' : ''}</div>
    <div class="dt">${esc(i.title)}</div>
    <div class="dm">${i.status === 'open' ? esc(leftText(i)) + (i.due_at ? ' · ' + fmtDT(i.due_at) : '') : i.status === 'done' ? 'בוצע ' + fmtDate(i.done_at) : i.status === 'waived' ? 'נסגר בדחייה מוצדקת' : 'לא חל'}
      · אחראי: ${esc(r.roles.map(x => ROLES[x]).join(', '))}</div>
    ${r.note ? `<div class="dn">${esc(r.note)}</div>` : ''}</a>`;
}

// כפתורי שליחה: WhatsApp לכל נמען (נפתח עם הודעה מוכנה), מייל, העתקה
export function sendBlock(x) {
  const text = messageText(x);
  const ppl = [...x.to.map(p => [p, 'אחראי']), ...x.cc.map(p => [p, 'לידיעה'])];
  const emails = ppl.map(([p]) => p.email).filter(Boolean);
  return `<div class="send">
    <div class="small mut">שליחה ב-WhatsApp: נפתחת הודעה מוכנה, ושולחים בלחיצה באפליקציה.</div>
    <div class="wa-list">${ppl.length ? ppl.map(([p, k]) => p.phone ? `<button type="button" class="btn small wa" data-wa="${p.id}">WhatsApp · ${esc(p.name)} <span class="mut">(${k})</span></button>` : `<span class="chip">${esc(p.name)}: אין טלפון</span>`).join('') : '<span class="mut small">אין נמענים מוגדרים לאתר. מוסיפים בעלי תפקידים בלשונית "בעלי תפקידים".</span>'}</div>
    <div class="actions">
      <button type="button" class="btn small ghost" data-wa-any>WhatsApp לקבוצה (בחירת נמען)</button>
      ${emails.length ? `<a class="btn small ghost" data-mail href="${esc(mailtoLink(emails, `${LEVELS[x.level].label} | ${x.site.name} | ${x.duty.title}`.slice(0, 150), text))}">מייל לכל הנמענים</a>` : ''}
      <button type="button" class="btn small ghost" data-copy>העתקת ההודעה</button>
    </div></div>`;
}
export function wireSend(root, x) {
  const text = messageText(x);
  const all = [...x.to, ...x.cc];
  $$('[data-wa]', root).forEach(b => b.onclick = async () => {
    const p = all.find(q => q.id === b.dataset.wa);
    window.open(waLink(p.phone, text), '_blank', 'noopener');
    await logNotification(x.duty, x.level, p, 'whatsapp', 'opened');
    b.classList.add('done'); b.insertAdjacentHTML('beforeend', ' ✓');
  });
  $('[data-wa-any]', root)?.addEventListener('click', async () => { window.open(waShare(text), '_blank', 'noopener'); await logNotification(x.duty, x.level, { name: 'קבוצה / נמען לבחירה' }, 'whatsapp', 'opened'); });
  $('[data-mail]', root)?.addEventListener('click', async () => { for (const p of all.filter(q => q.email)) await logNotification(x.duty, x.level, p, 'email', 'mailto'); });
  $('[data-copy]', root)?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('ההודעה הועתקה'); } catch { toast('ההעתקה נכשלה', 'bad'); } });
}

const CH = { whatsapp: 'WhatsApp', email: 'מייל' };
const ST = { opened: 'נפתח לשליחה', sent: 'נשלח', mailto: 'נפתח בתוכנת המייל', marked: 'סומן כנשלח' };

// חלון חובה: פרטים, נמענים, היסטוריית שליחה ופעולות
export async function openDuty(id) {
  const i = S.data.duties.find(d => d.id === id); if (!i) return toast('החובה לא נמצאה', 'bad');
  const site = siteById(i.site_id), c = CAT[i.key] || {};
  const x = { duty: i, site, ...recipients(i, site, S.data.site_people) };
  const ev = i.event_id ? S.data.events.find(e => e.id === i.event_id) : null;
  const hist = notifsFor(i.id);
  const act = i.status === 'open' && canAct(i), waive = i.status === 'open' && canWaive(i);
  const isGate = i.key === 'dev_start_approval', gate = gateStatus(S.data.duties.filter(d => d.site_id === i.site_id));
  if (NOTICES[i.key] && i.status === 'open' && act) { try { await ensureDraft(site, i); } catch (e) { console.warn('notice', e); } }
  const nt = NOTICES[i.key] ? noticeFor(i) : null;
  const body = `<div class="dd">
    <div class="dh">${chip(x.level)}${i.critical ? '<span class="chip red">חובה קריטית</span>' : ''}<span class="chip">${sideName(i.side)}</span><span class="chip violet">${esc(site.name)}</span></div>
    <p class="ref"><b>§</b> ${esc(i.ref)}</p>
    ${c.plain ? `<p>${esc(c.plain)}</p>` : ''}
    ${ev ? `<div class="note">נוצר מאירוע: <b>${esc(EVENTS[ev.type]?.label || ev.type)}</b> · ${fmtDT(ev.occurred_at)}${ev.description ? '<br>' + esc(ev.description) : ''}</div>` : ''}
    <div class="kv"><span>מועד</span><b>${i.due_at ? fmtDT(i.due_at) + ' · ' + esc(leftText(i)) : 'ללא מועד, פתוח עד ביצוע'}</b>
      <span>אחראי</span><b>${esc(x.roles.map(r => ROLES[r]).join(', '))}${x.to.length ? ': ' + esc(x.to.map(p => p.name).join(', ')) : ' (לא הוגדר אדם)'}</b>
      ${x.cc.length ? `<span>לידיעה</span><b>${esc(x.cc.map(p => p.name).join(', '))}</b>` : ''}
      ${c.evidence ? `<span>ראיה נדרשת</span><b>${esc(c.evidence)}</b>` : ''}
      ${i.status !== 'open' ? `<span>סטטוס</span><b>${i.status === 'done' ? 'בוצע ' + fmtDT(i.done_at) + ' · ' + esc(i.done_by || '') : i.status === 'waived' ? 'דחייה מוצדקת' : 'לא חל'}</b>
        <span>ראיה / נימוק</span><b>${esc([i.evidence_note, i.evidence_ref, i.na_reason].filter(Boolean).join(' · '))}${i.file_path ? ' · <button type="button" class="btn link" data-file>קובץ מצורף</button>' : ''}</b>` : ''}</div>
    ${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}
    ${isGate && i.status === 'open' ? `<div class="card gate"><h3>שער התחלת עבודה</h3>${gate.items.map(g => `<div class="gi ${g.status === 'open' ? 'no' : 'yes'}">${g.status === 'open' ? '✗' : '✓'} ${esc(g.title)}</div>`).join('')}</div>` : ''}
    ${nt ? noticeBlock(nt, act || canAct(i)) : ''}
    ${i.status === 'open' ? sendBlock(x) : ''}
    ${hist.length ? `<details><summary>היסטוריית שליחה (${hist.length})</summary>${hist.map(n => `<div class="small">${fmtDT(n.sent_at)} · ${CH[n.channel] || n.channel} · ${esc(n.recipient_name)} · ${esc(ST[n.status] || n.status)} · ${esc(LEVELS[n.level]?.label || '')}</div>`).join('')}</details>` : ''}
  </div>`;
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>${esc(i.title)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b">${body}</div>
    <div class="dlg-f">${i.kind === 'expiry' && i.status === 'open' ? `<a class="btn" href="${expiryLink(i)}" data-x2>${i.key.startsWith('exp_equip') ? 'לציוד ולתסקיר' : 'לכרטיס העובד'}</a>` : act ? `<button class="btn" data-done ${isGate && !gate.ready ? 'disabled title="יש תנאים פתוחים בשער ההתחלה"' : ''}>${isGate ? 'אישור בכתב להתחלת עבודה' : i.key === 'daily_checkin' ? 'צ\'ק-אין' : 'סימון כבוצע עם ראיה'}</button>` : ''}
      ${waive && i.kind !== 'expiry' ? '<button class="btn ghost" data-na>לא חל</button><button class="btn ghost" data-waive>דחייה מוצדקת</button>' : ''}
      <button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  const close = () => { el.remove(); const [, r, a, b, c2] = location.hash.split('/'); if (r === 'site' && c2) location.hash = `#/site/${a}/${b}`; };
  $$('[data-x]', el).forEach(b => b.onclick = close);
  $('[data-x2]', el)?.addEventListener('click', () => el.remove());
  wireSend(el, x);
  if (nt) wireNotice(el, nt, i, site, x, () => { el.remove(); openDuty(i.id); }, close);
  $('[data-file]', el)?.addEventListener('click', () => openFile(i.file_path));
  $('[data-done]', el)?.addEventListener('click', async () => { close(); if (i.key === 'daily_checkin') await checkinForm(i.site_id, i); else await completeDuty(i); });
  $('[data-na]', el)?.addEventListener('click', async () => { close(); await closeDuty(i, 'na'); });
  $('[data-waive]', el)?.addEventListener('click', async () => { close(); await closeDuty(i, 'waived'); });
}

// ===== הודעה רשמית: טיוטה, אישור, שליחה =====
function noticeBlock(n, can) {
  const g = n.channel === 'gov' ? GOV[NOTICES[n.key]?.gov] : null;
  const miss = '<span class="miss">חסר</span>';
  const fields = (n.fields || []).length ? `<div class="kv nf">${n.fields.map(([k, v], ix) => `<span>${esc(k)}</span><b>${String(v || '').trim() ? esc(v) : miss}${n.status === 'approved' && n.channel === 'gov' && v ? ` <button type="button" class="btn link" data-n-cp="${ix}">העתקה</button>` : ''}</b>`).join('')}</div>` : '';
  const to = n.channel === 'email' ? `<div class="small"><b>אל:</b> ${n.to_list?.length ? n.to_list.map(p => esc(p.name) + ' &lt;' + esc(p.email) + '&gt;').join(', ') : '<span class="miss">אין נמענים עם מייל. מוסיפים מייל בלשונית "בעלי תפקידים" או בעריכה.</span>'}</div>` : '';
  let actions = '';
  if (can && n.status === 'draft') actions = '<button type="button" class="btn small ghost" data-n-edit>עריכה</button><button type="button" class="btn small" data-n-approve>אישור ההודעה</button>';
  if (can && n.status === 'approved') {
    if (n.channel === 'gov') actions = `${g?.form ? `<a class="btn small" href="${esc(g.form)}" target="_blank" rel="noopener" data-n-open>פתיחת הטופס המקוון</a>` : ''}<a class="btn small ghost" href="${esc(g?.info || '')}" target="_blank" rel="noopener">דף השירות</a>
      ${g?.decl ? `<a class="btn small ghost" href="${esc(g.decl)}" target="_blank" rel="noopener">התצהיר להחתמה</a>` : ''}<button type="button" class="btn small ghost" data-n-copy>העתקת כל השדות</button><button type="button" class="btn small" data-n-sent>סימון כהוגש</button>`;
    if (n.channel === 'email') actions = `<button type="button" class="btn small" data-n-send>שליחה עכשיו</button><button type="button" class="btn small ghost" data-n-mailto>פתיחה בתוכנת המייל</button><button type="button" class="btn small ghost" data-n-sent>סימון כנשלח</button>`;
    if (n.channel === 'letter') actions = '<button type="button" class="btn small" data-n-letter>הפקת המכתב (PDF)</button><button type="button" class="btn small ghost" data-n-sent>סימון כנשלח</button>';
    actions += '<button type="button" class="btn small ghost" data-n-back>חזרה לעריכה</button>';
  }
  if (n.channel === 'letter' && n.status !== 'approved') actions += '<button type="button" class="btn small ghost" data-n-letter>תצוגת המכתב</button>';
  return `<div class="card notice"><div class="dh"><h3>ההודעה הרשמית</h3><span class="chip ${n.status === 'sent' ? 'green' : n.status === 'approved' ? 'blue' : 'amber'}">${NST[n.status]}</span><span class="chip">${CHANNEL[n.channel]}${g ? ': ' + esc(g.label) : ''}</span></div>
    <p class="small mut">${n.status === 'draft' ? 'המערכת הכינה טיוטה מנתוני האתר ומבעלי התפקידים. בודקים, משלימים מה שחסר ומאשרים. שום דבר לא נשלח לפני האישור.' : n.status === 'approved' ? `אושרה בידי ${esc(n.approved_by || '')} · ${fmtDT(n.approved_at)}.${n.channel === 'gov' ? ' למשרד העבודה אין ממשק שליחה אוטומטית: פותחים את הטופס, מעתיקים את השדות ומגישים. אחר כך מסמנים "הוגש" עם מספר האישור.' : ''}` : `נשלחה ${fmtDT(n.sent_at)} · ${esc(n.sent_by || '')}${n.sent_ref ? ' · אסמכתה: ' + esc(n.sent_ref) : ''}`}</p>
    ${g?.tip && n.status !== 'sent' ? `<p class="small">${esc(g.tip)}</p>` : ''}
    ${to}${n.channel !== 'gov' ? `<div class="small"><b>נושא:</b> ${esc(n.subject)}</div>` : ''}
    ${fields}${n.body ? `<div class="small pre nbody">${esc(n.body)}</div>` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function wireNotice(el, n, i, site, x, reopen, close) {
  const who = () => window.__actor || S.user?.email || '';
  const on = (sel, fn) => $(sel, el)?.addEventListener('click', async e => { try { await fn(e); } catch (er) { toast(er.message, 'bad'); } });
  const copy = async t => { try { await navigator.clipboard.writeText(t); toast('הועתק'); } catch { toast('ההעתקה נכשלה', 'bad'); } };
  $$('[data-n-cp]', el).forEach(b => b.onclick = () => copy(String(n.fields[+b.dataset.nCp][1] || '')));
  on('[data-n-copy]', () => copy(fieldsText(n)));
  on('[data-n-letter]', () => noticeLetter(site, n));
  on('[data-n-back]', async () => { await saveNotice(n, { status: 'draft', approved_by: null, approved_at: null }); reopen(); });
  on('[data-n-edit]', async () => {
    el.remove();
    const v = await modal({ title: 'עריכת ההודעה', ok: 'שמירת הטיוטה', wide: true,
      body: `${n.channel === 'email' ? field('נמענים (מיילים מופרדים בפסיק)', 'to', (n.to_list || []).map(p => p.email).join(', ')) : ''}
        ${n.channel !== 'gov' ? field('נושא', 'subject', n.subject || '') : ''}
        ${(n.fields || []).map(([k, val], ix) => area(k, 'f' + ix, val || '')).join('')}
        ${n.channel !== 'gov' ? area('נוסח ההודעה', 'body', n.body || '') : ''}`,
      validate: d => n.channel === 'email' && String(d.to || '').split(/[,;\s]+/).filter(Boolean).some(e => !isEmail(e)) ? 'יש כתובת מייל לא תקינה' : null });
    if (v) {
      const patch = { fields: (n.fields || []).map(([k], ix) => [k, String(v['f' + ix] ?? '').trim()]) };
      if (n.channel !== 'gov') { patch.subject = v.subject.trim(); patch.body = v.body; }
      if (n.channel === 'email') patch.to_list = String(v.to || '').split(/[,;\s]+/).filter(Boolean).map(e => { const p = S.data.site_people.find(q => q.site_id === site.id && (q.email || '').toLowerCase() === e.toLowerCase()); return { name: p?.name || e, email: e, role: p?.role || '' }; });
      await saveNotice(n, patch); toast('הטיוטה נשמרה');
    }
    openDuty(i.id);
  });
  on('[data-n-approve]', async () => {
    const miss = emptyFields(n);
    if (n.channel === 'email' && !n.to_list?.length) return toast('אין נמענים. מוסיפים בעריכה.', 'bad');
    if (miss.length) { el.remove(); const ok = await modal({ title: 'יש שדות ריקים', ok: 'לאשר בכל זאת', body: `<p>השדות האלה ריקים: <b>${esc(miss.join(', '))}</b>.</p><p class="small mut">אפשר לחזור לעריכה ולהשלים, או לאשר ולהשלים ישירות בטופס.</p>` }); if (!ok) return openDuty(i.id); }
    await saveNotice(n, { status: 'approved', approved_by: who(), approved_at: new Date().toISOString() });
    toast('ההודעה אושרה'); reopen();
  });
  on('[data-n-mailto]', () => { window.location.href = mailtoLink((n.to_list || []).map(p => p.email), n.subject, n.body); });
  on('[data-n-send]', async e => {
    if (!gReady()) return toast('כדי לשלוח מהמערכת צריך לחבר את Gmail במסך "הגדרות". אפשר גם "פתיחה בתוכנת המייל".', 'bad');
    e.target.disabled = true;
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-line">${esc(n.body)}</div><p style="color:#666;font-size:12px">נשלח ממערכת ניהול הבטיחות של צי הנדסה.</p>`;
    await gmailSend({ to: n.to_list.map(p => p.email), subject: n.subject, html });
    for (const p of n.to_list) await logNotification(i, x.level, p, 'email', 'sent');
    await markSent(n, i, 'נשלח במייל אל ' + n.to_list.map(p => p.name).join(', '), '');
  });
  on('[data-n-sent]', async () => {
    el.remove();
    const v = await modal({ title: n.channel === 'gov' ? 'סימון ההודעה כהוגשה' : 'סימון ההודעה כנשלחה', ok: 'שמירה',
      body: `${field(n.channel === 'gov' ? 'מספר אישור ההגשה' : 'אסמכתה (מספר מכתב, דואר רשום)', 'ref', '')}${area('הערה', 'note', '')}`,
      validate: d => n.channel === 'gov' && !d.ref?.trim() ? 'צריך את מספר אישור ההגשה שהטופס מחזיר' : null });
    if (!v) return openDuty(i.id);
    await markSent(n, i, (n.channel === 'gov' ? 'הוגש בטופס המקוון' : 'נשלח מכתב') + (v.note?.trim() ? '. ' + v.note.trim() : ''), v.ref.trim());
  });
  async function markSent(nn, duty, note, ref) {
    await saveNotice(nn, { status: 'sent', sent_at: new Date().toISOString(), sent_by: who(), sent_ref: ref || null });
    toast('ההודעה נרשמה כנשלחה'); close();
    if (duty.status === 'open' && canAct(duty)) await completeDuty(duty, { note: `${nn.title}: ${note}`, ref: ref || 'הודעה ' + fmtDT(new Date().toISOString()) });
    else render();
  }
}

// פתיחת קובץ: החלון נפתח מיד (בטלפון חלון שנפתח אחרי המתנה נחסם), ואז נטען הקובץ
export async function openFile(path) {
  const w = window.open('', '_blank');
  try { const b = await db.getFile(path); const u = URL.createObjectURL(b); if (w && w.location) w.location.href = u; else window.open(u, '_blank'); }
  catch (e) { w?.close?.(); toast(e.message, 'bad'); }
}

// ביצוע: חובה ראיה (קובץ או מספר אסמכתה) ותיאור
async function completeDuty(i, pre = {}) {
  const c = CAT[i.key] || {};
  const isVisit = i.key === 'bakar_visit' || i.key.startsWith('bakar_stage_');
  const now = new Date(); const local = new Date(now - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  let picked = null;
  const v = await modal({ title: i.key === 'dev_start_approval' ? 'אישור בכתב להתחלת עבודה' : 'סימון כבוצע', ok: 'שמירה',
    body: `<p class="small mut">${esc(i.title)}</p>
      ${field(isVisit ? 'מועד הביקור' : 'מועד הביצוע', 'at', local, { type: 'datetime-local', req: true })}
      ${area('תיאור הביצוע', 'note', pre.note || (i.key === 'dev_start_approval' ? 'אני מאשר/ת בכתב להתחיל בעבודות הבנייה. כל תנאי תקנה 1א(א) התקיימו.' : ''))}
      ${field('מספר אסמכתה (אישור הגשה, מספר מסמך)', 'ref', pre.ref || '')}
      <label class="fld"><span>קובץ ראיה (PDF, תמונה, מסמך)</span><input type="file" name="file" accept="image/*,application/pdf,.doc,.docx,.xlsx"></label>
      <small class="mut">${c.evidence ? 'ראיה נדרשת: ' + esc(c.evidence) + '. ' : ''}צריך לצרף קובץ או מספר אסמכתה.</small>`,
    validate: (d, form) => { picked = form.file.files[0] || null; if (!d.note?.trim()) return 'צריך לתאר מה בוצע'; if (!d.ref?.trim() && !form.file.files[0]) return 'צריך לצרף קובץ או מספר אסמכתה'; if (new Date(d.at) > new Date(Date.now() + 6e4)) return 'מועד הביצוע לא יכול להיות בעתיד'; return null; },
  });
  if (!v) return;
  let file_path = null;
  const f = picked;
  if (f) { file_path = `${i.site_id}/${i.id}/${Date.now()}-${f.name.replace(/[^\w.\-א-ת]+/g, '_')}`; try { await db.putFile(file_path, f); } catch (e) { toast('העלאת הקובץ נכשלה: ' + e.message, 'bad'); return; } }
  const at = new Date(v.at).toISOString();
  const asRep = !hasRole(i.site_id, 'con') && hasRole(i.site_id, 'rep') ? ' (נציג מבצע הבנייה, מטעם מבצע הבנייה)' : '';
  const patch = { status: 'done', done_at: at, closed_at: new Date().toISOString(), done_by: (window.__actor || S.user.email) + asRep, evidence_note: v.note.trim(), evidence_ref: v.ref.trim() || null, file_path };
  try {
    const r = await db.update('duties', i.id, patch); Object.assign(S.data.duties.find(d => d.id === i.id), r);
    const site = siteById(i.site_id);
    if (c.spawn || isVisit) await reportEvent(site, { type: 'bakar_visit', occurred_at: at, description: v.note.trim() }, true);
    if (i.key === 'dev_start_approval') { const s = await db.update('sites', site.id, { status: 'approved' }); Object.assign(site, s); }
    await syncSite(site, false);
    toast('נשמר'); render();
  } catch (e) { toast(e.message, 'bad'); }
}

async function closeDuty(i, status) {
  const v = await modal({ title: status === 'na' ? 'סימון "לא חל"' : 'דחייה מוצדקת', ok: 'שמירה',
    body: `<p class="small mut">${esc(i.title)}</p>${area('נימוק (חובה, נשמר ביומן הביקורת)', 'why')}
      <p class="small mut">${status === 'na' ? 'מתאים כשהחובה לא חלה על האתר הזה למרות הפרופיל.' : 'מתאים כשיש סיבה מוצדקת לסגור את החריגה בלי ביצוע. החריגה לא נמחקת ונשמרת בהיסטוריה.'}</p>`,
    validate: d => (d.why || '').trim().length < 5 ? 'צריך נימוק' : null });
  if (!v) return;
  try {
    const r = await db.update('duties', i.id, { status, na_reason: v.why.trim(), closed_at: new Date().toISOString(), done_by: window.__actor || S.user.email });
    Object.assign(S.data.duties.find(d => d.id === i.id), r);
    await syncSite(siteById(i.site_id), false);
    toast('נשמר'); render();
  } catch (e) { toast(e.message, 'bad'); }
}

// דיווח אירוע: שומר את האירוע ופותח את החובות שנגזרות ממנו
import { spawnForEvent } from '../duties.js';
export async function reportEvent(site, ev, silent = false) {
  const [row] = await db.insert('events', { site_id: site.id, reported_by: window.__actor || S.user.email, ...ev });
  S.data.events.push(row);
  const add = spawnForEvent(site, row);
  if (add.length) S.data.duties.push(...await db.insert('duties', add));
  if (!silent) toast(`האירוע נרשם${add.length ? ` ונפתחו ${add.length} חובות` : ''}`);
  return row;
}
export const canReport = siteId => hasRole(siteId, 'dev', 'bakar', 'con', 'so', 'sm', 'wm', 'rep');
