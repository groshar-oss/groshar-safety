// דוחות בטלפון: דוח ביקור בקר בטיחות, ותיעוד תאונה עם הצהרות עדים חתומות
import { db, uuid } from '../db.js';
import { S, hasRole, siteById, siteOrgs, syncSite, render, conNames } from '../app.js';
import { esc, h, $, $$, toast, modal, field, select, area, fmtDate, fileField } from '../util.js';
import { shrinkImage, renderPdfPages, pagesToPdf, loadImg, workersOf } from '../workers.js';
import { reportEvent, fmtDT, openFile } from './common.js';
import { pad } from './sign.js';
import { NOTICES, noticeFor, draftFor, saveNotice } from '../notices.js';
import { SEV } from './defects.js';

const isoLocal = d => { const x = new Date(d || Date.now()); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const person = (s, role) => S.data.site_people.find(p => p.site_id === s.id && p.role === role && p.active !== false && !p.backup);
async function putImg(path, file) { const f = await shrinkImage(file); await db.putFile(path, f); return path; }
async function imgFromPath(path) { try { const b = await db.getFile(path); return await loadImg(URL.createObjectURL(b)); } catch { return null; } }
function openBlob(blob) { const u = URL.createObjectURL(blob); const w = window.open(u, '_blank'); if (!w) location.href = u; }

// שיתוף PDF: שיתוף מהטלפון (וואטסאפ, מייל) אם אפשר, אחרת פתיחה
async function sharePdf(blob, name, text) {
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name, text }); return; } catch { /* בוטל */ } }
  openBlob(blob);
}

// ===================== דוח ביקור בקר =====================
export const STAGES = { excavation: 'חפירה', foundation: 'יסודות', skeleton: 'שלד', finishes: 'גמר', periodic: 'ביקור תקופתי', other: 'אחר' };
export const canBakarReport = siteId => hasRole(siteId, 'bakar') || (hasRole(siteId, 'dev') && !S.data.site_people.some(p => p.site_id === siteId && p.role === 'bakar' && p.active !== false));
export const bakarReportOf = dutyId => (S.data.bakar_reports || []).find(r => r.duty_id === dutyId);

const findingRow = n => `<div class="card finding" data-fi="${n}"><div class="dh"><b>ממצא ${n + 1}</b>${n ? '<button type="button" class="btn link" data-fdel>הסרה</button>' : ''}</div>
  ${area('מה נמצא', 'f_text_' + n)}
  <div class="grid g2">${field('איפה', 'f_loc_' + n)}${field('אחראי לתיקון', 'f_resp_' + n, '', { attrs: 'list="bkCmp"' })}</div>
  ${fileField('צילום', 'f_photo_' + n, { accept: 'image/*' })}
  <label class="chk"><input type="checkbox" name="f_unacc_${n}"> סיכון שאינו קביל (נפתחות חובת מענה לקבלן ואישור היזם תוך 48 שעות)</label></div>`;

