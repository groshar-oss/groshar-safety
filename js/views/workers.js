// פנקס עובדים והדרכות: רישום עובד (תעודה וצילום חובה, גיל 18 ומעלה), כרטיס עובד, הדרכה עם חתימות בטלפון ו-PDF אוטומטי
// עובדים לא נכנסים למערכת. רושם ומדריך: מנהל עבודה, נציג מבצע הבנייה, או מנהל השירות
import { db, uuid } from '../db.js';
import { S, hasRole, syncSite, render } from '../app.js';
import { esc, h, $, $$, toast, modal, field, select, area, fmtDate } from '../util.js';
import { TRAINING_KINDS, COUNTS_ANNUAL, age, validIsraeliId, workersOf, trainingsOf, sigsOfTraining, sigsOfWorker, lastAnnual, workerStatus,
  putWorkerFile, renderPdfPages, pagesToPdf, loadImg, sha256Hex } from '../workers.js';
import { pad } from './sign.js';
import { openFile, fmtDT } from './common.js';

export const canSeeWorkers = siteId => hasRole(siteId, 'con', 'so', 'sm', 'wm', 'rep', 'bakar');
export const canRegister = siteId => hasRole(siteId, 'wm', 'rep');
const today = () => new Date().toISOString().slice(0, 10);
const ST = { ok: ['green', 'מותר לעבוד'], warn: ['amber', 'פג בקרוב'], bad: ['red', 'אסור להעסיק'], off: ['', 'לא פעיל'] };
const stChip = st => `<span class="chip ${ST[st.lv][0]}">${ST[st.lv][1]}</span>`;
const idLabel = w => (w.id_type === 'passport' ? 'דרכון ' : 'ת"ז ') + w.id_number;

// ===== לשונית עובדים והדרכות =====
export function tabWorkers(s, c, d) {
  if (!canSeeWorkers(s.id)) return h('<div class="card empty">פנקס העובדים גלוי לצד הקבלן ולבקר הבטיחות בלבד</div>');
  if (c === 'training' && d) return trainingScreen(s, d);
  const can = canRegister(s.id);
  const all = workersOf(s.id).map(w => ({ w, st: workerStatus(w) }));
  const rank = { bad: 0, warn: 1, ok: 2, off: 3 };
  all.sort((a, b) => rank[a.st.lv] - rank[b.st.lv] || a.w.name.localeCompare(b.w.name, 'he'));
  const n = lv => all.filter(x => x.st.lv === lv).length;
  const trs = trainingsOf(s.id);
  const el = h(`<div>
    <div class="fbar">${can ? `<button class="btn big" data-newtr>＋ הדרכה חדשה</button><button class="btn big ghost" data-neww>＋ עובד חדש</button>` : '<p class="small mut">רישום עובדים והדרכות: מנהל העבודה, נציג מבצע הבנייה או מנהל השירות.</p>'}</div>
    <div class="kpis"><div class="kpi"><div class="l">מותר לעבוד</div><div class="v" style="color:#13804a">${n('ok')}</div></div>
      <div class="kpi"><div class="l">פג בקרוב</div><div class="v" style="color:#e08a00">${n('warn')}</div></div>
      <div class="kpi"><div class="l">אסור להעסיק</div><div class="v neg">${n('bad')}</div></div></div>
    <div class="card"><div class="dh"><h2>עובדים באתר <span class="mut small">${all.filter(x => x.st.lv !== 'off').length}</span></h2></div>
      <input class="search" placeholder="חיפוש לפי שם, חברה או מקצוע" data-q>
      <div class="wlist">${all.map(({ w, st }) => `<button type="button" class="wrow lv-${st.lv}" data-w="${w.id}" data-txt="${esc((w.name + ' ' + (w.company || '') + ' ' + (w.trade || '')).toLowerCase())}">
        <div><b>${esc(w.name)}</b> ${stChip(st)}${w.foreign_worker ? ' <span class="chip">עובד זר</span>' : ''}${w.height ? ' <span class="chip">עבודה בגובה</span>' : ''}
          <div class="small mut">${esc([w.company, w.trade].filter(Boolean).join(' · '))}</div>
          ${st.issues.length && st.lv !== 'off' ? `<div class="small ${st.lv === 'bad' ? 'neg' : ''}">${esc(st.issues.join(' · '))}</div>` : ''}</div><span class="go">‹</span></button>`).join('') || '<div class="empty">עוד לא נרשמו עובדים</div>'}</div></div>
    <div class="card"><h2>הדרכות <span class="mut small">${trs.length}</span></h2>
      ${trs.map(t => { const n2 = sigsOfTraining(t.id).length; return `<a class="wrow" href="#/site/${s.id}/workers/training/${t.id}"><div><b>${esc(TRAINING_KINDS[t.kind] || t.kind)}</b> ${t.closed_at ? '<span class="chip green">הסתיימה</span>' : '<span class="chip amber">פתוחה לחתימות</span>'}
        <div class="small mut">${fmtDT(t.held_at)} · ${esc(t.trainer_name)} · ${n2} חתמו</div><div class="small">${esc(t.topic)}</div></div><span class="go">‹</span></a>`; }).join('') || '<div class="empty">עוד לא נרשמו הדרכות</div>'}</div>
  </div>`);
  $('[data-q]', el).addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $$('[data-w]', el).forEach(r => r.hidden = q && !r.dataset.txt.includes(q)); });
  $$('[data-w]', el).forEach(b => b.onclick = () => workerCard(s, b.dataset.w));
  $('[data-neww]', el)?.addEventListener('click', () => workerForm(s));
  $('[data-newtr]', el)?.addEventListener('click', () => newTraining(s));
  if (c && c !== 'training') el.addEventListener('mounted', () => { if (workersOf(s.id).some(w => w.id === c) && !document.querySelector('.ov')) workerCard(s, c); });
  return el;
}

