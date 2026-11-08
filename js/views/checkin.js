// צ'ק-אין יומי והשגחה באתר: מנהל העבודה או נציג מבצע הבנייה מסמנים נוכחות מהטלפון, עם ביקורות היום
import { db } from '../db.js';
import { S, siteById, syncSite, render, myRoles } from '../app.js';
import { derive, dayKey, ACTIVITIES, ROLES } from '../duties.js';
import { esc, h, $, toast, modal, area, select } from '../util.js';

// ביקורות יומיות שנעשות בצ'ק-אין, לפי העבודות באתר
const DAILY = { excavation: 'ביקורת בטיחות של חפירה, מילוי, חציבה או דיפון לפני תחילת העבודה (תקנה 122)', machines: 'ביקורת גידור והתקני בטיחות במכונות (תקנה 142א)' };

export const todayCheckinDuty = siteId => S.data.duties.find(d => d.site_id === siteId && d.key === 'daily_checkin' && d.seq === +dayKey(Date.now()));
export const checkinsFor = siteId => (S.data.checkins || []).filter(c => c.site_id === siteId).sort((a, b) => String(b.at).localeCompare(String(a.at)));

// מי רשאי לסמן נוכחות: מנהל עבודה, נציג, ממלאי מקום, ומבצע הבנייה
export function checkinPeople(siteId) {
  return S.data.site_people.filter(p => p.site_id === siteId && p.active !== false && ['wm', 'rep'].includes(p.role));
}