export async function bakarReportForm(duty) {
  const s = siteById(duty.site_id);
  const ev = S.data.events.find(e => e.id === duty.event_id);
  const me = person(s, 'bakar');
  const cons = conNames(s.id);
  let form = null, n = 1;
  const v = await modal({ title: 'דוח ביקור בקר בטיחות', ok: 'שמירה והפקת הדוח', wide: true,
    body: `<div class="grid g2">${field('מועד הביקור', 'visit_at', isoLocal(ev?.occurred_at), { type: 'datetime-local', req: true })}${select('שלב', 'stage', STAGES, 'periodic')}</div>
      ${field('שם הבקר', 'bakar_name', (me?.name || '').replace(/ \(.*\)$/, ''), { req: true })}
      ${area('מה נבדק (תוכנית הבטיחות, מענים לסיכונים, מיגון, הדרכות)', 'summary', ev?.description || '')}
      <div id="fins">${findingRow(0)}</div>
      <button type="button" class="btn ghost" data-fadd>＋ ממצא נוסף</button>
      ${area('המלצות', 'recs')}
      <datalist id="bkCmp">${cons.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <p class="small mut">ממצא עם צילום נכנס גם לרשימת הליקויים של האתר. הדוח נמסר ליזם ולמבצע הבנייה (תקנה 2א(ב)(3)), ומבצע הבנייה מצרף אותו לפנקס הכללי.</p>`,
    onMount: el => {
      form = $('form', el);
      $('[data-fadd]', el).onclick = () => { $('#fins', el).appendChild(h(findingRow(n++))); };
      $('#fins', el).addEventListener('click', e => { if (e.target.matches('[data-fdel]')) e.target.closest('[data-fi]').remove(); });
    },
    validate: d => {
      if (!d.visit_at) return 'צריך מועד ביקור';
      if (new Date(d.visit_at) > new Date(Date.now() + 6e4)) return 'מועד הביקור לא יכול להיות בעתיד';
      if (!(d.bakar_name || '').trim()) return 'צריך שם בקר';
      const any = $$('[data-fi]', form).some(r => (d['f_text_' + r.dataset.fi] || '').trim());
      if (!any && !(d.summary || '').trim()) return 'צריך לפחות ממצא אחד או תיאור של מה שנבדק';
      for (const r of $$('[data-fi]', form)) { const i = r.dataset.fi; if (d['f_unacc_' + i] && !(d['f_text_' + i] || '').trim()) return 'סיכון שאינו קביל צריך תיאור'; }
      return null;
    } });
  if (!v) return;
  try {
    toast('שומר את הדוח…');
    const id = uuid();
    const findings = [];
    for (const r of $$('[data-fi]', form)) {
      const i = r.dataset.fi, text = (v['f_text_' + i] || '').trim(); if (!text) continue;
      const f = form.elements['f_photo_' + i]?.files?.[0];
      const photo = f ? await putImg(`${s.id}/reports/bakar/${id}/f${i}-${Date.now()}.jpg`, f) : null;
      findings.push({ text, location: (v['f_loc_' + i] || '').trim(), responsible: (v['f_resp_' + i] || '').trim() || cons[0] || '', photo_path: photo, unacceptable: !!v['f_unacc_' + i] });
    }
    const [rep] = await db.insert('bakar_reports', { id, site_id: s.id, duty_id: duty.id, event_id: duty.event_id || null, visit_at: new Date(v.visit_at).toISOString(), stage: v.stage,
      bakar_name: v.bakar_name.trim(), summary: (v.summary || '').trim(), findings, recommendations: (v.recs || '').trim() });
    (S.data.bakar_reports ||= []).push(rep);
    // ממצא עם צילום: ליקוי באתר
    const due = n2 => new Date(Date.now() + n2 * 864e5).toISOString().slice(0, 10);
    for (const f of findings.filter(x => x.photo_path)) {
      const [d] = await db.insert('defects', { site_id: s.id, title: f.text.slice(0, 140), location: f.location, severity: f.unacceptable ? 'crit' : 'high', source: 'bakar',
        responsible: f.responsible || 'מבצע הבנייה', due_date: due(f.unacceptable ? 0 : SEV.high[2]), before_path: f.photo_path });
      (S.data.defects ||= []).push(d);
    }
    // סיכון שאינו קביל: אירוע שפותח מענה מיידי לקבלן ואישור היזם תוך 48 שעות
    const un = findings.filter(f => f.unacceptable);
    if (un.length) await reportEvent(s, { type: 'unacceptable', occurred_at: new Date(v.visit_at).toISOString(), description: 'מדוח ביקור הבקר: ' + un.map(f => f.text + (f.location ? ` (${f.location})` : '')).join(' · ') }, true);
    const blob = await bakarPdf(s, rep);
    const path = `${s.id}/reports/bakar/${id}/report-${Date.now()}.pdf`;
    await db.putFile(path, new File([blob], 'bakar.pdf', { type: 'application/pdf' }));
    Object.assign(rep, await db.update('bakar_reports', id, { pdf_path: path }));
    const r2 = await db.update('duties', duty.id, { status: 'done', done_at: new Date().toISOString(), closed_at: new Date().toISOString(), done_by: v.bakar_name.trim() + ' (בקר בטיחות)',
      evidence_note: `דוח ביקור במערכת: ${findings.length} ממצאים${un.length ? `, ${un.length} סיכונים שאינם קבילים` : ''}`, evidence_ref: 'דוח ' + fmtDate(v.visit_at), file_path: path });
    Object.assign(S.data.duties.find(x => x.id === duty.id), r2);
    await syncSite(s, false);
    render();
    const go = await modal({ title: 'הדוח נשמר', ok: 'שליחה ליזם ולקבלן', cancel: 'סגירה',
      body: `<p>הדוח נשמר במערכת ונסגרה חובת הדוח.${un.length ? ` נפתחו חובות על ${un.length} סיכונים שאינם קבילים: מענה מיידי לקבלן ואישור היזם תוך 48 שעות.` : ''}</p><p class="small mut">היזם והקבלן רואים את הדוח במערכת. אפשר גם לשלוח להם את ה-PDF מהטלפון.</p>` });
    if (go !== null) await sharePdf(blob, `דוח ביקור בקר ${s.name}.pdf`, `דוח ביקור בקר הבטיחות באתר ${s.name}`);
  } catch (e) { toast(e.message, 'bad'); }
}

