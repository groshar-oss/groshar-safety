// פנקס עובדים, הדרכות וציוד: חישובי תוקף, סטטוס עובד, חובות תוקף אוטומטיות, תמונות ו-PDF
import { db } from './db.js';
import { CAT, LAW } from './duties.js';
import { S, myRoles, hasRole } from './app.js';

const DAY = 864e5;
const D = () => S.data;

export const TRAINING_KINDS = {
  intro: 'הדרכה לעובד חדש לפני תחילת עבודה',
  annual: 'הדרכת בטיחות שנתית',
  height: 'הדרכה לעבודה בגובה',
  toolbox: 'תדריך בטיחות (שיחת בוקר)',
  other: 'הדרכה אחרת'
};
// הדרכות שנחשבות להדרכה הפרונטלית לפי תקנה 3(א) לתקנות ההדרכה
export const COUNTS_ANNUAL = ['intro', 'annual'];

export const EQUIP_KINDS = {
  lift_machine: { label: 'מכונת הרמה (עגורן, מנוף, מלגזה, במת הרמה)', months: 14, ref: `סעיף 81 ל${LAW.P}` },
  lift_gear: { label: 'שרשראות, חבלים ואביזרי הרמה', months: 6, ref: `סעיף 75 ל${LAW.P}` },
  other: { label: 'ציוד אחר שנדרש לו תסקיר', months: null, ref: 'לפי סוג הציוד' }
};

// ===== גיל ותעודה =====
export function age(birth, now = new Date()) {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00:00');
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return a;
}
// ספרת ביקורת של תעודת זהות ישראלית
export function validIsraeliId(v) {
  const s = String(v || '').replace(/\D/g, '');
  if (!s || s.length > 9) return false;
  const d = s.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) { let x = +d[i] * ((i % 2) + 1); if (x > 9) x -= 9; sum += x; }
  return sum % 10 === 0;
}

// ===== שאילתות =====
export const workersOf = siteId => (D().workers || []).filter(w => w.site_id === siteId);
export const trainingsOf = siteId => (D().trainings || []).filter(t => t.site_id === siteId).sort((a, b) => String(b.held_at).localeCompare(String(a.held_at)));
export const sigsOfTraining = tid => (D().training_signatures || []).filter(g => g.training_id === tid).sort((a, b) => String(a.signed_at).localeCompare(String(b.signed_at)));
export const sigsOfWorker = wid => (D().training_signatures || []).filter(g => g.worker_id === wid);
export const equipmentOf = siteId => (D().equipment || []).filter(e => e.site_id === siteId);
export const inspectionsOf = eid => (D().inspections || []).filter(x => x.equipment_id === eid).sort((a, b) => String(b.inspected_at).localeCompare(String(a.inspected_at)) || String(b.created_at).localeCompare(String(a.created_at)));
export const lastInspection = eid => inspectionsOf(eid)[0] || null;

// ===== נוכחות יומית =====
// היום לפי שעון ישראל (YYYY-MM-DD), כמו בשרת
export const israelDay = (t = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(t);
export const attendanceOf = (siteId, day) => (D().attendance || []).filter(a => a.site_id === siteId && (!day || a.day === day));
export const isPresent = (wid, day = israelDay()) => !!(D().attendance || []).find(a => a.worker_id === wid && a.day === day && a.present);
export const daysPresent = (wid, days = 30) => { const from = israelDay(new Date(Date.now() - days * DAY)); return (D().attendance || []).filter(a => a.worker_id === wid && a.present && a.day > from).length; };
// היום האחרון לפני היום שבו סומנה נוכחות באתר
export function lastAttendanceDay(siteId, before = israelDay()) {
  return attendanceOf(siteId).filter(a => a.day < before && a.present).map(a => a.day).sort().pop() || null;
}

// ===== אישור עבודה בגובה: חובה לכל עובד, החרגה באישור בלבד =====
// ההחלטה האחרונה על העובד (החרגה או ביטול). מחזיר את ההחרגה אם היא בתוקף
export function heightExemption(w) {
  const last = (D().worker_exemptions || []).filter(x => x.worker_id === w.id && x.kind === 'height').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).pop();
  return last && !last.cancel ? last : null;
}
export const siteHasSm = siteId => (D().site_people || []).some(p => p.site_id === siteId && p.role === 'sm' && p.active !== false);
// מי מאשר החרגה: באתר עם מנהל אתר, רק מנהל האתר. בלי מנהל אתר: הנהלת הקבלן הראשי או מנהל השירות
export const canExemptHeight = siteId => siteHasSm(siteId) ? myRoles(siteId).includes('sm') : hasRole(siteId, 'con');
export const exemptApprover = siteId => siteHasSm(siteId) ? 'מנהל האתר' : 'הנהלת הקבלן הראשי או מנהל השירות';

