// מעטפת המערכת: התחברות, הרשאות, טעינת נתונים, ניווט
import { db, isCloud } from './db.js';
import { CONFIG } from './config.js';
import { esc, h, $, $$, toast, store, modal, field } from './util.js';
import { sync, ROLES, SIDE_OF, responsibleRoles, level } from './duties.js';
import { exceptions, autoEmail } from './alerts.js';
import { viewHome } from './views/home.js';
import { viewSites, viewNewSite } from './views/sites.js';
import { viewSite } from './views/site.js';
import { viewAlerts } from './views/alerts.js';
import { viewOrgs } from './views/orgs.js';
import { viewSettings } from './views/settings.js';

export const S = { user: null, ctx: null, data: null };

const DEMO_ROLES = { admin: 'מנהלת שירות (גרושר)', dev: ROLES.dev, bakar: ROLES.bakar, con: ROLES.con, so: ROLES.so, sm: ROLES.sm, wm: ROLES.wm, rep: 'נציג מבצע הבנייה באתר' };

// ===== הרשאות =====
// תפקידי המשתמש באתר: מנהלת שירות רואה הכול; במצב הדגמה לפי "צפייה בתור"; בענן לפי ארגון ושיוך אישי לאתר
export function myRoles(siteId) {
  if (S.ctx.isAdmin) return ['admin'];
  if (S.ctx.demoRole) return [S.ctx.demoRole];
  const out = new Set();
  const so = S.data.site_orgs.filter(x => x.site_id === siteId);
  for (const m of S.ctx.memberships) {
    const link = so.find(x => x.org_id === m.org_id);
    if (link) out.add(link.kind === 'developer' ? 'dev' : link.kind === 'contractor' ? 'con' : 'sub');
  }
  const me = (S.user.email || '').toLowerCase();
  S.data.site_people.filter(p => p.site_id === siteId && p.active !== false && (p.email || '').toLowerCase() === me).forEach(p => out.add(p.role));
  return [...out];
}
export const isAdmin = () => !!S.ctx.isAdmin;
export const hasRole = (siteId, ...r) => { const m = myRoles(siteId); return m.includes('admin') || r.some(x => m.includes(x)); };
export const sideOf = siteId => { const m = myRoles(siteId); if (m.includes('admin')) return 'all'; return m.some(r => SIDE_OF[r] === 'dev') ? 'dev' : 'con'; };

// מי רשאי לסמן חובה כבוצעה: האחראי בפועל, הנהלת הקבלן לחובות צד הקבלן, ומנהלת השירות
export function canAct(i) {
  const site = S.data.sites.find(s => s.id === i.site_id); if (!site) return false;
  const m = myRoles(site.id);
  if (m.includes('admin')) return true;
  const { roles } = responsibleRoles(i, site, S.data.site_people);
  if (roles.some(r => m.includes(r))) return true;
  if (i.side === 'con' && m.includes('con')) return true;
  return false;
}
// סגירה בלי ביצוע (לא חל / דחייה מוצדקת): רק הנהלת הצד האחראי
export const canWaive = i => hasRole(i.site_id, i.side === 'dev' ? 'dev' : 'con');
export const canEditSite = siteId => hasRole(siteId, 'dev', 'con');

// ===== נתונים =====
export async function loadAll() {
  const [orgs, sites, site_orgs, site_people, duties, events, notifications, checkins] = await Promise.all(
    ['orgs', 'sites', 'site_orgs', 'site_people', 'duties', 'events', 'notifications', 'checkins'].map(t => db.select(t, { order: 'created_at' })));
  S.data = { orgs, sites, site_orgs, site_people, duties, events, notifications, checkins };
  // סנכרון החובות מול הפרופיל של כל אתר (חובה חוזרת שבוצעה פותחת את הבאה)
  for (const s of sites) await syncSite(s, false);
  return S.data;
}
export async function syncSite(site, reload = true) {
  const cur = S.data.duties.filter(d => d.site_id === site.id);
  const { add, upd } = sync(site, cur);
  if (!add.length && !upd.length) return false;
  if (!hasRole(site.id, 'dev', 'con', 'bakar', 'so', 'sm', 'wm', 'rep')) return false;
  try {
    for (const u of upd) { const { id, ...p } = u; const r = await db.update('duties', id, p); Object.assign(S.data.duties.find(d => d.id === id), r); }
    if (add.length) S.data.duties.push(...await db.insert('duties', add));
  } catch (e) { console.warn('sync', e); }
  if (reload) render();
  return true;
}
export const siteById = id => S.data.sites.find(s => s.id === id);
export const visibleSites = () => S.data.sites.filter(s => isAdmin() || myRoles(s.id).length);
export const orgName = id => S.data.orgs.find(o => o.id === id)?.name || '';
export const siteOrgs = (siteId, kind) => S.data.site_orgs.filter(x => x.site_id === siteId && (!kind || x.kind === kind)).map(x => S.data.orgs.find(o => o.id === x.org_id)).filter(Boolean);

