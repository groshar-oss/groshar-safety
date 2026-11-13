// ביקורת באתר: מסך אחד שמרכז את כל מה שמבקר רוצה לראות, הודעה לבעלי התפקידים (WhatsApp / מייל) וייצוא PDF
import { defectsOf, SEV, isLate } from './defects.js';
import { db } from '../db.js';
import { S, hasRole, siteOrgs, render, conNames } from '../app.js';
import { derive, ROLES, WORK_TYPES, EVENTS, LEVELS, gateStatus } from '../duties.js';
import { exceptions, waLink, mailtoLink, appUrl } from '../alerts.js';
import { gReady, gmailSend } from '../google.js';
import { esc, h, $, $$, toast, modal, field, select, fmtDate } from '../util.js';
import { compliance, fmtDT, openFile } from './common.js';
import { checkinsFor } from './checkin.js';
import { statusName } from './home.js';
import { canSeeWorkers } from './workers.js';
import { TRAINING_KINDS, EQUIP_KINDS, workersOf, workerStatus, lastAnnual, trainingsOf, sigsOfTraining, equipmentOf, lastInspection, isPresent, israelDay,
  heightExemption, renderPdfPages, pagesToPdf } from '../workers.js';

const KINDS = { bakar: 'בקר בטיחות', labor: 'מפקח עבודה (משרד העבודה)', so: 'ממונה על הבטיחות', dev: 'נציג היזם', internal: 'ביקורת פנימית', other: 'אחר' };
export const canInspect = siteId => hasRole(siteId, 'dev', 'bakar', 'con', 'so', 'sm', 'wm', 'rep');
const inspectionsOf = siteId => (S.data.site_inspections || []).filter(x => x.site_id === siteId).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
const today = () => israelDay();
const ROLE_ORDER = ['dev', 'bakar', 'con', 'sm', 'wm', 'rep', 'so', 'fa'];

