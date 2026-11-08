// רכיבים משותפים: תגית רמה, כרטיס חובה, כפתורי שליחה, חלון חובה (ביצוע / לא חל / דחייה)
import { db } from '../db.js';
import { S, canAct, canWaive, siteById, syncSite, render, hasRole } from '../app.js';
import { CAT, LEVELS, ROLES, level, leftText, recipients, gateStatus, EVENTS } from '../duties.js';
import { messageText, waLink, waShare, mailtoLink, logNotification, notifsFor } from '../alerts.js';
import { esc, h, $, $$, modal, toast, field, area, fmtDate } from '../util.js';
import { checkinForm } from './checkin.js';

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
    <div class="dh">${chip(lv)}${i.critical ? '<span class="chip red">חובה קריטית</span>' : ''}<span class="chip">${sideName(i.side)}</span>${showSite ? `<span class="chip violet">${esc(site?.name || '')}</span>` : ''}</div>
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
    ${i.status === 'open' ? sendBlock(x) : ''}
    ${hist.length ? `<details><summary>היסטוריית שליחה (${hist.length})</summary>${hist.map(n => `<div class="small">${fmtDT(n.sent_at)} · ${CH[n.channel] || n.channel} · ${esc(n.recipient_name)} · ${esc(ST[n.status] || n.status)} · ${esc(LEVELS[n.level]?.label || '')}</div>`).join('')}</details>` : ''}
  </div>`;
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>${esc(i.title)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b">${body}</div>
    <div class="dlg-f">${act ? `<button class="btn" data-done ${isGate && !gate.ready ? 'disabled title="יש תנאים פתוחים בשער ההתחלה"' : ''}>${isGate ? 'אישור בכתב להתחלת עבודה' : i.key === 'daily_checkin' ? 'צ\'ק-אין' : 'סימון כבוצע עם ראיה'}</button>` : ''}
      ${waive ? '<button class="btn ghost" data-na>לא חל</button><button class="btn ghost" data-waive>דחייה מוצדקת</button>' : ''}
      <button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  const close = () => { el.remove(); const [, r, a, b, c2] = location.hash.split('/'); if (r === 'site' && c2) location.hash = `#/site/${a}/${b}`; };
  $$('[data-x]', el).forEach(b => b.onclick = close);
  wireSend(el, x);
  $('[data-file]', el)?.addEventListener('click', () => openFile(i.file_path));
  $('[data-done]', el)?.addEventListener('click', async () => { close(); if (i.key === 'daily_checkin') await checkinForm(i.site_id, i); else await completeDuty(i); });
  $('[data-na]', el)?.addEventListener('click', async () => { close(); await closeDuty(i, 'na'); });
  $('[data-waive]', el)?.addEventListener('click', async () => { close(); await closeDuty(i, 'waived'); });
}

async function openFile(path) {
  try { const b = await db.getFile(path); window.open(URL.createObjectURL(b), '_blank'); } catch (e) { toast(e.message, 'bad'); }
}

// ביצוע: חובה ראיה (קובץ או מספר אסמכתה) ותיאור
async function completeDuty(i) {
  const c = CAT[i.key] || {};
  const isVisit = i.key === 'bakar_visit' || i.key.startsWith('bakar_stage_');
  const now = new Date(); const local = new Date(now - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  let picked = null;
  const v = await modal({ title: i.key === 'dev_start_approval' ? 'אישור בכתב להתחלת עבודה' : 'סימון כבוצע', ok: 'שמירה',
    body: `<p class="small mut">${esc(i.title)}</p>
      ${field(isVisit ? 'מועד הביקור' : 'מועד הביצוע', 'at', local, { type: 'datetime-local', req: true })}
      ${area('תיאור הביצוע', 'note', i.key === 'dev_start_approval' ? 'אני מאשר/ת בכתב להתחיל בעבודות הבנייה. כל תנאי תקנה 1א(א) התקיימו.' : '')}
      ${field('מספר אסמכתה (אישור הגשה, מספר מסמך)', 'ref', '')}
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
