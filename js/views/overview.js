// מבט על כל האתרים: שורה לכל אתר עם מה שחשוב היום. האתר הבעייתי ביותר למעלה
import { S, visibleSites, myRoles } from '../app.js';
import { exceptions } from '../alerts.js';
import { esc, h } from '../util.js';
import { compliance } from './common.js';
import { checkinsFor } from './checkin.js';
import { canSeeWorkers } from './workers.js';
import { workersOf, workerStatus, equipmentOf, lastInspection, israelDay, headcount } from '../workers.js';
import { defectSummary } from './defects.js';
import { statusName } from './home.js';

export function siteRow(s) {
  const ex = exceptions(S.data, [s]);
  const c = compliance(s.id);
  const sees = canSeeWorkers(s.id);
  const ws = sees ? workersOf(s.id).filter(w => w.active !== false) : [];
  const blocked = ws.filter(w => workerStatus(w).lv === 'bad').length;
  const hc = headcount(s);
  const today = israelDay();
  const checked = checkinsFor(s.id).some(x => israelDay(new Date(x.at)) === today);
  const active = s.status === 'active';
  const month = Date.now() + 30 * 864e5;
  const eq = equipmentOf(s.id).filter(e => e.active !== false).filter(e => { const li = lastInspection(e.id); return !li || new Date(li.next_due + 'T23:59:59') < month; }).length;
  const d = defectSummary(s.id);
  const crit = ex.filter(x => x.level === 'crit').length, red = ex.filter(x => x.level === 'red').length;
  const score = crit * 100 + red * 10 + blocked * 20 + d.late * 15 + (active && !checked ? 50 : 0) + eq * 5;
  return { s, ex, c, crit, red, blocked, hc, checked, active, eq, d, sees, score };
}

export function viewOverview() {
  const rows = visibleSites().filter(s => !['done', 'closed_order'].includes(s.status)).map(siteRow).sort((a, b) => b.score - a.score);
  const sum = k => rows.reduce((t, r) => t + r[k], 0);
  const chip = (n, cls, label) => n ? `<span class="chip ${cls}">${n} ${label}</span>` : '';
  return h(`<div>
    <div class="top"><div><h1>מבט על כל האתרים</h1><div class="sub">${rows.length} אתרים פעילים · ${sum('crit')} קריטי · ${sum('red')} חריגות</div></div></div>
    <div class="ovgrid">${rows.map(r => `<a class="card ovsite ${r.crit ? 'lv-bad' : ''}" href="#/site/${r.s.id}">
      <div class="dh"><b>${esc(r.s.name)}</b><span class="chip">${esc(statusName(r.s.status))}</span></div>
      <div class="ovk"><div><span>עמידה</span><b class="${r.c.pct < 70 ? 'neg' : ''}">${r.c.pct}%</b></div><div><span>קריטי</span><b class="${r.crit ? 'neg' : ''}">${r.crit}</b></div>
        <div><span>חריגות</span><b class="${r.red ? 'neg' : ''}">${r.red}</b></div>${r.sees ? `<div><span>באתר היום</span><b>${r.hc.present}${r.hc.max ? '/' + r.hc.max : ''}</b></div>` : ''}</div>
      <div class="ovchips">${r.active ? (r.checked ? '<span class="chip green">צ׳ק-אין בוצע היום</span>' : '<span class="chip red">אין צ׳ק-אין היום</span>') : ''}
        ${chip(r.blocked, 'red', 'אסור להעסיק')}${chip(r.d.late, 'red', 'ליקויים באיחור')}${chip(r.d.open - r.d.late, 'amber', 'ליקויים פתוחים')}${chip(r.eq, 'amber', 'תסקירים פגים החודש')}${r.hc.msgs.length ? '<span class="chip amber">מספר עובדים מעל הפרופיל</span>' : ''}</div>
    </a>`).join('') || '<div class="card empty">אין אתרים פעילים</div>'}</div></div>`);
}
export const showOverview = () => visibleSites().length > 1 && visibleSites().some(s => myRoles(s.id).some(r => ['admin', 'dev', 'con', 'so', 'sm', 'bakar'].includes(r)));
