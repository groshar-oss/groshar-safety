// ארגונים ומשתמשים (מנהלת השירות): יזמים, קבלנים ראשיים, ומי שייך לכל ארגון
import { db, isCloud } from '../db.js';
import { S, isAdmin, render } from '../app.js';
import { esc, h, $$, toast, modal, field, select } from '../util.js';

const KIND = { developer: 'יזם (מזמין)', contractor: 'קבלן ראשי', consultant: 'יועץ / בקר בטיחות' };

export async function viewOrgs() {
  if (!isAdmin()) return h('<div class="card empty">המסך הזה זמין רק למנהלת השירות</div>');
  const mem = await db.select('memberships', { order: 'email' });
  const sitesOf = id => S.data.site_orgs.filter(x => x.org_id === id).map(x => S.data.sites.find(s => s.id === x.site_id)?.name).filter(Boolean);
  const el = h(`<div><div class="top"><div><h1>ארגונים ומשתמשים</h1><div class="sub">משתמש ששייך לארגון רואה את כל האתרים שהארגון משויך אליהם. בעל תפקיד באתר (בקר, ממונה, מנהל עבודה) רואה את האתר לפי האימייל שלו ברשימת בעלי התפקידים.</div></div>
    <div class="actions"><button class="btn" data-new>ארגון חדש</button></div></div>
    ${!isCloud() ? '<div class="note small">במצב הדגמה אין התחברות אמיתית, ולכן שיוך משתמשים נשמר אבל לא משפיע. ההרשאות פועלות במצב ענן.</div>' : ''}
    <div class="sgrid">${S.data.orgs.map(o => `<div class="card">
      <div class="dh"><h2>${esc(o.name)}</h2><span class="chip">${KIND[o.kind] || o.kind}</span></div>
      <div class="small mut">ח"פ ${esc(o.reg_no || '—')}${sitesOf(o.id).length ? ' · אתרים: ' + esc(sitesOf(o.id).join(', ')) : ''}</div>
      <div class="mlist">${mem.filter(m => m.org_id === o.id).map(m => `<div class="prow"><span dir="ltr">${esc(m.email)}</span><span class="small mut">${m.org_admin ? 'מנהל בארגון' : 'משתמש'}</span><button class="btn small ghost" data-rm="${m.id}">הסרה</button></div>`).join('') || '<div class="small mut">אין משתמשים</div>'}</div>
      <div class="actions"><button class="btn small" data-add="${o.id}">הוספת משתמש</button><button class="btn small ghost" data-edit="${o.id}">עריכה</button></div></div>`).join('') || '<div class="card empty">אין ארגונים</div>'}</div></div>`);
  $$('[data-new]', el).forEach(b => b.onclick = () => orgForm());
  $$('[data-edit]', el).forEach(b => b.onclick = () => orgForm(S.data.orgs.find(o => o.id === b.dataset.edit)));
  $$('[data-add]', el).forEach(b => b.onclick = async () => {
    const v = await modal({ title: 'הוספת משתמש לארגון', ok: 'הוספה',
      body: `${field('אימייל', 'email', '', { type: 'email', req: true, attrs: 'dir="ltr"' })}<label class="chk"><input type="checkbox" name="org_admin"> מנהל בארגון (יכול לנהל אתרים ובעלי תפקידים של הארגון)</label>
        <p class="small mut">המשתמש נרשם למערכת עם האימייל הזה, ומקבל גישה מיד אחרי ההרשמה.</p>`,
      validate: d => /^\S+@\S+\.\S+$/.test(d.email || '') ? (mem.some(m => m.org_id === b.dataset.add && m.email === d.email.trim().toLowerCase()) ? 'המשתמש כבר בארגון' : null) : 'אימייל לא תקין' });
    if (!v) return;
    try { await db.insert('memberships', { org_id: b.dataset.add, email: v.email.trim().toLowerCase(), org_admin: !!v.org_admin }); toast('נוסף'); render(); } catch (e) { toast(e.message, 'bad'); }
  });
  $$('[data-rm]', el).forEach(b => b.onclick = async () => {
    if (!(await modal({ title: 'הסרת משתמש', body: '<p>המשתמש יאבד גישה לאתרים של הארגון. הפעולה נרשמת ביומן.</p>', ok: 'הסרה', danger: true }))) return;
    try { await db.remove('memberships', b.dataset.rm); toast('הוסר'); render(); } catch (e) { toast(e.message, 'bad'); }
  });
  return el;
}

async function orgForm(o = null) {
  const v = await modal({ title: o ? 'עריכת ארגון' : 'ארגון חדש', ok: 'שמירה',
    body: `${field('שם', 'name', o?.name || '', { req: true })}${select('סוג', 'kind', KIND, o?.kind || 'developer')}${field('ח"פ / ע"מ', 'reg_no', o?.reg_no || '', { attrs: 'dir="ltr"' })}
      ${field('מספר קבלן רשום (לקבלן ראשי)', 'contractor_reg', o?.contractor_reg || '', { attrs: 'dir="ltr"' })}`,
    validate: d => d.name?.trim() ? null : 'צריך שם' });
  if (!v) return;
  const row = { name: v.name.trim(), kind: v.kind, reg_no: v.reg_no.trim(), contractor_reg: v.contractor_reg.trim() };
  try {
    if (o) Object.assign(o, await db.update('orgs', o.id, row));
    else S.data.orgs.push(...await db.insert('orgs', row));
    toast('נשמר'); render();
  } catch (e) { toast(e.message, 'bad'); }
}