export async function bakarPdf(s, r) {
  const imgs = await Promise.all((r.findings || []).map(f => f.photo_path ? imgFromPath(f.photo_path) : null));
  const blocks = [
    { type: 'title', text: 'דוח ביקור בקר בטיחות', brand: 'צי הנדסה', sub: 'לפי תקנה 2א(ב)(3) לתקנות הבטיחות בעבודה (עבודות בנייה), התשמ"ח-1988' },
    { type: 'kv', rows: [['האתר', s.name + (s.address ? ', ' + s.address : '')], ['היזם', siteOrgs(s.id, 'developer').map(o => o.name).join(', ') || '—'],
      ['מבצע הבנייה', conNames(s.id).join(', ') || '—'], ['מועד הביקור', fmtDT(r.visit_at)], ['שלב', STAGES[r.stage] || r.stage], ['בקר הבטיחות', r.bakar_name]] },
    ...(r.summary ? [{ type: 'p', text: 'מה נבדק: ' + r.summary }] : []),
    { type: 'table', cols: [{ h: '#', w: 0.05 }, { h: 'ממצא', w: 0.37 }, { h: 'איפה', w: 0.14 }, { h: 'אחראי', w: 0.14 }, { h: 'סיכון לא קביל', w: 0.1 }, { h: 'צילום', w: 0.2 }],
      rows: (r.findings || []).map((f, i) => [String(i + 1), f.text, f.location || '', f.responsible || '', f.unacceptable ? 'כן' : '', imgs[i] ? { img: imgs[i] } : '']) },
    ...(r.recommendations ? [{ type: 'p', text: 'המלצות: ' + r.recommendations }] : []),
    ...((r.findings || []).some(f => f.unacceptable) ? [{ type: 'p', bold: true, color: '#b00020', text: 'יש סיכון שאינו קביל: מבצע הבנייה נותן מענה מיד, והמזמין מאשר בכתב תוך 48 שעות שניתן מענה (תקנות 2(ו), 1א(ג)).' }] : []),
    { type: 'p', size: 16, color: '#666', text: `הופק ${fmtDT(new Date().toISOString())} ממערכת ניהול הבטיחות של צי הנדסה. מבצע הבנייה מצרף עותק לפנקס הכללי.` }];
  return pagesToPdf(await renderPdfPages(blocks, `${s.name} · דוח ביקור בקר · ${fmtDate(r.visit_at)}`));
}