// ===== רישום ועריכת עובד =====
export async function workerForm(s, w = null, { after } = {}) {
  let form = null;
  const v = await modal({ title: w ? 'עדכון עובד' : 'עובד חדש', ok: 'שמירה', wide: true,
    body: `${field('שם מלא', 'name', w?.name || '', { req: true })}
      <div class="grid g2">${select('תעודה מזהה', 'id_type', { il: 'תעודת זהות ישראלית', passport: 'דרכון' }, w?.id_type || 'il')}
        ${field('מספר התעודה', 'id_number', w?.id_number || '', { req: true, attrs: 'dir="ltr" autocomplete="off"' })}</div>
      <div class="grid g2">${field('תאריך לידה', 'birth_date', w?.birth_date || '', { type: 'date', req: true, hint: 'אסור להעסיק באתר בנייה עובד מתחת לגיל 18' })}
        <label class="fld"><span>צילום התעודה${w?.id_photo_path ? ' (קיים. אפשר להחליף)' : ' <b class="req">*</b>'}</span><input type="file" name="id_photo" accept="image/*,application/pdf" capture="environment"></label></div>
      <div class="grid g2">${field('חברה (קבלן ראשי או קבלן משנה)', 'company', w?.company || '', { attrs: 'list="cmpList"' })}${field('מקצוע', 'trade', w?.trade || '')}</div>
      <datalist id="cmpList">${[...new Set([...(S.data.site_orgs.filter(x => x.site_id === s.id).map(x => S.data.orgs.find(o => o.id === x.org_id)?.name)), ...workersOf(s.id).map(x => x.company)].filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      ${field('טלפון', 'phone', w?.phone || '', { type: 'tel', attrs: 'dir="ltr"' })}
      <label class="chk"><input type="checkbox" name="foreign_worker" ${w?.foreign_worker ? 'checked' : ''}> עובד זר</label>
      <div class="sub-f" data-for="foreign_worker">
        <div class="grid g2">${field('אזרחות', 'nationality', w?.nationality || '')}${field('תאריך כניסה ראשונה לישראל', 'entry_date', w?.entry_date || '', { type: 'date', req: true })}</div>
        <div class="grid g2">${field('מספר היתר / אשרה', 'permit_no', w?.permit_no || '', { attrs: 'dir="ltr"' })}${field('ההיתר בתוקף עד', 'permit_until', w?.permit_until || '', { type: 'date', req: true })}</div>
        <p class="small mut">הדרכה נוספת של 8 שעות במוסד הכשרה מוכר, בשפת העובד, לפני תום חודש מהכניסה לישראל (תקנה 3א לתקנות ההדרכה):</p>
        <div class="grid g2">${field('תאריך ההדרכה', 'f8_date', w?.f8_date || '', { type: 'date' })}${field('מוסד ההכשרה', 'f8_institution', w?.f8_institution || '')}</div>
        <label class="fld"><span>אישור המוסד (צילום)</span><input type="file" name="f8_file" accept="image/*,application/pdf" capture="environment"></label></div>
      <label class="chk"><input type="checkbox" name="height" ${w?.height ? 'checked' : ''}> עובד בגובה</label>
      <div class="sub-f" data-for="height">
        <div class="grid g2">${field('אישור עבודה בגובה בתוקף עד', 'height_until', w?.height_until || '', { type: 'date', req: true, hint: 'האישור תקף עד שנתיים (תקנה 6(ג) לתקנות העבודה בגובה)' })}
          <label class="fld"><span>צילום האישור${w?.height_path ? ' (קיים. אפשר להחליף)' : ' <b class="req">*</b>'}</span><input type="file" name="height_file" accept="image/*,application/pdf" capture="environment"></label></div></div>
      ${w ? `<label class="chk"><input type="checkbox" name="active" ${w.active === false ? '' : 'checked'}> פעיל באתר</label>` : ''}`,
    onMount: el => {
      const sync = () => $$('.sub-f', el).forEach(b => b.hidden = !$(`[name=${b.dataset.for}]`, el).checked);
      $$('[name=foreign_worker],[name=height]', el).forEach(x => x.addEventListener('change', sync)); sync();
    },
    validate: (d, f) => {
      form = f;
      if (!d.name?.trim()) return 'צריך שם מלא';
      const id = d.id_number.trim();
      if (d.id_type === 'il' && !validIsraeliId(id)) return 'מספר תעודת הזהות לא תקין (ספרת ביקורת)';
      if (d.id_type === 'passport' && id.replace(/\s/g, '').length < 5) return 'צריך מספר דרכון מלא';
      if (workersOf(s.id).some(x => x.id !== w?.id && x.id_type === d.id_type && x.id_number === normId(d.id_type, id))) return 'עובד עם התעודה הזו כבר רשום באתר';
      if (!w?.id_photo_path && !f.id_photo.files[0]) return 'חובה לצרף צילום של התעודה';
      if (!d.birth_date) return 'צריך תאריך לידה';
      if (d.birth_date > today()) return 'תאריך הלידה בעתיד';
      if (age(d.birth_date) < 18) return 'אי אפשר לרשום: העובד מתחת לגיל 18. אסור להעסיק נער באתר בנייה (תקנה 1 ופרט 15 בתוספת לתקנות עבודת הנוער, התשנ"ו-1995).';
      if (d.foreign_worker) {
        if (!d.entry_date || !d.permit_until) return 'לעובד זר צריך תאריך כניסה לישראל ותוקף היתר';
        if (d.f8_date && !d.f8_institution?.trim()) return 'צריך את שם מוסד ההכשרה של הדרכת 8 השעות';
      }
      if (d.height) {
        if (!d.height_until) return 'צריך תוקף לאישור העבודה בגובה';
        if (!w?.height_path && !f.height_file.files[0]) return 'חובה לצרף צילום של אישור העבודה בגובה';
        const max = new Date(); max.setFullYear(max.getFullYear() + 2); max.setDate(max.getDate() + 1);
        if (d.height_until > max.toISOString().slice(0, 10)) return 'אישור עבודה בגובה תקף עד שנתיים. בדקו את התאריך';
      }
      return null;
    } });
  if (!v) return;
  const wid = w?.id || uuid();
  const row = { site_id: s.id, name: v.name.trim(), id_type: v.id_type, id_number: normId(v.id_type, v.id_number), birth_date: v.birth_date,
    company: v.company.trim(), trade: v.trade.trim(), phone: v.phone.trim(), foreign_worker: !!v.foreign_worker,
    nationality: v.foreign_worker ? v.nationality.trim() : null, entry_date: v.foreign_worker ? v.entry_date || null : null,
    permit_no: v.foreign_worker ? v.permit_no.trim() : null, permit_until: v.foreign_worker ? v.permit_until || null : null,
    f8_date: v.foreign_worker ? v.f8_date || null : null, f8_institution: v.foreign_worker ? v.f8_institution.trim() || null : null,
    height: !!v.height, height_until: v.height ? v.height_until : null };
  if (w) row.active = !!v.active;
  try {
    toast('שומר…');
    const f = n => form?.elements?.[n]?.files?.[0];
    if (f('id_photo')) row.id_photo_path = await putWorkerFile(s.id, wid, 'id', f('id_photo'));
    if (v.height && f('height_file')) row.height_path = await putWorkerFile(s.id, wid, 'height', f('height_file'));
    if (v.foreign_worker && f('f8_file')) row.f8_path = await putWorkerFile(s.id, wid, 'f8', f('f8_file'));
    if (w) { const r = await db.update('workers', w.id, row); Object.assign(w, r); }
    else { const [r] = await db.insert('workers', { id: wid, ...row }); (S.data.workers ||= []).push(r); }
    await syncSite(s, false);
    toast(w ? 'העובד עודכן' : 'העובד נרשם');
    if (after) return after(wid);
    render();
  } catch (e) { toast(e.message.includes('under_18') ? 'השרת חסם: העובד מתחת לגיל 18' : e.message, 'bad'); }
}
const normId = (t, v) => t === 'il' ? String(v).replace(/\D/g, '').padStart(9, '0') : String(v).replace(/\s/g, '').toUpperCase();

