// עזרי תצוגה: פורמט מספרים, DOM, חלונות והודעות
import { n } from './calc.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ₪ עם הפרדת אלפים, בלי אגורות (מחיר יחידה מתחת ל-10 עם 2 ספרות)
export function money(v, { unit = false, sign = false, sym = true } = {}) {
  const x = n(v);
  const dec = unit && Math.abs(x) < 10 && x % 1 !== 0 ? 2 : 0;
  const s = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const pre = x < 0 ? '−' : (sign && x > 0 ? '+' : '');
  return `<span class="num" dir="ltr">${pre}${sym ? '₪' : ''}${s}</span>`;
}
export const num = (v, d = 2) => {
  const x = n(v);
  return `<span class="num" dir="ltr">${x.toLocaleString('en-US', { maximumFractionDigits: d })}</span>`;
};
export const pct = (v, { sign = false, d = 1 } = {}) => {
  const x = n(v);
  const pre = x < 0 ? '−' : (sign && x > 0 ? '+' : '');
  return `<span class="num" dir="ltr">${pre}${Math.abs(x).toFixed(d)}%</span>`;
};
export const plainMoney = v => '₪' + Math.round(n(v)).toLocaleString('en-US');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function toast(msg, kind = 'ok') {
  const el = h(`<div class="toast ${kind}" role="status">${esc(msg)}</div>`);
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

// חלון: מחזיר Promise עם ערכי הטופס או null בביטול
export function modal({ title, body, ok = 'שמירה', cancel = 'ביטול', wide = false, onMount, validate, danger = false }) {
  return new Promise(resolve => {
    const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg ${wide ? 'wide' : ''}">
      <div class="dlg-h"><h3>${esc(title)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
      <form class="dlg-b" novalidate>${body}<div class="err" hidden></div></form>
      <div class="dlg-f">${cancel ? `<button class="btn ghost" data-x>${esc(cancel)}</button>` : ''}${ok ? `<button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button>` : ''}</div></div></div>`);
    document.body.appendChild(el);
    const form = $('form', el);
    const close = v => { el.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    $$('[data-x]', el).forEach(b => b.onclick = e => { e.preventDefault(); close(null); });
    const submit = async e => {
      e?.preventDefault();
      const data = formData(form);
      const err = validate ? await validate(data, form) : null;
      if (err) { const box = $('.err', el); box.textContent = err; box.hidden = false; return; }
      close(data);
    };
    const okBtn = $('[data-ok]', el); if (okBtn) okBtn.onclick = submit;
    form.onsubmit = submit;
    onMount?.(el, close);
    setTimeout(() => $('input:not([type=hidden]):not([readonly]),select,textarea', form)?.focus(), 30);
  });
}

export const confirmBox = (title, text, ok = 'אישור', danger = false) => modal({ title, body: `<p>${esc(text)}</p>`, ok, danger }).then(v => v !== null);

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

export const field = (label, name, value = '', { type = 'text', req = false, attrs = '', hint = '' } = {}) =>
  `<label class="fld"><span>${esc(label)}${req ? ' <b class="req">*</b>' : ''}</span>
   <input name="${name}" type="${type}" value="${esc(value ?? '')}" ${type === 'number' ? 'step="any" inputmode="decimal" dir="ltr"' : ''} ${attrs}>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
export const select = (label, name, opts, value = '', { attrs = '' } = {}) =>
  `<label class="fld"><span>${esc(label)}</span><select name="${name}" ${attrs}>${Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}" ${String(k) === String(value ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
export const area = (label, name, value = '') => `<label class="fld"><span>${esc(label)}</span><textarea name="${name}" rows="3">${esc(value ?? '')}</textarea></label>`;

export const fmtDate = d => d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
export const nullIfEmpty = v => (v === '' || v === undefined) ? null : v;
export const numOrNull = v => (v === '' || v === null || v === undefined) ? null : n(v);

export function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch { return null; }
}

// ===== שדה קובץ עם מצלמה: כפתור "צילום" שפותח את המצלמה ישר, וכפתור "קובץ" לבחירה מהגלריה או מהמחשב =====
// הקובץ נשמר בשדה אחד (name), כך שהטופס קורא אותו כרגיל: form.elements[name].files[0]
export const fileField = (label, name, { req = false, accept = 'image/*,application/pdf', note = '' } = {}) =>
  `<div class="fld ff" data-ff><span>${label}${req ? ' <b class="req">*</b>' : ''}</span>
    <div class="ffb"><button type="button" class="btn ffcam" data-cam>📷 צילום</button><label class="btn ghost ffpick">📎 קובץ<input type="file" name="${name}" accept="${accept}" class="ffin"></label></div>
    <div class="ffname small mut">${note || 'לא נבחר קובץ'}</div></div>`;
if (typeof document !== 'undefined' && !window.__ffWired) {
  window.__ffWired = true;
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-cam]'); if (!b) return;
    const real = b.closest('[data-ff]')?.querySelector('input[type=file]'); if (!real) return;
    const t = document.createElement('input'); t.type = 'file'; t.accept = 'image/*'; t.setAttribute('capture', 'environment'); t.style.display = 'none';
    t.onchange = () => { if (t.files?.[0]) { try { real.files = t.files; } catch { /* דפדפן ישן */ } real.dispatchEvent(new Event('change', { bubbles: true })); } t.remove(); };
    document.body.appendChild(t); t.click();
  });
  document.addEventListener('change', e => {
    const i = e.target; if (!i.matches?.('[data-ff] input[type=file]')) return;
    const f = i.files?.[0], n = i.closest('[data-ff]').querySelector('.ffname');
    if (n) { n.textContent = f ? '✓ ' + (f.name || 'צילום') : 'לא נבחר קובץ'; n.classList.toggle('ok-t', !!f); }
  });
}