// ===================== תיעוד תאונה =====================
export const canAccident = siteId => hasRole(siteId, 'con', 'so', 'sm', 'wm', 'rep');
export const accidentOf = eventId => (S.data.accident_reports || []).find(r => r.event_id === eventId);

export async function accidentForm(s, ev) {
  let cur = accidentOf(ev.id);
  if (cur) return accidentScreen(s, cur);
  let form = null;
  const ws = workersOf(s.id).filter(w => w.active !== false);
  const v = await modal({ title: 'תיעוד תאונה', ok: 'שמירה', wide: true,
    body: `<div class="banner crit">קודם מטפלים בנפגע ומזעיקים עזרה. התיעוד אחר כך.</div>
      ${select('הנפגע', 'worker_id', { '': 'לא ברשימה (כותבים שם)', ...Object.fromEntries(ws.map(w => [w.id, w.name])) }, '')}
      <div class="grid g2">${field('שם הנפגע (אם לא ברשימה)', 'injured_name')}${field('תעודה', 'injured_id', '', { attrs: 'dir="ltr"' })}</div>
      <div class="grid g2">${field('מועד התאונה', 'occurred_at', isoLocal(ev.occurred_at), { type: 'datetime-local', req: true })}${field('מקום מדויק באתר', 'place', '', { req: true })}</div>
      ${area('איך קרתה התאונה', 'how', ev.description || '')}
      <div class="grid g2">${field('הפגיעה (סוג ואיבר)', 'injury')}${field('פונה אל (בית חולים, מוקד)', 'evac')}</div>
      ${area('עזרה ראשונה שניתנה ומי נתן', 'first_aid')}
      ${fileField('צילום מקום התאונה', 'p0', { accept: 'image/*' })}${fileField('צילום נוסף', 'p1', { accept: 'image/*' })}${fileField('צילום נוסף', 'p2', { accept: 'image/*' })}
      <p class="small mut">לא מזיזים ציוד ולא משנים את המקום לפני שמצלמים, אלא אם צריך בשביל הטיפול בנפגע או כדי למנוע סכנה. אחרי השמירה מוסיפים הצהרות עדים חתומות.</p>`,
    onMount: el => { form = $('form', el); },
    validate: d => !d.worker_id && !(d.injured_name || '').trim() ? 'צריך את שם הנפגע' : !(d.place || '').trim() ? 'צריך את מקום התאונה' : (d.how || '').trim().length < 5 ? 'צריך לתאר איך קרתה התאונה' : null });
  if (!v) return;
  try {
    toast('שומר…');
    const id = uuid(), w = ws.find(x => x.id === v.worker_id);
    const photos = [];
    for (const k of ['p0', 'p1', 'p2']) { const f = form.elements[k]?.files?.[0]; if (f) photos.push(await putImg(`${s.id}/reports/accident/${id}/${k}-${Date.now()}.jpg`, f)); }
    const [r] = await db.insert('accident_reports', { id, site_id: s.id, event_id: ev.id, worker_id: w?.id || null, injured_name: w?.name || v.injured_name.trim(),
      injured_id: w ? (w.id_type === 'passport' ? 'דרכון ' : 'ת"ז ') + w.id_number : (v.injured_id || '').trim(), occurred_at: new Date(v.occurred_at).toISOString(),
      place: v.place.trim(), how: v.how.trim(), injury: (v.injury || '').trim(), evac: (v.evac || '').trim(), first_aid: (v.first_aid || '').trim(), photos, witnesses: [] });
    (S.data.accident_reports ||= []).push(r);
    await fillAccidentNotice(s, ev).catch(x => console.warn('notice', x));
    accidentScreen(s, r);
  } catch (e) { toast(e.message, 'bad'); }
}