// ===== כרטיס עובד =====
function workerCard(s, wid) {
  const w = workersOf(s.id).find(x => x.id === wid); if (!w) return;
  const st = workerStatus(w), la = lastAnnual(w);
  const sigs = sigsOfWorker(w.id).sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
  const tr = id => (S.data.trainings || []).find(t => t.id === id);
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>${esc(w.name)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b">
      <div class="dh">${stChip(st)}${w.foreign_worker ? '<span class="chip">עובד זר</span>' : ''}${w.height ? '<span class="chip">עבודה בגובה</span>' : ''}</div>
      ${st.issues.length && st.lv !== 'off' ? `<div class="banner ${st.lv === 'bad' ? 'crit' : ''}">${esc(st.issues.join(' · '))}</div>` : ''}
      <div class="kv">
        <span>תעודה</span><b dir="ltr" style="text-align:right">${esc(idLabel(w))}</b>
        <span>גיל</span><b>${age(w.birth_date) ?? ''} (נולד ${esc(fmtDate(w.birth_date))})</b>
        <span>חברה</span><b>${esc(w.company || '—')}</b><span>מקצוע</span><b>${esc(w.trade || '—')}</b>
        ${w.phone ? `<span>טלפון</span><b dir="ltr" style="text-align:right">${esc(w.phone)}</b>` : ''}
        <span>הדרכה פרונטלית אחרונה</span><b>${la ? fmtDT(la) + ' · הבאה עד ' + fmtDate(new Date(new Date(la).getTime() + 365 * 864e5)) : '<span class="neg">לא הודרך</span>'}</b>
        ${w.height ? `<span>אישור עבודה בגובה</span><b>בתוקף עד ${esc(fmtDate(w.height_until))}</b>` : ''}
        ${w.foreign_worker ? `<span>אזרחות</span><b>${esc(w.nationality || '—')}</b><span>כניסה לישראל</span><b>${esc(fmtDate(w.entry_date))}</b>
          <span>היתר</span><b>${esc(w.permit_no || '')} · עד ${esc(fmtDate(w.permit_until))}</b>
          <span>הדרכת 8 שעות</span><b>${w.f8_date ? esc(fmtDate(w.f8_date) + ' · ' + (w.f8_institution || '')) : `<span class="neg">לא הוזנה. עד ${esc(fmtDate(new Date(new Date(w.entry_date).getTime() + 30 * 864e5)))}</span>`}</b>` : ''}
        <span>נרשם</span><b>${fmtDT(w.created_at)} · ${esc(w.added_by_email || '')}</b></div>
      <div class="actions"><button type="button" class="btn small ghost" data-f="${esc(w.id_photo_path)}">צילום התעודה</button>
        ${w.height_path ? `<button type="button" class="btn small ghost" data-f="${esc(w.height_path)}">אישור עבודה בגובה</button>` : ''}
        ${w.f8_path ? `<button type="button" class="btn small ghost" data-f="${esc(w.f8_path)}">אישור הדרכת 8 שעות</button>` : ''}</div>
      <h3>הדרכות שחתם עליהן</h3>
      ${sigs.map(g => { const t = tr(g.training_id); return `<a class="wrow" href="#/site/${s.id}/workers/training/${g.training_id}" data-x2><div><b>${esc(TRAINING_KINDS[t?.kind] || '')}</b><div class="small mut">${fmtDT(g.signed_at)} · ${esc(t?.trainer_name || '')}</div><div class="small">${esc(t?.topic || '')}</div></div><span class="go">‹</span></a>`; }).join('') || '<div class="empty small">אין חתימות על הדרכה</div>'}
    </div>
    <div class="dlg-f">${canRegister(s.id) ? '<button class="btn" data-edit>עדכון פרטים ואישורים</button>' : ''}<button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  const close = () => { el.remove(); if (location.hash.split('/').length > 4) history.replaceState(null, '', `#/site/${s.id}/workers`); };
  $$('[data-x]', el).forEach(b => b.onclick = close);
  $$('[data-x2]', el).forEach(b => b.addEventListener('click', () => el.remove()));
  $$('[data-f]', el).forEach(b => b.onclick = () => openFile(b.dataset.f));
  $('[data-edit]', el)?.addEventListener('click', () => { el.remove(); workerForm(s, w); });
}

// ===== הדרכה =====
const TOPIC = {
  intro: 'הדרכת אתר לעובד חדש: הסיכונים באתר ואמצעי הבטיחות, ציוד מגן אישי, עבודה בגובה ופתחים, מכונות וחשמל, עזרה ראשונה ויציאות חירום',
  annual: 'הדרכת בטיחות שנתית: הסיכונים בעבודה ובאתר, הוראות הבטיחות, ציוד מגן אישי, דיווח על מפגעים',
  height: 'עבודה בגובה באתר: רתמה וקו חיים, פיגומים, סולמות, גידור ופתחים',
  toolbox: '', other: ''
};
export async function newTraining(s) {
  const me = S.data.site_people.find(p => p.site_id === s.id && p.active !== false && (p.email || '').toLowerCase() === (S.user?.email || '').toLowerCase() && ['wm', 'rep'].includes(p.role))
    || S.data.site_people.find(p => p.site_id === s.id && p.active !== false && ['wm', 'rep'].includes(p.role) && !p.backup);
  const v = await modal({ title: 'הדרכה חדשה', ok: 'פתיחה והחתמת עובדים',
    body: `${select('סוג ההדרכה', 'kind', TRAINING_KINDS, 'intro')}
      ${area('נושא ותוכן ההדרכה', 'topic', TOPIC.intro)}
      <div class="grid g2">${field('שם המדריך', 'trainer_name', me?.name?.replace(/ \(.*\)$/, '') || '', { req: true })}${field('תפקיד וכשירות המדריך', 'trainer_title', me ? (me.role === 'rep' ? 'נציג מבצע הבנייה' : 'מנהל עבודה') + (me.license ? ', ' + me.license : '') : '')}</div>
      ${field('שפת ההדרכה', 'language', 'עברית')}
      <p class="small mut">ההדרכה באתר בנייה פנים אל פנים, בשפה שהעובד מבין, בידי בעל מקצוע מתאים. אחרי הפתיחה כל עובד חותם בטלפון, וה-PDF נשמר לבד אחרי כל חתימה.</p>`,
    onMount: el => $('[name=kind]', el).addEventListener('change', e => { const t = $('[name=topic]', el); if (!t.value.trim() || Object.values(TOPIC).includes(t.value)) t.value = TOPIC[e.target.value] || ''; }),
    validate: d => !d.topic?.trim() ? 'צריך נושא' : !d.trainer_name?.trim() ? 'צריך שם מדריך' : null });
  if (!v) return;
  try {
    const [t] = await db.insert('trainings', { site_id: s.id, kind: v.kind, topic: v.topic.trim(), trainer_name: v.trainer_name.trim(), trainer_title: v.trainer_title.trim(),
      language: v.language.trim(), content: '', held_at: new Date().toISOString() });
    (S.data.trainings ||= []).push(t);
    location.hash = `#/site/${s.id}/workers/training/${t.id}`;
  } catch (e) { toast(e.message, 'bad'); }
}

function trainingScreen(s, tid) {
  const t = (S.data.trainings || []).find(x => x.id === tid && x.site_id === s.id);
  if (!t) return h('<div class="card empty">ההדרכה לא נמצאה</div>');
  const sigs = sigsOfTraining(t.id), signed = new Map(sigs.map(g => [g.worker_id, g]));
  const can = canRegister(s.id) && !t.closed_at;
  const list = workersOf(s.id).filter(w => w.active !== false || signed.has(w.id));
  list.sort((a, b) => signed.has(a.id) - signed.has(b.id) || a.name.localeCompare(b.name, 'he'));
  const el = h(`<div>
    <a class="small" href="#/site/${s.id}/workers">→ חזרה לעובדים והדרכות</a>
    <div class="card"><h2>${esc(TRAINING_KINDS[t.kind])} ${t.closed_at ? '<span class="chip green">הסתיימה</span>' : '<span class="chip amber">פתוחה לחתימות</span>'}</h2>
      <p>${esc(t.topic)}</p>
      <div class="kv small"><span>מועד</span><b>${fmtDT(t.held_at)}</b><span>מדריך</span><b>${esc(t.trainer_name)}${t.trainer_title ? ' · ' + esc(t.trainer_title) : ''}</b><span>שפה</span><b>${esc(t.language || '')}</b>
        <span>חתמו</span><b>${sigs.length}</b>
        <span>PDF</span><b>${t.pdf_path ? `נשמר ${fmtDT(t.pdf_at || t.created_at)} · <button type="button" class="btn link" data-pdf>פתיחה</button>` : sigs.length ? '<span class="mut">יישמר בחתימה הבאה</span>' : '<span class="mut">נשמר לבד אחרי החתימה הראשונה</span>'}</b></div>
      ${t.trainer_sig ? `<div class="small mut">חתימת המדריך:</div><img src="${t.trainer_sig}" alt="חתימת המדריך" class="sigimg">` : ''}</div>
    <div class="card"><div class="dh"><h2>עובדים</h2>${can ? '<button class="btn small ghost" data-neww>＋ עובד חדש</button>' : ''}</div>
      ${list.map(w => { const g = signed.get(w.id), st = workerStatus(w); return `<div class="wrow ${g ? 'lv-ok' : ''}"><div><b>${esc(w.name)}</b>${g ? '' : ' ' + stChip(st)}<div class="small mut">${esc([w.company, w.trade].filter(Boolean).join(' · '))}</div>
        ${g ? `<div class="small ok-t">✓ חתם ${fmtDT(g.signed_at)}</div>` : ''}</div>
        ${g ? (g.image ? `<img src="${g.image}" alt="חתימה" class="sigthumb">` : '') : can ? `<button class="btn" data-wsign="${w.id}">חתימה</button>` : ''}</div>`; }).join('') || '<div class="empty">אין עובדים רשומים. מוסיפים עובד חדש, ואז הוא חותם.</div>'}</div>
    ${can ? `<div class="card"><button class="btn ghost" data-close ${sigs.length ? '' : 'disabled'}>סיום ההדרכה וחתימת המדריך</button><p class="small mut">אחרי הסיום אי אפשר להוסיף חתימות. ה-PDF הסופי נשמר עם חתימת המדריך.</p></div>` : ''}
  </div>`);
  $('[data-pdf]', el)?.addEventListener('click', () => openFile(t.pdf_path));
  $('[data-neww]', el)?.addEventListener('click', () => workerForm(s, null, { after: wid => { render(); setTimeout(() => signWorker(s, t, wid), 300); } }));
  $$('[data-wsign]', el).forEach(b => b.onclick = () => signWorker(s, t, b.dataset.wsign));
  $('[data-close]', el)?.addEventListener('click', () => closeTraining(s, t));
  return el;
}

const statement = (s, t, w) => `אני, ${w.name}, ${w.id_type === 'passport' ? 'דרכון' : 'ת"ז'} ${w.id_number}, מאשר/ת שהיום, ${new Date().toLocaleDateString('he-IL')}, קיבלתי ${TRAINING_KINDS[t.kind]} באתר ${s.name}, בנושא: ${t.topic}. ההדרכה ניתנה פנים אל פנים בידי ${t.trainer_name}, בשפה שאני מבין/ה (${t.language || '—'}), והבנתי אותה.`;

// מסך חתימה מלא: העובד קורא, חותם באצבע ומאשר
function signWorker(s, t, wid) {
  const w = workersOf(s.id).find(x => x.id === wid); if (!w) return;
  const st = workerStatus(w);
  if (age(w.birth_date) < 18) return toast('אסור להעסיק עובד מתחת לגיל 18', 'bad');
  const text = statement(s, t, w);
  const el = h(`<div class="ov full" role="dialog" aria-modal="true"><div class="dlg signdlg"><div class="dlg-h"><h3>חתימה על קבלת הדרכה</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><div class="signname">${esc(w.name)}</div>
      ${st.lv === 'bad' && !st.issues.every(x => /לא הודרך|הדרכה שנתית/.test(x)) ? `<div class="banner crit">${esc(st.issues.join(' · '))}</div>` : ''}
      <p class="signtext">${esc(text)}</p>
      <canvas class="sgpad tall" aria-label="משטח חתימה"></canvas>
      <div class="actions"><button type="button" class="btn ghost" data-clear>ניקוי</button><button type="button" class="btn big" data-ok>אישור וחתימה</button></div></div></div></div>`);
  document.body.appendChild(el);
  const p = pad($('canvas', el));
  const close = () => el.remove();
  $$('[data-x]', el).forEach(b => b.onclick = close);
  $('[data-clear]', el).onclick = p.clear;
  $('[data-ok]', el).onclick = async e => {
    if (p.empty()) return toast('צריך לחתום במשטח', 'bad');
    e.target.disabled = true;
    try {
      const [g] = await db.insert('training_signatures', { training_id: t.id, site_id: s.id, worker_id: w.id, worker_name: w.name, statement: text, image: p.png(),
        user_agent: navigator.userAgent.slice(0, 300), signed_by_email: S.user?.email || '', signed_at: new Date().toISOString() });
      (S.data.training_signatures ||= []).push(g);
      close(); toast(`${w.name} חתם`);
      if (COUNTS_ANNUAL.includes(t.kind)) await syncSite(s, false);
      render();
      savePdf(s, t).catch(x => toast('החתימה נשמרה, אבל שמירת ה-PDF נכשלה: ' + x.message, 'bad'));
    } catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
  };
}

async function closeTraining(s, t) {
  const el = h(`<div class="ov full" role="dialog" aria-modal="true"><div class="dlg signdlg"><div class="dlg-h"><h3>סיום ההדרכה</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><p>אני, ${esc(t.trainer_name)}, מצהיר/ה שהעברתי את ההדרכה פנים אל פנים, בשפה שהעובדים מבינים, לעובדים שחתמו (${sigsOfTraining(t.id).length}).</p>
      <canvas class="sgpad tall" aria-label="חתימת המדריך"></canvas>
      <div class="actions"><button type="button" class="btn ghost" data-clear>ניקוי</button><button type="button" class="btn big" data-ok>סיום וחתימה</button></div></div></div></div>`);
  document.body.appendChild(el);
  const p = pad($('canvas', el));
  $$('[data-x]', el).forEach(b => b.onclick = () => el.remove());
  $('[data-clear]', el).onclick = p.clear;
  $('[data-ok]', el).onclick = async e => {
    if (p.empty()) return toast('צריך חתימת מדריך', 'bad');
    e.target.disabled = true;
    try {
      const r = await db.update('trainings', t.id, { trainer_sig: p.png(), closed_at: new Date().toISOString() });
      Object.assign(t, r); el.remove(); toast('ההדרכה הסתיימה');
      await savePdf(s, t).catch(x => toast('שמירת ה-PDF נכשלה: ' + x.message, 'bad'));
      render();
    } catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
  };
}

// ===== PDF אוטומטי: נשמר אחרי כל חתימה ובסיום =====
export async function trainingPdf(s, t, sigs, at, hash) {
  const ws = new Map(workersOf(s.id).map(w => [w.id, w]));
  const con = S.data.site_orgs.filter(x => x.site_id === s.id && x.kind === 'contractor').map(x => S.data.orgs.find(o => o.id === x.org_id)?.name).filter(Boolean).join(', ');
  const imgs = await Promise.all(sigs.map(g => loadImg(g.image)));
  const blocks = [
    { type: 'title', text: 'רישום הדרכת בטיחות לעובדים', brand: 'צי הנדסה', sub: 'לפי תקנות 3 ו-6 לתקנות ארגון הפיקוח על העבודה (מסירת מידע והדרכת עובדים), התשנ"ט-1999' },
    { type: 'kv', rows: [['האתר', s.name + (s.address ? ', ' + s.address : '')], ['מבצע הבנייה', con || '—'], ['סוג ההדרכה', TRAINING_KINDS[t.kind]], ['נושא ותוכן', t.topic],
      ['מועד', fmtDT(t.held_at)], ['המדריך', t.trainer_name + (t.trainer_title ? ', ' + t.trainer_title : '')], ['שפת ההדרכה', t.language || '—']] },
    { type: 'table', cols: [{ h: '#', w: 0.05 }, { h: 'שם העובד', w: 0.2 }, { h: 'תעודה', w: 0.16 }, { h: 'חברה · מקצוע', w: 0.21 }, { h: 'חתימה', w: 0.2 }, { h: 'מועד החתימה', w: 0.18 }],
      rows: sigs.map((g, i) => { const w = ws.get(g.worker_id) || {}; return [String(i + 1), g.worker_name, w.id_number ? (w.id_type === 'passport' ? 'דרכון ' : 'ת"ז ') + w.id_number : '',
        [w.company, w.trade].filter(Boolean).join(' · '), imgs[i] ? { img: imgs[i] } : '', fmtDT(g.signed_at)]; }) },
    { type: 'p', text: 'מועד החתימה לפי שעון השרת. כל עובד אישר בחתימתו שקיבל את ההדרכה פנים אל פנים, בשפה שהוא מבין, ושהבין אותה. נוסח האישור המלא של כל עובד שמור במערכת.', size: 18 }
  ];
  if (t.trainer_sig) blocks.push({ type: 'p', text: `הצהרת המדריך: העברתי את ההדרכה פנים אל פנים, בשפה שהעובדים מבינים. ${t.trainer_name}`, bold: true, size: 20, color: '#111' }, { type: 'sig', img: await loadImg(t.trainer_sig) });
  else blocks.push({ type: 'p', text: 'ההדרכה עוד פתוחה. המסמך מתעדכן לבד עם כל חתימה, ובסיום עם חתימת המדריך.', bold: true, color: '#b00020' });
  blocks.push({ type: 'p', size: 16, color: '#666', text: `הופק אוטומטית ${fmtDT(at)} ממערכת ניהול הבטיחות של צי הנדסה. החתימות נשמרו במערכת עם שעת השרת והמשתמש שהחזיק את הטלפון, ואינן ניתנות לעריכה או למחיקה. יש לצרף עותק לפנקס ההדרכה.` },
    { type: 'p', size: 15, color: '#666', text: 'טביעת אצבע (SHA-256) של רשימת החתימות: ' + hash });
  return pagesToPdf(await renderPdfPages(blocks, `${s.name} · ${TRAINING_KINDS[t.kind]} · ${fmtDT(t.held_at)}`));
}
async function savePdf(s, t) {
  const sigs = sigsOfTraining(t.id);
  if (!sigs.length) return;
  const at = new Date().toISOString();
  const hash = await sha256Hex(JSON.stringify(sigs.map(g => [g.id, g.worker_id, g.signed_at, g.statement, (g.image || '').length])));
  const blob = await trainingPdf(s, t, sigs, at, hash);
  const path = `${s.id}/workers/trainings/${t.id}/${at.replace(/[:.]/g, '-')}-${sigs.length}${t.closed_at ? '-final' : ''}.pdf`;
  await db.putFile(path, new File([blob], 'training.pdf', { type: 'application/pdf' }));
  const r = await db.update('trainings', t.id, { pdf_path: path });
  Object.assign(t, r, { pdf_at: r.pdf_at || at });
  toast('ה-PDF נשמר');
  if (location.hash.includes(t.id)) render();
}