// כל הנתונים לביקורת, בפורמט אחד שמשמש גם את המסך וגם את ה-PDF
function sections(s) {
  const out = [];
  const dv = derive(s.profile || {});
  const duties = S.data.duties.filter(d => d.site_id === s.id);
  const g = gateStatus(duties), c = compliance(s.id);
  out.push({ title: 'פרטי האתר', type: 'kv', rows: [
    ['האתר', s.name + (s.address ? ', ' + s.address : '')],
    ['מהות העבודה', WORK_TYPES[s.profile?.work_type] || '—'],
    ['יזם (המזמין)', siteOrgs(s.id, 'developer').map(o => o.name).join(', ') || '—'],
    ['מבצע הבנייה (קבלן ראשי)', conNames(s.id).join(', ') || '—'],
    ['סטטוס', statusName(s.status)],
    ['היתר', s.profile?.permit_no || '—'],
    ['שטח לפי ההיתר', (+s.profile?.area || 0).toLocaleString('he-IL') + ' מ"ר'],
    ['עמידה בחובות', `${c.pct}% (${c.total - c.bad} מתוך ${c.total} בלי חריגה)`],
    ['שער התחלת עבודה', g.items.length ? `${g.items.length - g.missing.length} מתוך ${g.items.length} תנאים התקיימו` : '—'],
    ...(dv.exempt27 ? [['סיווג', 'פטור ממינוי מנהל עבודה לפי תקנה 2(ז). חובותיו על מבצע הבנייה ונציגו באתר']] : [])
  ] });
  const ppl = S.data.site_people.filter(p => p.site_id === s.id && p.active !== false);
  out.push({ title: 'בעלי תפקידים', type: 'table', cols: [['תפקיד', 0.3], ['שם', 0.26], ['טלפון', 0.18], ['רישום / כשירות', 0.26]],
    rows: ROLE_ORDER.flatMap(r => { const list = ppl.filter(p => p.role === r); return list.length ? list.map(p => [ROLES[r] + (p.backup ? ' (ממלא מקום)' : ''), p.name, p.phone || '', p.license || '']) : r === 'rep' && !dv.exempt27 ? [] : [[ROLES[r], 'לא מונה', '', '']]; }) });
  const ex = exceptions(S.data, [s]);
  out.push({ title: `חריגות פתוחות (${ex.length})`, type: 'table', cols: [['רמה', 0.12], ['חובה', 0.5], ['מועד', 0.18], ['אחראי', 0.2]],
    rows: ex.map(x => [LEVELS[x.level].label, x.duty.title, x.duty.due_at ? fmtDT(x.duty.due_at) : '—', x.roles.map(r => ROLES[r]).join(', ')]), empty: 'אין חריגות פתוחות' });
  if (canSeeWorkers(s.id)) {
    const ws = workersOf(s.id).filter(w => w.active !== false);
    const present = ws.filter(w => isPresent(w.id));
    out.push({ title: `עובדים (${ws.length}) · באתר היום: ${present.length}`, type: 'table', workers: true,
      cols: [['שם', 0.16], ['תעודה', 0.13], ['חברה · מקצוע', 0.16], ['סטטוס', 0.15], ['הדרכה אחרונה', 0.11], ['עבודה בגובה', 0.11], ['היתר עובד זר', 0.1], ['היום', 0.08]],
      rows: ws.map(w => { const st = workerStatus(w), la = lastAnnual(w), hx = heightExemption(w);
        return [w.name, (w.id_type === 'passport' ? 'דרכון ' : 'ת"ז ') + w.id_number, [w.company, w.trade].filter(Boolean).join(' · '),
          st.lv === 'bad' ? 'אסור להעסיק: ' + st.issues.join(', ') : st.lv === 'warn' ? 'פג בקרוב: ' + st.issues.join(', ') : 'מותר לעבוד',
          la ? fmtDate(la) : 'לא הודרך', hx ? 'הוחרג באישור' : w.height ? 'עד ' + fmtDate(w.height_until) : 'אין', w.foreign_worker ? 'עד ' + fmtDate(w.permit_until) : '—', isPresent(w.id) ? 'באתר' : '']; }), empty: 'לא נרשמו עובדים' });
    const trs = trainingsOf(s.id).slice(0, 12);
    out.push({ title: 'הדרכות אחרונות', type: 'table', workers: true, cols: [['מועד', 0.16], ['סוג', 0.24], ['מדריך', 0.18], ['חתמו', 0.08], ['נושא', 0.34]],
      rows: trs.map(t => [fmtDT(t.held_at), TRAINING_KINDS[t.kind] + (t.closed_at ? '' : ' (פתוחה)'), t.trainer_name, String(sigsOfTraining(t.id).length), t.topic]), files: trs.map(t => t.pdf_path), empty: 'לא נרשמו הדרכות' });
  }
  const dfs = defectsOf(s.id).filter(d => !d.closed_at || Date.now() - new Date(d.closed_at) < 30 * 864e5);
  out.push({ title: `ליקויי בטיחות (${dfs.filter(d => !d.closed_at).length} פתוחים)`, type: 'table', cols: [['ליקוי', 0.3], ['איפה', 0.16], ['חומרה', 0.11], ['אחראי', 0.17], ['מועד', 0.12], ['מצב', 0.14]],
    rows: dfs.map(d => [d.title, d.location || '', SEV[d.severity]?.[1] || '', d.responsible || '', fmtDate(d.due_date), d.closed_at ? 'תוקן ' + fmtDate(d.closed_at) : isLate(d) ? 'באיחור' : 'פתוח']),
    files: dfs.map(d => d.after_path || d.before_path), empty: 'אין ליקויים פתוחים' });
  const eq = equipmentOf(s.id).filter(e => e.active !== false);
  out.push({ title: 'ציוד ותסקירים', type: 'table', cols: [['ציוד', 0.26], ['סוג', 0.22], ['תסקיר אחרון', 0.13], ['בודק', 0.16], ['בתוקף עד', 0.12], ['מצב', 0.11]],
    rows: eq.map(e => { const li = lastInspection(e.id); const bad = !li || li.next_due < today();
      return [e.name + (e.ident ? ' ' + e.ident : ''), EQUIP_KINDS[e.kind]?.label || e.kind, li ? fmtDate(li.inspected_at) : '—', li?.inspector || '', li ? fmtDate(li.next_due) : '—', bad ? (li ? 'פג' : 'אין תסקיר') : 'בתוקף']; }),
    files: eq.map(e => lastInspection(e.id)?.cert_path), empty: 'לא נרשם ציוד' });
  const pre = duties.filter(d => ['pre', 'ongoing'].includes(d.kind) && d.status !== 'na').sort((a, b) => (a.status === 'open') - (b.status === 'open'));
  out.push({ title: 'מסמכים, מינויים ואישורים', type: 'table', cols: [['דרישה', 0.5], ['מצב', 0.2], ['אסמכתה', 0.3]],
    rows: pre.map(d => [d.title, d.status === 'done' ? 'בוצע ' + fmtDate(d.done_at) : d.status === 'waived' ? 'נסגר בנימוק' : 'פתוח', [d.evidence_ref, d.evidence_note].filter(Boolean).join(' · ')]), files: pre.map(d => d.file_path) });
  const from = Date.now() - 14 * 864e5;
  const log = [
    ...checkinsFor(s.id).filter(c => new Date(c.at) > from).map(c => [c.at, "צ'ק-אין: " + c.person_name, [c.note, ...Object.values(c.checks || {}).filter(k => !k.ok).map(k => `${k.title}: ליקויים. ${k.note}`)].filter(Boolean).join(' · ')]),
    ...S.data.events.filter(e => e.site_id === s.id && new Date(e.occurred_at) > from).map(e => [e.occurred_at, 'אירוע: ' + (EVENTS[e.type]?.label || e.type), e.description || '']),
    ...duties.filter(d => d.status === 'done' && d.key !== 'daily_checkin' && d.kind !== 'expiry' && new Date(d.done_at) > from).map(d => [d.done_at, d.title, d.evidence_note || ''])
  ].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  out.push({ title: 'פנקס כללי: 14 הימים האחרונים', type: 'table', cols: [['מועד', 0.16], ['רישום', 0.4], ['פרטים', 0.44]], rows: log.map(([at, k, t]) => [fmtDT(at), k, t]), empty: 'אין רישומים ב-14 הימים האחרונים' });
  const past = inspectionsOf(s.id);
  if (past.length) out.push({ title: 'ביקורות קודמות במערכת', type: 'table', cols: [['מועד', 0.2], ['המבקר', 0.3], ['מטרה', 0.5]], rows: past.slice(0, 10).map(x => [fmtDT(x.started_at), x.inspector_name + (x.inspector_role ? ' · ' + (KINDS[x.inspector_role] || x.inspector_role) : ''), x.purpose || '']) });
  return out;
}