function accidentScreen(s, r) {
  const closed = !!r.closed_at, can = canAccident(s.id) && !closed;
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>תיעוד תאונה</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b">
      <div class="kv"><span>הנפגע</span><b>${esc(r.injured_name)}${r.injured_id ? ' · ' + esc(r.injured_id) : ''}</b><span>מועד</span><b>${fmtDT(r.occurred_at)}</b><span>מקום</span><b>${esc(r.place)}</b>
        <span>איך קרתה</span><b>${esc(r.how)}</b><span>הפגיעה</span><b>${esc(r.injury || '—')}</b><span>פונה אל</span><b>${esc(r.evac || '—')}</b><span>עזרה ראשונה</span><b>${esc(r.first_aid || '—')}</b>
        <span>צילומים</span><b>${(r.photos || []).length ? r.photos.map((p, i) => `<button type="button" class="btn link" data-ph="${i}">צילום ${i + 1}</button>`).join(' ') : '—'}</b></div>
      <h3>הצהרות עדים <span class="mut small">${(r.witnesses || []).length}</span></h3>
      ${(r.witnesses || []).map(w => `<div class="wrow lv-ok"><div><b>${esc(w.name)}</b> <span class="small mut">${esc(w.phone || '')} · ${fmtDT(w.signed_at)}</span><div class="small pre">${esc(w.statement)}</div></div>${w.image ? `<img src="${w.image}" class="sigthumb" alt="חתימה">` : ''}</div>`).join('') || '<div class="empty small">עוד אין הצהרות עדים</div>'}
      ${can ? '<button type="button" class="btn" data-wit>＋ הצהרת עד חתומה</button>' : ''}
      ${closed ? `<p class="small mut">התיעוד הסתיים ${fmtDT(r.closed_at)}. אי אפשר לשנות.</p>` : ''}
    </div>
    <div class="dlg-f">${r.pdf_path ? '<button class="btn ghost" data-pdf>PDF</button>' : ''}${can ? '<button class="btn" data-close>סיום התיעוד והפקת PDF</button>' : ''}<button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  $$('[data-x]', el).forEach(b => b.onclick = () => el.remove());
  $$('[data-ph]', el).forEach(b => b.onclick = () => openFile(r.photos[+b.dataset.ph]));
  $('[data-pdf]', el)?.addEventListener('click', () => openFile(r.pdf_path));
  $('[data-wit]', el)?.addEventListener('click', () => { el.remove(); witnessForm(s, r); });
  $('[data-close]', el)?.addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const blob = await accidentPdf(s, { ...r, closed_at: new Date().toISOString() });
      const path = `${s.id}/reports/accident/${r.id}/report-${Date.now()}.pdf`;
      await db.putFile(path, new File([blob], 'accident.pdf', { type: 'application/pdf' }));
      Object.assign(r, await db.update('accident_reports', r.id, { pdf_path: path, closed_at: new Date().toISOString() }));
      el.remove(); toast('התיעוד נשמר'); render();
      openBlob(blob);
    } catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
  });
}

function witnessForm(s, r) {
  const el = h(`<div class="ov full" role="dialog" aria-modal="true"><div class="dlg signdlg"><div class="dlg-h"><h3>הצהרת עד</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><form>${field('שם העד', 'name', '', { req: true })}${field('טלפון', 'phone', '', { type: 'tel', attrs: 'dir="ltr"' })}
      ${area('מה ראיתי (במילים של העד)', 'statement')}</form>
      <p class="small">אני מצהיר/ה שמה שכתוב למעלה הוא מה שראיתי, ושהדברים נכונים.</p>
      <canvas class="sgpad tall" aria-label="חתימת העד"></canvas>
      <div class="actions"><button type="button" class="btn ghost" data-clear>ניקוי</button><button type="button" class="btn big" data-ok>חתימה ושמירה</button></div></div></div></div>`);
  document.body.appendChild(el);
  const p = pad($('canvas', el));
  const back = () => { el.remove(); accidentScreen(s, r); };
  $$('[data-x]', el).forEach(b => b.onclick = back);
  $('[data-clear]', el).onclick = p.clear;
  $('[data-ok]', el).onclick = async e => {
    const f = $('form', el).elements, name = f.name.value.trim(), st = f.statement.value.trim();
    if (!name) return toast('צריך שם עד', 'bad');
    if (st.length < 5) return toast('צריך לכתוב מה העד ראה', 'bad');
    if (p.empty()) return toast('העד צריך לחתום', 'bad');
    e.target.disabled = true;
    try {
      const w = { name, phone: f.phone.value.trim(), statement: st, image: p.png(), signed_at: new Date().toISOString(), by: S.user?.email || '' };
      Object.assign(r, await db.update('accident_reports', r.id, { witnesses: [...(r.witnesses || []), w] }));
      if (!r.witnesses?.length) r.witnesses = [w];
      toast('ההצהרה נשמרה'); back();
    } catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
  };
}