// ===== ניווט =====
const NAV = () => [
  ['#/', '◧', 'מה דורש טיפול'],
  ['#/alerts', '🔔', 'התראות וחריגות', 'alerts'],
  ['#/sites', '▤', 'אתרים'],
  ...(isAdmin() ? [['#/orgs', '◎', 'ארגונים ומשתמשים']] : []),
  ['#/settings', '☼', 'הגדרות ותצוגה']
];
const isOn = (href, hash) => hash === href || (href !== '#/' && hash.startsWith(href + '/'));

function shell(content, title) {
  const hash = location.hash || '#/';
  const ex = exceptions(S.data, visibleSites());
  const nCrit = ex.filter(x => x.level === 'crit').length, nRed = ex.filter(x => x.level === 'red').length;
  const badge = nCrit + nRed ? `<span class="badge red">${nCrit + nRed}</span>` : '';
  const root = h(`<div class="app">
    <div class="mobile-top"><button id="mnav" aria-label="תפריט">☰</button><b>${esc(title || CONFIG.appName)}</b><a href="#/alerts" class="bell" aria-label="התראות">🔔${badge}</a></div>
    <aside class="side" id="side">
      <div class="brand"><img src="icons/logo-neg.png" alt=""><div><b>גרושר פרויקטים</b><span>ניהול בטיחות באתר</span></div></div>
      <nav class="nav">${NAV().map(([href, ico, label, k]) => `<a href="${href}" class="${isOn(href, hash) ? 'on' : ''}"><span class="ico">${ico}</span>${label}${k === 'alerts' ? badge : ''}</a>`).join('')}</nav>
      <div class="side-foot">${esc(S.user?.email || '')}<br>${esc(isAdmin() ? 'מנהלת שירות' : S.ctx.demoRole ? DEMO_ROLES[S.ctx.demoRole] : '')}${isCloud() ? ' · <button id="logout">יציאה</button>' : ''}</div>
    </aside>
    <main class="main" id="main"></main></div>`);
  if (!isCloud()) {
    $('#main', root).appendChild(h(`<div class="demo-bar"><b>מצב הדגמה.</b> הנתונים נשמרים רק בדפדפן הזה.
      <label>צפייה בתור: <select id="demoRole">${Object.entries(DEMO_ROLES).map(([k, v]) => `<option value="${k}" ${db.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <button class="btn small ghost" id="demoReset">איפוס נתוני הדמו</button></div>`));
  }
  $('#main', root).appendChild(content);
  return root;
}

function wireShell() {
  $('#mnav')?.addEventListener('click', () => $('#side').classList.toggle('open'));
  $$('#side a').forEach(a => a.addEventListener('click', () => $('#side').classList.remove('open')));
  $('#logout')?.addEventListener('click', async () => { await db.signOut(); location.reload(); });
  $('#demoRole')?.addEventListener('change', async e => { db.setRole(e.target.value); await boot(); });
  $('#demoReset')?.addEventListener('click', async () => {
    if (!(await modal({ title: 'איפוס נתוני הדמו', body: '<p>כל השינויים שעשית במצב הדגמה יימחקו ונתוני הדמו יחזרו למצב ההתחלתי.</p>', ok: 'איפוס', danger: true }))) return;
    db.reset(); await boot(); toast('נתוני הדמו אופסו');
  });
}

let seq = 0;
export async function render() {
  const my = ++seq;
  const root = $('#root');
  if (!S.user) return renderLogin();
  if (!isAdmin() && !visibleSites().length && isCloud()) {
    root.replaceChildren(h(`<div class="login"><div class="box"><h2>עדיין אין לך גישה לאתר</h2><p class="mut">המשתמש ${esc(S.user.email)} רשום, אבל עוד לא שויך לארגון או לאתר. מנהלת השירות או נציג הארגון צריכים להוסיף אותו.</p><button class="btn" id="lo">יציאה</button></div></div>`));
    $('#lo').onclick = async () => { await db.signOut(); location.reload(); };
    return;
  }
  const [, route, a, b, c, d] = (location.hash || '#/').split('/');
  let view, title;
  try {
    if (!route) { view = viewHome(); title = 'מה דורש טיפול'; }
    else if (route === 'alerts') { view = viewAlerts(); title = 'התראות וחריגות'; }
    else if (route === 'sites') { view = viewSites(); title = 'אתרים'; }
    else if (route === 'new-site') { view = viewNewSite(a); title = a ? 'פרופיל משפטי' : 'אתר חדש'; }
    else if (route === 'site') { view = viewSite(a, b || 'overview', c, d); title = siteById(a)?.name || 'אתר'; }
    else if (route === 'orgs') { view = await viewOrgs(); title = 'ארגונים ומשתמשים'; }
    else if (route === 'settings') { view = viewSettings(); title = 'הגדרות ותצוגה'; }
    else view = h('<div class="empty">הדף לא נמצא</div>');
  } catch (e) { console.error(e); view = h(`<div class="card"><h2>משהו השתבש</h2><p class="neg">${esc(e.message)}</p></div>`); }
  if (my !== seq) return;
  root.replaceChildren(shell(view, title));
  wireShell();
  view.dispatchEvent(new Event('mounted'));
}

function renderLogin() {
  const el = h(`<div class="login"><div class="box">
    <div class="logo"><img src="icons/logo-neg.png" alt=""><div><b>גרושר פרויקטים</b><div class="mut small">ניהול בטיחות באתר בנייה</div></div></div>
    <form id="lf">${field('אימייל', 'email', '', { type: 'email', req: true, attrs: 'autocomplete="username" dir="ltr"' })}
    ${field('סיסמה', 'password', '', { type: 'password', req: true, attrs: 'autocomplete="current-password" dir="ltr"' })}
    <div class="err" id="lerr" hidden></div>
    <div class="actions"><button class="btn" type="submit">כניסה</button><button class="btn ghost" type="button" id="signup">הרשמה</button><button class="btn link" type="button" id="forgot">שכחתי סיסמה</button></div></form></div></div>`);
  $('#root').replaceChildren(el);
  const err = m => { const e = $('#lerr'); e.textContent = m; e.hidden = !m; };
  const vals = () => ({ email: $('[name=email]').value.trim(), password: $('[name=password]').value });
  $('#lf').onsubmit = async e => { e.preventDefault(); err(''); try { await db.signIn(vals().email, vals().password); await boot(); } catch (x) { err(x.message); } };
  $('#signup').onclick = async () => {
    err(''); const v = vals(); if (!v.email || v.password.length < 8) return err('אימייל וסיסמה של 8 תווים לפחות');
    try { const r = await db.signUp(v.email, v.password); if (r === 'signed_in') await boot(); else err('נשלח אימייל לאישור. אחרי האישור אפשר להיכנס.'); } catch (x) { err(x.message); }
  };
  $('#forgot').onclick = async () => { err(''); const v = vals(); if (!v.email) return err('כתבי את האימייל ואז לחצי שוב'); try { await db.resetPassword(v.email); err('נשלח קישור לאיפוס סיסמה'); } catch (x) { err(x.message); } };
}

async function newPassword() {
  await modal({ title: 'בחירת סיסמה חדשה', ok: 'שמירה', cancel: null,
    body: field('סיסמה חדשה (8 תווים לפחות)', 'pw', '', { type: 'password', req: true, attrs: 'autocomplete="new-password" dir="ltr"' }),
    validate: async d => { if ((d.pw || '').length < 8) return 'הסיסמה קצרה מדי'; try { await db.setPassword(d.pw); } catch (e) { return e.message; } return null; } });
  toast('הסיסמה עודכנה');
}

export async function boot() {
  try {
    S.user = await db.init();
    if (!S.user) return render();
    if (db.recovery) await newPassword();
    S.ctx = await db.context();
    window.__actor = S.ctx.demoRole ? DEMO_ROLES[S.ctx.demoRole] : S.user.email;
    await loadAll();
  } catch (e) {
    console.error(e);
    $('#root').replaceChildren(h(`<div class="login"><div class="box"><h2>לא הצלחנו להתחבר</h2><p class="neg">${esc(e.message)}</p><p class="mut small">בדקי את הכתובת והמפתח ב-config.js ואת החיבור לאינטרנט.</p></div></div>`));
    return;
  }
  await render();
  autoEmail().catch(e => console.warn('email', e));
}

export { level };
const theme = store('safety-theme'); if (theme) document.documentElement.dataset.theme = theme;
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
// רענון כל 5 דקות כדי שהשעונים וההתראות יתעדכנו גם כשהמסך פתוח
setInterval(() => { if (S.user && !document.querySelector('.ov')) render(); }, 5 * 60e3);
boot();