// ההדרכה הפרונטלית האחרונה של העובד (תאריך החתימה)
export function lastAnnual(w) {
  const ids = new Set((D().trainings || []).filter(t => COUNTS_ANNUAL.includes(t.kind)).map(t => t.id));
  const s = sigsOfWorker(w.id).filter(g => ids.has(g.training_id)).sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))[0];
  return s ? s.signed_at : null;
}
const dms = d => d ? new Date(String(d).length === 10 ? d + 'T08:00:00' : d).getTime() : null;
const addMonths = (d, m) => { const x = new Date(d + 'T00:00:00'); x.setMonth(x.getMonth() + m); return x.toISOString().slice(0, 10); };
export const nextDueFor = (kind, inspected) => EQUIP_KINDS[kind]?.months && inspected ? addMonths(inspected, EQUIP_KINDS[kind].months) : '';

// תאריכי התוקף של עובד: [מפתח, מועד, כותרת]
export function workerDeadlines(w) {
  if (w.active === false) return [];
  const out = [];
  const la = lastAnnual(w);
  out.push(['exp_train', la ? dms(la) + 365 * DAY : dms(w.created_at), la ? `הדרכת בטיחות שנתית: ${w.name}` : `הדרכה לפני תחילת עבודה: ${w.name}`]);
  if (!heightExemption(w)) {
    if (w.height && w.height_until) out.push(['exp_height', dms(w.height_until) + DAY - 1, `אישור עבודה בגובה: ${w.name}`]);
    else out.push(['exp_height', dms(w.created_at), `חסר אישור עבודה בגובה: ${w.name}`]);
  }
  if (w.foreign_worker && w.permit_until) out.push(['exp_permit', dms(w.permit_until) + DAY - 1, `היתר עבודה של עובד זר: ${w.name}`]);
  if (w.foreign_worker && w.entry_date && !w.f8_date) out.push(['exp_f8', dms(w.entry_date) + 30 * DAY, `הדרכת 8 שעות לעובד זר: ${w.name}`]);
  return out;
}

// סטטוס עובד: ok (מותר לעבוד) · warn (משהו פג בקרוב) · bad (אסור להעסיק עד שמשלימים)
export function workerStatus(w, now = Date.now()) {
  if (w.active === false) return { lv: 'off', issues: ['לא פעיל באתר'] };
  const issues = [], soon = [];
  for (const [k, due] of workerDeadlines(w)) {
    const name = { exp_train: lastAnnual(w) ? 'הדרכה שנתית' : 'לא הודרך', exp_height: 'אישור עבודה בגובה', exp_permit: 'היתר עובד זר', exp_f8: 'הדרכת 8 שעות לעובד זר' }[k];
    const warn = CAT[k].warnH * 36e5;
    if (due <= now) issues.push(k === 'exp_train' && !lastAnnual(w) ? 'לא הודרך: אסור להעסיק' : k === 'exp_height' && !w.height ? 'אין אישור עבודה בגובה' : name + (k === 'exp_f8' ? ': עבר המועד' : ': פג תוקף'));
    else if (due - now <= warn) soon.push(`${name}: נגמר ב-${new Date(due).toLocaleDateString('he-IL')}`);
  }
  const a = age(w.birth_date);
  if (a !== null && a < 18) issues.unshift('מתחת לגיל 18: אסור לעבוד באתר בנייה');
  return { lv: issues.length ? 'bad' : soon.length ? 'warn' : 'ok', issues: [...issues, ...soon] };
}

