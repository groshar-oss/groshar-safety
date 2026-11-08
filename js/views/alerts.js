// מסך התראות וחריגות: כל החריגות הפתוחות, סינון, ושליחה ב-WhatsApp / מייל מכל כרטיס
import { S, visibleSites, myRoles, isAdmin } from '../app.js';
import { exceptions, notifsFor } from '../alerts.js';
import { LEVELS, ROLES } from '../duties.js';
import { esc, h, $, $$, select } from '../util.js';
import { chip, sideName, sendBlock, wireSend, fmtDT } from './common.js';
import { leftText } from '../duties.js';

export function viewAlerts() {
  const sites = visibleSites();
  const st = { site: '', level: '', side: '', mine: isAdmin() ? '' : '1' };
  const el = h(`<div><div class="top"><div><h1>התראות וחריגות</h1><div class="sub">חובה שעבר מועדה, או שמועדה מתקרב. החריגה נסגרת רק כשהחובה מבוצעת עם ראיה, או נסגרת עם נימוק.</div></div></div>
    <div class="card filters">
      ${select('אתר', 'site', { '': 'כל האתרים', ...Object.fromEntries(sites.map(s => [s.id, s.name])) }, st.site)}
      ${select('רמה', 'level', { '': 'כל הרמות', crit: LEVELS.crit.label, red: LEVELS.red.label, warn: LEVELS.warn.label, info: LEVELS.info.label }, st.level)}
      ${select('צד', 'side', { '': 'שני הצדדים', dev: 'צד היזם', con: 'צד הקבלן' }, st.side)}
      ${select('אחריות', 'mine', { '1': 'באחריותי', '': 'הכול' }, st.mine)}
    </div>
    <div class="legend small">${[['crit', 'חובה קריטית שעבר מועדה, או אירוע חמור פתוח'], ['red', 'המועד עבר'], ['warn', 'המועד מתקרב'], ['info', 'תזכורת']].map(([l, t]) => `<span>${chip(l)} ${t}</span>`).join('')}</div>
    <div id="xl"></div></div>`);
  const draw = () => {
    let ex = exceptions(S.data, sites);
    if (st.site) ex = ex.filter(x => x.site.id === st.site);
    if (st.level) ex = ex.filter(x => x.level === st.level);
    if (st.side) ex = ex.filter(x => x.duty.side === st.side);
    if (st.mine) ex = ex.filter(x => x.roles.some(r => myRoles(x.site.id).includes(r)) || myRoles(x.site.id).includes('admin'));
    const box = $('#xl', el);
    box.innerHTML = ex.length ? ex.map((x, n) => {
      const last = notifsFor(x.duty.id)[0];
      return `<div class="card xcard lv-${x.level}" data-n="${n}">
        <div class="dh">${chip(x.level)}${x.duty.critical ? '<span class="chip red">חובה קריטית</span>' : ''}<span class="chip">${sideName(x.duty.side)}</span><span class="chip violet">${esc(x.site.name)}</span></div>
        <a class="dt" href="#/site/${x.site.id}/duties/${x.duty.id}">${esc(x.duty.title)}</a>
        <div class="dm">${esc(leftText(x.duty))}${x.duty.due_at ? ' · ' + fmtDT(x.duty.due_at) : ''} · אחראי: ${esc(x.roles.map(r => ROLES[r]).join(', '))}${x.to.length ? ' (' + esc(x.to.map(p => p.name).join(', ')) + ')' : ''}</div>
        ${x.cc.length ? `<div class="small mut">לידיעה: ${esc(x.cc.map(p => p.name).join(', '))}</div>` : ''}
        ${x.note ? `<div class="dn">${esc(x.note)}</div>` : ''}
        <div class="small mut">§ ${esc(x.duty.ref)}</div>
        ${last ? `<div class="small ok-t">נשלח לאחרונה: ${fmtDT(last.sent_at)} · ${last.channel === 'whatsapp' ? 'WhatsApp' : 'מייל'} · ${esc(last.recipient_name)}</div>` : ''}
        <details><summary>שליחה ב-WhatsApp / מייל</summary>${sendBlock(x)}</details></div>`;
    }).join('') : '<div class="card empty">אין התראות פתוחות שמתאימות לסינון 👍</div>';
    $$('.xcard', box).forEach(c => wireSend(c, ex[+c.dataset.n]));
  };
  $$('.filters select', el).forEach(i => i.addEventListener('change', () => { st[i.name] = i.value; draw(); }));
  draw();
  return el;
}
