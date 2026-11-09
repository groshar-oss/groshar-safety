// חתימה במערכת על כתב ההסמכה: מבצע הבנייה והנציג חותמים באצבע. החתימה נשמרת עם נוסח המסמך וטביעת האצבע שלו.
// חתימה תקפה רק על הנוסח הנוכחי: אם פרטי האתר או הנציג השתנו אחרי החתימה, צריך לחתום מחדש.
import { db } from '../db.js';
import { S, hasRole, siteOrgs, syncSite, render } from '../app.js';
import { authLetterBody, authLetter } from './docs.js';
import { esc, h, $, $$, toast } from '../util.js';

const fmt = t => new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const sigsFor = person => (S.data.signatures || []).filter(g => g.doc_type === 'auth_letter' && g.doc_ref === person.id);
// החתימות התקפות לנוסח הנוכחי, לפי משבצת
export async function authSigs(site, person) {
  const body = authLetterBody(site, person), hash = await sha256(body);
  const all = sigsFor(person), cur = {};
  for (const g of all.filter(x => x.doc_hash === hash).sort((a, b) => String(a.signed_at).localeCompare(String(b.signed_at)))) cur[g.slot] = g;
  return { body, hash, cur, stale: all.some(x => x.doc_hash !== hash) };
}
export const authStatus = person => { const all = sigsFor(person); return all.length ? new Set(all.map(g => g.slot)).size === 2 ? 'signed' : 'partial' : 'none'; };

// משטח חתימה: ציור באצבע או בעכבר
function pad(canvas) {
  const ctx = canvas.getContext('2d'); let ink = false, down = false;
  const fit = () => { const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1; canvas.width = r.width * d; canvas.height = r.height * d; ctx.scale(d, d); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1C232C'; };
  fit();
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { down = true; canvas.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => { if (!down) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); ink = true; e.preventDefault(); });
  const up = () => { down = false; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  return { clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ink = false; }, empty: () => !ink, png: () => canvas.toDataURL('image/png') };
}

export async function openAuthSign(site, person) {
  const { body, hash, cur, stale } = await authSigs(site, person);
  const conName = siteOrgs(site.id, 'contractor').map(o => o.name).join(', ');
  const conPerson = S.data.site_people.find(p => p.site_id === site.id && p.role === 'con' && p.active !== false && !p.backup);
  const can = { executor: hasRole(site.id, 'con'), rep: hasRole(site.id, 'con', 'rep') };
  const slotHtml = (k, label, name, title) => cur[k]
    ? `<div class="sgslot done"><div class="small mut">${label}</div><img src="${cur[k].image}" alt="חתימה"><div><b>${esc(cur[k].signer_name)}</b>${cur[k].signer_title ? ' · ' + esc(cur[k].signer_title) : ''}</div><div class="small mut">נחתם ${fmt(cur[k].signed_at)} · ${esc(cur[k].signed_by_email || '')}</div></div>`
    : can[k] ? `<div class="sgslot" data-slot="${k}"><div class="small mut">${label}</div>
        <div class="grid g2"><label class="fld"><span>שם החותם</span><input name="n_${k}" value="${esc(name)}"></label><label class="fld"><span>תפקיד</span><input name="t_${k}" value="${esc(title)}"></label></div>
        <canvas class="sgpad" aria-label="משטח חתימה"></canvas>
        <label class="chk"><input type="checkbox" name="ok_${k}"> קראתי את הכתב ואני מאשר/ת את הנוסח</label>
        <div class="actions"><button type="button" class="btn small ghost" data-clear>ניקוי</button><button type="button" class="btn small" data-sign>חתימה</button></div></div>`
      : `<div class="sgslot"><div class="small mut">${label}</div><p class="small">ממתין לחתימה. רק ${k === 'executor' ? 'מבצע הבנייה' : 'מבצע הבנייה או הנציג'} יכולים לחתום כאן.</p></div>`;
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>חתימה על כתב הסמכה · ${esc(person.name)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b">
      ${stale ? '<div class="banner">פרטי האתר או הנציג השתנו אחרי חתימה קודמת. החתימות הקודמות שמורות בתיעוד, אבל על הנוסח הנוכחי צריך לחתום מחדש.</div>' : ''}
      <details ${cur.executor || cur.rep ? '' : 'open'}><summary><b>נוסח הכתב</b></summary><div class="sgdoc">${body}</div></details>
      <div class="sggrid">${slotHtml('executor', 'מבצע הבנייה', conPerson?.name || '', conName ? 'מטעם ' + conName : 'מבצע הבנייה')}${slotHtml('rep', 'הנציג באתר', person.name, 'נציג מבצע הבנייה באתר')}</div>
      <p class="small mut">נשמרים: החתימה, שם החותם, המשתמש המחובר, שעת השרת, המכשיר ונוסח הכתב עם טביעת אצבע (SHA-256). חתימה לא נערכת ולא נמחקת. אחרי שתי החתימות החובה "רישום נציג מבצע הבנייה" נסגרת עם הכתב.</p>
    </div>
    <div class="dlg-f"><button class="btn ghost" data-print>הדפסה / PDF</button><button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  const close = () => el.remove();
  $$('[data-x]', el).forEach(b => b.onclick = close);
  $('[data-print]', el).onclick = () => authLetter(site, person, cur);
  $$('[data-slot]', el).forEach(box => {
    const k = box.dataset.slot, p = pad($('canvas', box));
    $('[data-clear]', box).onclick = p.clear;
    $('[data-sign]', box).onclick = async e => {
      const name = $(`[name=n_${k}]`, box).value.trim(), title = $(`[name=t_${k}]`, box).value.trim();
      if (!name) return toast('צריך שם חותם', 'bad');
      if (p.empty()) return toast('צריך לחתום במשטח', 'bad');
      if (!$(`[name=ok_${k}]`, box).checked) return toast('צריך לאשר שקראת את הנוסח', 'bad');
      e.target.disabled = true;
      try {
        const [row] = await db.insert('signatures', { site_id: site.id, doc_type: 'auth_letter', doc_ref: person.id, doc_hash: hash, doc_snapshot: body, slot: k,
          signer_name: name, signer_title: title, image: p.png(), user_agent: navigator.userAgent.slice(0, 300), signed_by_email: S.user?.email || '', signed_at: new Date().toISOString() });
        (S.data.signatures ||= []).push(row);
        toast('החתימה נשמרה');
        close();
        await afterSign(site, person);
        render(); openAuthSign(site, person);
      } catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
    };
  });
}

// שתי החתימות קיימות: סוגרים את החובה "רישום נציג מבצע הבנייה" עם הכתב החתום
async function afterSign(site, person) {
  const { hash, cur } = await authSigs(site, person);
  if (!(cur.executor && cur.rep)) return;
  const duty = S.data.duties.find(d => d.site_id === site.id && d.key === 'con_rep' && d.status === 'open');
  if (!duty) return;
  try {
    const r = await db.update('duties', duty.id, { status: 'done', done_at: new Date().toISOString(), closed_at: new Date().toISOString(), done_by: S.user?.email || '',
      evidence_note: `כתב הסמכה ל${person.name} נחתם במערכת בידי ${cur.executor.signer_name} (מבצע הבנייה) ו${cur.rep.signer_name} (הנציג)`, evidence_ref: 'חתימה במערכת ' + hash.slice(0, 12) });
    Object.assign(duty, r); await syncSite(site, false);
    toast('הכתב נחתם, והחובה נסגרה');
  } catch (x) { toast('החתימה נשמרה, אבל סגירת החובה נכשלה: ' + x.message, 'bad'); }
}