export function tabInspect(s) {
  const can = canInspect(s.id);
  const cur = inspectionsOf(s.id).find(x => israelDay(new Date(x.started_at)) === today());
  const secs = sections(s);
  const el = h(`<div>
    <div class="card insp-head"><h2>ביקורת באתר</h2>
      <p class="small mut">כל מה שמבקר רוצה לראות, במקום אחד: בעלי תפקידים, חריגות, עובדים ותוקפים, הדרכות, ציוד ותסקירים, מסמכים ופנקס כללי. אפשר לייצא הכול ל-PDF.</p>
      ${cur ? `<div class="banner">ביקורת פתוחה היום: <b>${esc(cur.inspector_name)}</b>${cur.inspector_role ? ' · ' + esc(KINDS[cur.inspector_role] || cur.inspector_role) : ''} · נפתחה ${fmtDT(cur.started_at)}${cur.purpose ? '<br>' + esc(cur.purpose) : ''}
        <div class="small">${(cur.notified || []).length ? 'נשלחה הודעה אל: ' + esc([...new Set(cur.notified.map(n => n.name))].join(', ')) : 'עוד לא נשלחה הודעה לבעלי התפקידים'}</div></div>` : ''}
      <div class="actions">${can ? (cur ? '<button class="btn" data-notify>הודעה לבעלי התפקידים</button>' : '<button class="btn big" data-open>פתיחת ביקורת והודעה לבעלי התפקידים</button>') : ''}
        <button class="btn ghost" data-pdf>ייצוא PDF</button></div></div>
    ${secs.map((x, i) => `<div class="card"><h3>${esc(x.title)}</h3>${x.type === 'kv' ? `<div class="kv">${x.rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div>`
      : x.rows.length ? `<div class="tbl-wrap"><table class="tbl itbl"><thead><tr>${x.cols.map(([c]) => `<th>${esc(c)}</th>`).join('')}${x.files ? '<th></th>' : ''}</tr></thead><tbody>${x.rows.map((r, j) => `<tr>${r.map((v, k) => `<td data-l="${esc(x.cols[k][0])}">${esc(v)}</td>`).join('')}${x.files ? `<td>${x.files[j] ? `<button type="button" class="btn link" data-f="${i}:${j}">קובץ</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : `<div class="empty small">${esc(x.empty || 'אין')}</div>`}</div>`).join('')}
  </div>`);
  $$('[data-f]', el).forEach(b => b.onclick = () => { const [i, j] = b.dataset.f.split(':').map(Number); openFile(secs[i].files[j]); });
  $('[data-open]', el)?.addEventListener('click', () => openInspection(s));
  $('[data-notify]', el)?.addEventListener('click', () => notifyPeople(s, cur));
  $('[data-pdf]', el).addEventListener('click', e => exportPdf(s, cur, e.target));
  return el;
}

async function openInspection(s) {
  const v = await modal({ title: 'פתיחת ביקורת באתר', ok: 'פתיחה והמשך להודעה',
    body: `${field('שם המבקר', 'inspector_name', '', { req: true })}
      ${select('מי מבקר', 'inspector_role', KINDS, 'bakar')}
      ${field('מטרת הביקורת', 'purpose', '', { attrs: 'placeholder="למשל: ביקור תקופתי, בדיקת פיגומים, אחרי תאונה"' })}
      <p class="small mut">אחרי הפתיחה בוחרים למי לשלוח הודעה. ב-WhatsApp נפתחת הודעה מוכנה ושולחים בלחיצה.</p>`,
    validate: d => !d.inspector_name?.trim() ? 'צריך את שם המבקר' : null });
  if (!v) return;
  try {
    const [r] = await db.insert('site_inspections', { site_id: s.id, inspector_name: v.inspector_name.trim(), inspector_role: v.inspector_role, purpose: v.purpose.trim(),
      started_at: new Date().toISOString(), started_by_email: S.user?.email || '', notified: [] });
    (S.data.site_inspections ||= []).push(r);
    render();
    notifyPeople(s, r);
  } catch (e) { toast(e.message, 'bad'); }
}

const msgText = (s, x) => [`ביקורת בטיחות באתר ${s.name}`, `המבקר: ${x.inspector_name}${x.inspector_role ? ' (' + (KINDS[x.inspector_role] || x.inspector_role) + ')' : ''}`,
  x.purpose ? `מטרה: ${x.purpose}` : '', `התחילה: ${fmtDT(x.started_at)}`, `כל מה שהמבקר צריך לראות מרוכז במערכת: ${appUrl()}#/site/${s.id}/inspect`].filter(Boolean).join('\n');

// הודעה לבעלי התפקידים: WhatsApp לכל אחד (הודעה מוכנה), ומייל לכולם (Gmail אם מחובר, אחרת תוכנת המייל)
function notifyPeople(s, x) {
  const ppl = S.data.site_people.filter(p => p.site_id === s.id && p.active !== false && (p.phone || p.email));
  ppl.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const text = msgText(s, x), subject = `ביקורת בטיחות באתר ${s.name} · ${fmtDate(x.started_at)}`;
  const done = n => (x.notified || []).some(q => q.person_id === n.id);
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>הודעה לבעלי התפקידים</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><div class="small pre nbody">${esc(text)}</div>
      ${ppl.map(p => `<div class="wrow"><div><b>${esc(p.name)}</b><div class="small mut">${esc(ROLES[p.role] || p.role)}${p.backup ? ' · ממלא מקום' : ''}</div></div>
        <div class="actions">${p.phone ? `<button type="button" class="btn small wa ${done(p) ? 'done' : ''}" data-wa="${p.id}">WhatsApp${done(p) ? ' ✓' : ''}</button>` : ''}${p.email ? `<a class="btn small ghost" data-m1="${p.id}" href="${esc(mailtoLink(p.email, subject, text))}">מייל</a>` : ''}</div></div>`).join('') || '<div class="empty">אין בעלי תפקידים עם טלפון או מייל. מוסיפים בלשונית "בעלי תפקידים".</div>'}
      ${ppl.some(p => p.email) ? `<div class="actions"><button type="button" class="btn" data-mall>מייל לכל בעלי התפקידים</button></div>` : ''}</div>
    <div class="dlg-f"><button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  const close = () => { el.remove(); render(); };
  $$('[data-x]', el).forEach(b => b.onclick = close);
  const log = async (p, channel) => {
    x.notified = [...(x.notified || []), { person_id: p.id, name: p.name, role: p.role, channel, at: new Date().toISOString() }];
    try { const r = await db.update('site_inspections', x.id, { notified: x.notified }); Object.assign(x, r); } catch (e) { toast(e.message, 'bad'); }
  };
  $$('[data-wa]', el).forEach(b => b.onclick = async () => { const p = ppl.find(q => q.id === b.dataset.wa); window.open(waLink(p.phone, text), '_blank', 'noopener'); b.classList.add('done'); if (!b.textContent.includes('✓')) b.textContent += ' ✓'; await log(p, 'whatsapp'); });
  $$('[data-m1]', el).forEach(a => a.addEventListener('click', () => log(ppl.find(q => q.id === a.dataset.m1), 'email')));
  $('[data-mall]', el)?.addEventListener('click', async e => {
    const to = ppl.filter(p => p.email);
    if (gReady()) {
      e.target.disabled = true;
      try { await gmailSend({ to: to.map(p => p.email), subject, html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-line">${esc(text)}</div>` }); for (const p of to) await log(p, 'email'); toast('המייל נשלח'); }
      catch (er) { e.target.disabled = false; toast(er.message, 'bad'); }
    } else { window.location.href = mailtoLink(to.map(p => p.email), subject, text); for (const p of to) await log(p, 'email'); }
  });
}

// ייצוא PDF: החלון נפתח מיד (בטלפון חלון שנפתח אחרי המתנה נחסם), ואז נבנה הקובץ
async function exportPdf(s, cur, btn) {
  const win = window.open('', '_blank');
  btn.disabled = true; toast('מכין PDF…');
  try {
    const secs = sections(s), at = new Date().toISOString();
    const blocks = [{ type: 'title', text: 'ביקורת בטיחות באתר', brand: 'צי הנדסה', sub: `${s.name}${s.address ? ', ' + s.address : ''} · הופק ${fmtDT(at)}${cur ? ` · המבקר: ${cur.inspector_name}${cur.inspector_role ? ' (' + (KINDS[cur.inspector_role] || '') + ')' : ''}` : ''}` }];
    for (const x of secs) {
      blocks.push({ type: 'p', text: x.title, bold: true, size: 26, color: '#1C3A5E' });
      if (x.type === 'kv') blocks.push({ type: 'kv', rows: x.rows });
      else if (x.rows.length) blocks.push({ type: 'table', cols: x.cols.map(([hh, w]) => ({ h: hh, w })), rows: x.rows });
      else blocks.push({ type: 'p', text: x.empty || 'אין', color: '#666' });
    }
    blocks.push({ type: 'p', size: 16, color: '#666', text: `הופק אוטומטית ממערכת ניהול הבטיחות של צי הנדסה, ${fmtDT(at)}. הנתונים נכונים לרגע ההפקה. קבצים (תסקירים, אישורים, PDF הדרכות) שמורים במערכת.` });
    const blob = await pagesToPdf(await renderPdfPages(blocks, `${s.name} · ביקורת בטיחות · ${fmtDate(at)}`));
    const url = URL.createObjectURL(blob);
    if (win && win.location) win.location.href = url; else window.open(url, '_blank');
    // שמירה עם הביקורת הפתוחה. דוח עם פרטי עובדים נשמר בתיקייה שרק מי שרואה את פנקס העובדים פותח
    if (cur && canInspect(s.id)) {
      const path = `${s.id}/${secs.some(x => x.workers) ? 'workers/' : ''}inspections/${cur.id}/${at.replace(/[:.]/g, '-')}.pdf`;
      try { await db.putFile(path, new File([blob], 'inspection.pdf', { type: 'application/pdf' })); const r = await db.update('site_inspections', cur.id, { pdf_path: path }); Object.assign(cur, r); } catch (e) { console.warn('inspection pdf', e); }
    }
  } catch (e) { win?.close?.(); toast(e.message, 'bad'); }
  btn.disabled = false;
}