// ===== חובות תוקף: נוצרות, מתעדכנות ונסגרות לבד =====
export function syncExpiry(site, duties, now = Date.now()) {
  const want = new Map(); // key -> {due, title}
  for (const w of workersOf(site.id)) for (const [k, due, title] of workerDeadlines(w)) want.set(`${k}:${w.id}`, { due, title });
  for (const e of equipmentOf(site.id)) {
    if (e.active === false) continue;
    const li = lastInspection(e.id);
    want.set(`exp_equip:${e.id}`, { due: li ? dms(li.next_due) + DAY - 1 : dms(e.created_at), title: li ? `תסקיר: ${e.name}${e.ident ? ' ' + e.ident : ''}` : `אין תסקיר: ${e.name}${e.ident ? ' ' + e.ident : ''}` });
  }
  const add = [], upd = [], seen = new Set();
  const iso = t => new Date(t).toISOString();
  for (const d of duties.filter(x => x.site_id === site.id && x.kind === 'expiry' && x.status === 'open')) {
    seen.add(d.key);
    const w = want.get(d.key);
    if (!w) {
      const wk = d.key.startsWith('exp_height:') && workersOf(site.id).find(x => x.id === d.key.split(':')[1] && x.active !== false);
      const ex = wk && heightExemption(wk);
      upd.push({ id: d.id, status: 'na', na_reason: ex ? `החרגה מאישור עבודה בגובה באישור ${ex.approver_name || ex.approved_by_email || ''}: ${ex.reason}` : 'העובד או הציוד כבר לא פעילים באתר, או שהדרישה הוסרה', closed_at: iso(now) });
      continue;
    }
    if (Math.abs(dms(d.due_at) - w.due) > 6e4) {
      // חודש: סוגרים את המופע הישן ופותחים חדש עם התוקף החדש
      upd.push({ id: d.id, status: 'done', done_at: iso(now), closed_at: iso(now), done_by: 'עדכון אוטומטי מפנקס העובדים / הציוד',
        evidence_note: `עודכן. מועד חדש: ${new Date(w.due).toLocaleDateString('he-IL')}`, evidence_ref: 'פנקס העובדים / ציוד ותסקירים' });
      add.push(inst(site, d.key, w));
    }
  }
  for (const [key, w] of want) {
    if (seen.has(key)) continue;
    // הדרכת 8 שעות שכבר הושלמה לא נפתחת שוב
    add.push(inst(site, key, w));
  }
  return { add, upd };
}
function inst(site, key, w) {
  const c = CAT[key];
  return { site_id: site.id, key, side: c.side, holder: c.holder, kind: 'expiry', title: w.title, ref: c.ref, critical: true,
    due_at: new Date(w.due).toISOString(), status: 'open', event_id: null, seq: 1, auto: true };
}
// מה צריך לעשות כדי לסגור חובת תוקף: קישור לכרטיס העובד או לציוד
export function expiryLink(d) {
  const [k, id] = d.key.split(':');
  return k === 'exp_equip' ? `#/site/${d.site_id}/equipment/${id}` : `#/site/${d.site_id}/workers/${id}`;
}