export async function checkinForm(siteId, duty = null) {
  const site = siteById(siteId); if (!site) return;
  duty = duty || todayCheckinDuty(siteId);
  if (!duty) return toast('אין היום חובת צ\'ק-אין באתר הזה (לא יום עבודה, או שהאתר לא פעיל)', 'bad');
  if (duty.status !== 'open') return toast('הצ\'ק-אין של היום כבר בוצע', 'ok');
  const d = derive(site.profile || {});
  const ppl = checkinPeople(siteId);
  const me = (S.user?.email || '').toLowerCase();
  const mine = ppl.find(p => (p.email || '').toLowerCase() === me) || ppl.find(p => myRoles(siteId).includes(p.role)) || ppl[0];
  const opts = Object.fromEntries(ppl.map(p => [p.id, `${p.name} · ${p.role === 'rep' ? 'נציג מבצע הבנייה' : ROLES[p.role]}${p.backup ? ' (ממלא מקום)' : ''}`]));
  const checks = Object.keys(DAILY).filter(k => d.act[k]);
  const day = new Date(duty.due_at).toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit' });
  let loc = null;
  const v = await modal({ title: 'צ\'ק-אין והשגחה באתר', ok: 'אישור נוכחות',
    body: `<p class="small mut">${esc(site.name)} · ${esc(day)}</p>
      ${ppl.length ? select('מי באתר', 'person', opts, mine?.id || '') : '<div class="banner crit">אין באתר מנהל עבודה או נציג מבצע הבנייה רשום. מוסיפים בלשונית "בעלי תפקידים".</div>'}
      ${checks.map(k => `<div class="ck"><b>${esc(DAILY[k])}</b>
        <div class="radios"><label><input type="radio" name="ck_${k}" value="ok"> תקין</label><label><input type="radio" name="ck_${k}" value="bad"> נמצאו ליקויים</label></div>
        <input name="ckn_${k}" placeholder="ממצאים / פעולה שננקטה" class="ckn"></div>`).join('')}
      ${area('מה מתבצע היום ואילו קבלנים באתר', 'note')}
      <label class="chk"><input type="checkbox" name="geo"> לצרף מיקום (לא חובה)</label><div class="small mut" id="geoMsg"></div>`,
    onMount: el => {
      $('[name=geo]', el)?.addEventListener('change', e => {
        if (!e.target.checked) { loc = null; $('#geoMsg', el).textContent = ''; return; }
        if (!navigator.geolocation) { $('#geoMsg', el).textContent = 'המכשיר לא תומך במיקום'; return; }
        $('#geoMsg', el).textContent = 'מאתר מיקום…';
        navigator.geolocation.getCurrentPosition(p => { loc = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }; $('#geoMsg', el).textContent = `מיקום נקלט (דיוק ${loc.acc} מ')`; },
          () => { loc = null; $('#geoMsg', el).textContent = 'לא התקבל מיקום. אפשר להמשיך בלי.'; }, { timeout: 10000, maximumAge: 60000 });
      });
    },
    validate: dd => {
      if (!ppl.length || !dd.person) return 'צריך לבחור מי באתר';
      for (const k of checks) {
        if (!dd['ck_' + k]) return 'צריך לסמן את תוצאת הביקורת: ' + DAILY[k];
        if (dd['ck_' + k] === 'bad' && !(dd['ckn_' + k] || '').trim()) return 'צריך לפרט את הליקויים ומה נעשה';
      }
      if ((dd.note || '').trim().length < 3) return 'צריך לכתוב בקצרה מה מתבצע היום';
      return null;
    } });
  if (!v) return;
  const p = ppl.find(x => x.id === v.person);
  const at = new Date().toISOString();
  const results = Object.fromEntries(checks.map(k => [k, { ok: v['ck_' + k] === 'ok', note: (v['ckn_' + k] || '').trim(), title: DAILY[k] }]));
  const row = { site_id: siteId, duty_id: duty.id, day: duty.seq, person_id: p.id, person_name: p.name, role: p.role, backup: !!p.backup, at,
    lat: loc?.lat ?? null, lng: loc?.lng ?? null, accuracy: loc?.acc ?? null, checks: results, note: v.note.trim(), by: window.__actor || S.user.email };
  try {
    const [c] = await db.insert('checkins', row); (S.data.checkins ||= []).push(c);
    const sum = checks.map(k => `${DAILY[k].split(' (')[0]}: ${results[k].ok ? 'תקין' : 'ליקויים: ' + results[k].note}`).join(' · ');
    const r = await db.update('duties', duty.id, { status: 'done', done_at: at, closed_at: at, done_by: `${p.name} (${p.role === 'rep' ? 'נציג מבצע הבנייה, מטעם מבצע הבנייה' : ROLES[p.role]})`,
      evidence_note: `נוכחות והשגחה באתר. ${v.note.trim()}${sum ? ' · ' + sum : ''}`, evidence_ref: 'צ\'ק-אין ' + new Date(at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) });
    Object.assign(S.data.duties.find(x => x.id === duty.id), r);
    await syncSite(site, false);
    toast(checks.some(k => !results[k].ok) ? 'הצ\'ק-אין נשמר. נמצאו ליקויים: אם יש סיכון שאינו קביל, מדווחים אירוע.' : 'הצ\'ק-אין נשמר'); render();
  } catch (e) { toast(e.message, 'bad'); }
}

// כרטיס קטן לראש מסך האתר ולמסך הבית
export function checkinCard(site) {
  const d = todayCheckinDuty(site.id);
  if (!d) return '';
  const c = checkinsFor(site.id).find(x => x.duty_id === d.id);
  return d.status === 'open'
    ? `<div class="card ckcard open"><div><b>צ'ק-אין להיום · ${esc(site.name)}</b><div class="small mut">עד ${new Date(d.due_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}. בלי צ'ק-אין, מבצע הבנייה מקבל התראה קריטית.</div></div><button class="btn" data-checkin="${site.id}">צ'ק-אין עכשיו</button></div>`
    : `<div class="card ckcard done"><b>✓ צ'ק-אין היום</b> <span class="small mut">${esc(c?.person_name || d.done_by || '')} · ${new Date(d.done_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span></div>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-checkin]'); if (b) { e.preventDefault(); checkinForm(b.dataset.checkin); } });
export { ACTIVITIES, h };