export async function accidentPdf(s, r) {
  const photos = await Promise.all((r.photos || []).map(imgFromPath));
  const sigs = await Promise.all((r.witnesses || []).map(w => loadImg(w.image)));
  const blocks = [
    { type: 'title', text: 'תיעוד תאונת עבודה', brand: 'צי הנדסה', sub: s.name + (s.address ? ', ' + s.address : '') },
    { type: 'kv', rows: [['מבצע הבנייה', conNames(s.id).join(', ') || '—'], ['הנפגע', r.injured_name + (r.injured_id ? ' · ' + r.injured_id : '')], ['מועד התאונה', fmtDT(r.occurred_at)],
      ['מקום', r.place], ['איך קרתה', r.how], ['הפגיעה', r.injury || '—'], ['פונה אל', r.evac || '—'], ['עזרה ראשונה', r.first_aid || '—']] },
    ...(photos.some(Boolean) ? [{ type: 'table', cols: photos.filter(Boolean).map((_, i) => ({ h: 'צילום ' + (i + 1), w: 1 / photos.filter(Boolean).length })), rows: [photos.filter(Boolean).map(img => ({ img }))] }] : []),
    { type: 'table', cols: [{ h: 'עד', w: 0.18 }, { h: 'הצהרה', w: 0.5 }, { h: 'חתימה', w: 0.17 }, { h: 'מועד', w: 0.15 }],
      rows: (r.witnesses || []).map((w, i) => [w.name + (w.phone ? '\n' + w.phone : ''), w.statement, sigs[i] ? { img: sigs[i] } : '', fmtDT(w.signed_at)]) },
    { type: 'p', size: 18, text: 'הודעה למשרד העבודה (מפקח העבודה האזורי) על תאונה שגרמה למוות או לאי-כושר של יותר מ-3 ימים: בטופס המקוון, דרך חובת "הודעה על תאונה" במערכת.' },
    { type: 'p', size: 16, color: '#666', text: `הופק ${fmtDT(new Date().toISOString())} ממערכת ניהול הבטיחות של צי הנדסה. ההצהרות נחתמו בטלפון ונשמרו ללא אפשרות עריכה.` }];
  return pagesToPdf(await renderPdfPages(blocks, `${s.name} · תיעוד תאונה · ${fmtDate(r.occurred_at)}`));
}

// טיוטת ההודעה למפקח שכבר נוצרה: משלימים שדות ריקים מהתיעוד (שדה שמישהו כבר כתב לא משתנה)
async function fillAccidentNotice(s, ev) {
  const duty = S.data.duties.find(d => d.event_id === ev.id && d.key === 'accident_notice');
  const n = duty && noticeFor(duty);
  if (!n || n.status !== 'draft' || !NOTICES.accident_notice) return;
  const fresh = draftFor(s, duty).fields || [];
  const fields = (n.fields || []).map(([k, v]) => [k, String(v || '').trim() ? v : (fresh.find(f => f[0] === k)?.[1] || '')]);
  await saveNotice(n, { fields });
}