// ===== קבצים =====
// תמונה מהמצלמה: מקטינים ל-1600 פיקסל ושומרים JPEG, כדי לחסוך מקום ונתונים בשטח
export async function shrinkImage(file, max = 1600, q = 0.8) {
  if (!file || !/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    return blob && blob.size < file.size ? new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
const safeName = n => String(n || 'file').replace(/[^\w.\-א-ת]+/g, '_').slice(-60);
export async function putWorkerFile(siteId, workerId, kind, file) {
  const f = await shrinkImage(file);
  const path = `${siteId}/workers/${workerId}/${kind}-${Date.now()}-${safeName(f.name)}`;
  await db.putFile(path, f);
  return path;
}
export async function putEquipFile(siteId, eqId, file) {
  const f = await shrinkImage(file);
  const path = `${siteId}/equipment/${eqId}/${Date.now()}-${safeName(f.name)}`;
  await db.putFile(path, f);
  return path;
}

// ===== PDF =====
// מציירים כל עמוד על קנבס (הדפדפן מסדר עברית ומספרים נכון), ובונים קובץ PDF עם תמונת JPEG לכל עמוד. בלי ספריות חיצוניות
const PW = 1240, PH = 1754, M = 70; // A4 ב-150 DPI
const FONT = 'Arial, "Noto Sans Hebrew", Helvetica, sans-serif';
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

// שבירת שורות לפי רוחב
function wrap(ctx, text, w) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width <= w) { line = t; continue; }
      if (ctx.measureText(word).width > w) {
        // שפות בלי רווחים (סינית, תאית): שוברים לפי תווים
        const src = (line ? line + ' ' : '') + word; line = '';
        for (const ch of [...src]) { if (ctx.measureText(line + ch).width > w && line) { out.push(line); line = ch; } else line += ch; }
        continue;
      }
      if (!line) line = t; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// blocks: title | kv | table | p | sig. מחזיר מערך קנבסים (עמודים)
export async function renderPdfPages(blocks, footer = '') {
  const pages = [];
  let c, ctx, y;
  const newPage = () => {
    c = document.createElement('canvas'); c.width = PW; c.height = PH; ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PW, PH); ctx.direction = 'rtl'; ctx.textBaseline = 'top';
    pages.push(c); y = M;
  };
  const font = (size, bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`; };
  const text = (s, x, yy, { size = 22, bold = false, color = '#111', align = 'right', dir = 'rtl' } = {}) => { font(size, bold); ctx.fillStyle = color; ctx.textAlign = align; ctx.direction = dir; ctx.fillText(s, x, yy); ctx.direction = 'rtl'; };
  const ensure = h => { if (y + h > PH - M - 40) newPage(); };
  newPage();
  for (const b of blocks) {
    if (b.type === 'title') {
      text(b.text, PW - M, y, { size: 40, bold: true, color: '#1C3A5E' });
      text(b.brand || '', M, y + 8, { size: 26, bold: true, color: '#1C3A5E', align: 'left' });
      y += 54;
      if (b.sub) { font(20); for (const l of wrap(ctx, b.sub, PW - 2 * M)) { text(l, PW - M, y, { size: 20, color: '#555' }); y += 28; } }
      ctx.fillStyle = '#1C3A5E'; ctx.fillRect(M, y + 4, PW - 2 * M, 5); y += 26;
    } else if (b.type === 'kv') {
      const kw = 250, vw = PW - 2 * M - kw;
      for (const [k, v] of b.rows) {
        font(22); const lines = wrap(ctx, v, vw - 24); const h = Math.max(1, lines.length) * 30 + 16;
        ensure(h);
        ctx.fillStyle = '#eef2f7'; ctx.fillRect(PW - M - kw, y, kw, h);
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5; ctx.strokeRect(M, y, PW - 2 * M, h); ctx.beginPath(); ctx.moveTo(PW - M - kw, y); ctx.lineTo(PW - M - kw, y + h); ctx.stroke();
        text(k, PW - M - 12, y + 9, { size: 22, bold: true, color: '#333' });
        lines.forEach((l, i) => text(l, PW - M - kw - 12, y + 9 + i * 30));
        y += h;
      }
      y += 18;
    } else if (b.type === 'table') {
      const W = PW - 2 * M, cols = b.cols.map(cc => ({ ...cc, px: cc.w * W }));
      const xs = []; let x = PW - M; for (const cc of cols) { xs.push(x); x -= cc.px; }
      const head = () => {
        ensure(46); ctx.fillStyle = '#1C3A5E'; ctx.fillRect(M, y, W, 42);
        cols.forEach((cc, i) => text(cc.h, xs[i] - 8, y + 10, { size: 19, bold: true, color: '#fff' })); y += 42;
      };
      head();
      for (const r of b.rows) {
        font(20);
        const cells = r.map((v, i) => v && v.img ? { img: v.img } : { lines: wrap(ctx, v, cols[i].px - 16) });
        const h = Math.max(70, ...cells.map(cl => cl.lines ? cl.lines.length * 27 + 16 : 70));
        if (y + h > PH - M - 40) { newPage(); head(); }
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5; ctx.strokeRect(M, y, W, h);
        cells.forEach((cl, i) => {
          if (i) { ctx.beginPath(); ctx.moveTo(xs[i], y); ctx.lineTo(xs[i], y + h); ctx.stroke(); }
          if (cl.img) { const im = cl.img, ih = Math.min(h - 10, 62), iw = Math.min(cols[i].px - 12, im.width * ih / im.height); ctx.drawImage(im, xs[i] - 6 - iw, y + (h - ih) / 2, iw, ih); }
          else cl.lines.forEach((l, j) => text(l, xs[i] - 8, y + 8 + j * 27, { size: 20 }));
        });
        y += h;
      }
      y += 18;
    } else if (b.type === 'p') {
      const size = b.size || 20; font(size, b.bold);
      const ltr = b.dir === 'ltr';
      for (const l of wrap(ctx, b.text, PW - 2 * M)) { ensure(size + 10); text(l, ltr ? M : PW - M, y, { size, bold: b.bold, color: b.color || '#333', align: ltr ? 'left' : 'right', dir: ltr ? 'ltr' : 'rtl' }); y += size + 9; }
      y += 10;
    } else if (b.type === 'sig' && b.img) {
      ensure(110); const ih = 80, iw = b.img.width * ih / b.img.height; ctx.drawImage(b.img, PW - M - iw, y, iw, ih); y += ih + 14;
    }
  }
  pages.forEach((pg, i) => { const cx = pg.getContext('2d'); cx.direction = 'rtl'; cx.textBaseline = 'top'; cx.font = `16px ${FONT}`; cx.fillStyle = '#777'; cx.textAlign = 'right';
    cx.fillText(footer, PW - M, PH - M + 10); cx.textAlign = 'left'; cx.fillText(`עמוד ${i + 1} מתוך ${pages.length}`, M, PH - M + 10); });
  return pages;
}

// בונה PDF מתמונות JPEG (עמוד A4 לכל קנבס)
export async function pagesToPdf(pages) {
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const jpgs = [];
  for (const pg of pages) {
    const blob = await new Promise(r => pg.toBlob(r, 'image/jpeg', 0.85));
    jpgs.push(new Uint8Array(await blob.arrayBuffer()));
  }
  const n = pages.length, W = 595.28, H = 841.89;
  // אובייקטים: 1 קטלוג, 2 עמודים, לכל עמוד: עמוד, תמונה, תוכן
  const obj = (id, body) => { offs[id] = len; push(`${id} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((pg, i) => {
    const p = 3 + i * 3, im = p + 1, ct = p + 2;
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    obj(im, [`<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpgs[i].length} >>\nstream\n`, jpgs[i], '\nendstream']);
    const cs = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(ct, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
  });
  const total = 3 + n * 3, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}
export { loadImg };

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ספירה יומית מול "עובדים מרבי" בפרופיל. מספר העובדים קובע חובות (תוכנית בטיחות מ-50, ממונה בטיחות מ-100)
export function headcount(s, day = israelDay()) {
  const present = attendanceOf(s.id, day).filter(a => a.present).length;
  const max = +s.profile?.workers_max || 0;
  const msgs = [];
  if (present > max) msgs.push(`היום באתר ${present} עובדים, יותר מ"עובדים מרבי" בפרופיל המשפטי (${max}). צריך לעדכן את הפרופיל, כי מספר העובדים קובע חובות.`);
  if (present >= 50 && max < 50) msgs.push('50 עובדים ומעלה: נדרשת תוכנית לניהול הבטיחות במקום תוכנית ארגון בטיחות (תקנה 166).');
  if (present >= 100 && max < 100) msgs.push('100 עובדים ומעלה: חובה למנות ממונה על הבטיחות.');
  return { present, max, msgs };
}
