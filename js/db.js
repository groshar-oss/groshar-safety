// שכבת נתונים: מצב ענן (Supabase) או מצב הדגמה (נשמר בדפדפן בלבד)
import { CONFIG } from './config.js';
import { store } from './util.js';
import { demoData } from './demo.js';

const LOCAL_KEY = 'grosher-safety-demo-v1';
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

const TABLES = ['orgs', 'memberships', 'sites', 'site_orgs', 'site_people', 'duties', 'events', 'notifications', 'files', 'audit_log', 'checkins'];
const AUDITED = ['orgs', 'memberships', 'sites', 'site_orgs', 'site_people', 'duties', 'events'];

function match(row, q = {}) {
  for (const [k, v] of Object.entries(q.eq || {})) if (String(row[k] ?? '') !== String(v ?? '')) return false;
  for (const [k, arr] of Object.entries(q.in || {})) if (!arr.map(String).includes(String(row[k]))) return false;
  return true;
}
function orderRows(rows, order) {
  if (!order) return rows;
  const keys = Array.isArray(order) ? order : [order];
  return rows.sort((a, b) => {
    for (const k of keys) {
      const [f, dir] = k.split(' ');
      const x = a[f] ?? '', y = b[f] ?? '';
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'he', { numeric: true });
      if (c) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

// ===== מצב הדגמה =====
class LocalDB {
  constructor() { this.mode = 'demo'; }
  async init() {
    this.data = store(LOCAL_KEY);
    if (!this.data || !this.data.tables) this.reset();
    for (const t of TABLES) this.data.tables[t] ||= [];
    this.data.role ||= 'admin';
    this.user = { id: 'demo-user', email: 'demo@grosher.local' };
    return this.user;
  }
  reset() { this.data = { tables: demoData(uuid), role: this.data?.role || 'admin' }; this.save(); }
  save() { store(LOCAL_KEY, this.data); }
  get role() { return this.data.role; }
  setRole(r) { this.data.role = r; this.save(); }
  async context() { return { isAdmin: this.data.role === 'admin', demoRole: this.data.role, memberships: [] }; }
  audit(table, action, row, old) {
    if (!AUDITED.includes(table)) return;
    this.data.tables.audit_log.push({ id: uuid(), at: new Date().toISOString(), user_email: window.__actor || 'demo', table_name: table, row_id: row.id,
      site_id: row.site_id || (table === 'sites' ? row.id : null), action, old_data: old || null, new_data: action === 'delete' ? null : { ...row } });
  }
  async select(table, q = {}) {
    const rows = (this.data.tables[table] || []).filter(r => match(r, q)).map(r => ({ ...r }));
    return orderRows(rows, q.order);
  }
  async insert(table, rows) {
    const arr = (Array.isArray(rows) ? rows : [rows]).map(r => ({ id: uuid(), created_at: new Date().toISOString(), ...r }));
    this.data.tables[table].push(...arr);
    arr.forEach(r => this.audit(table, 'insert', r));
    this.save();
    return arr.map(r => ({ ...r }));
  }
  async update(table, id, patch) {
    const row = this.data.tables[table].find(r => r.id === id);
    if (!row) throw new Error('הרשומה לא נמצאה');
    const old = { ...row };
    Object.assign(row, patch); this.audit(table, 'update', row, old); this.save(); return { ...row };
  }
  async remove(table, id) {
    if (table === 'duties' || table === 'audit_log' || table === 'notifications') throw new Error('אי אפשר למחוק רשומה זו. אפשר לסגור אותה עם נימוק.');
    const row = this.data.tables[table].find(r => r.id === id);
    this.data.tables[table] = this.data.tables[table].filter(r => r.id !== id);
    if (row) this.audit(table, 'delete', row, { ...row });
    this.save();
  }
  async signOut() {}
}

// קבצים במצב הדגמה: IndexedDB בדפדפן
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open('grosher-safety-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbDo(mode, fn) { const d = await idb(); return new Promise((res, rej) => { const tx = d.transaction('f', mode); const r = fn(tx.objectStore('f')); tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error); }); }
LocalDB.prototype.putFile = async function (path, blob) { await idbDo('readwrite', s => s.put(blob, path)); };
LocalDB.prototype.getFile = async function (path) { const b = await idbDo('readonly', s => s.get(path)); if (!b) throw new Error('הקובץ לא נמצא בדפדפן הזה'); return b; };

// ===== מצב ענן =====
class CloudDB {
  constructor() { this.mode = 'cloud'; }
  async init() {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    this.recovery = /type=recovery/.test(location.hash);
    this.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: true } });
    this.sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') this.recovery = true; });
    const { data } = await this.sb.auth.getSession();
    if (/access_token|type=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
    this.user = data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null;
    return this.user;
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(heAuthError(error.message));
    this.user = { id: data.user.id, email: data.user.email }; return this.user;
  }
  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } });
    if (error) throw new Error(heAuthError(error.message));
    return data.session ? 'signed_in' : 'confirm_email';
  }
  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    if (error) throw new Error(heAuthError(error.message));
  }
  async setPassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(heAuthError(error.message));
    this.recovery = false;
  }
  async signOut() { await this.sb.auth.signOut(); this.user = null; }
  async context() {
    const isAdmin = !!(await this.rpc('claim_service_admin', {}));
    const memberships = await this.select('memberships', { eq: { email: (this.user.email || '').toLowerCase() } });
    return { isAdmin, memberships };
  }
  q(table, q = {}) {
    let s = this.sb.from(table).select('*');
    for (const [k, v] of Object.entries(q.eq || {})) s = v === null ? s.is(k, null) : s.eq(k, v);
    for (const [k, arr] of Object.entries(q.in || {})) s = s.in(k, arr);
    for (const o of [].concat(q.order || [])) { const [f, dir] = o.split(' '); s = s.order(f, { ascending: dir !== 'desc' }); }
    return s;
  }
  async select(table, q = {}) {
    const all = []; let from = 0;
    for (;;) {
      const { data, error } = await this.q(table, q).range(from, from + 999);
      if (error) throw dbErr(error);
      all.push(...data); if (data.length < 1000) break; from += 1000;
    }
    return all;
  }
  async insert(table, rows) {
    const arr = Array.isArray(rows) ? rows : [rows];
    const out = [];
    for (let i = 0; i < arr.length; i += 500) {
      const { data, error } = await this.sb.from(table).insert(arr.slice(i, i + 500), { defaultToNull: false }).select();
      if (error) throw dbErr(error);
      out.push(...data);
    }
    return out;
  }
  async update(table, id, patch) {
    const { data, error } = await this.sb.from(table).update(patch).eq('id', id).select().single();
    if (error) throw dbErr(error); return data;
  }
  async remove(table, id) { const { error } = await this.sb.from(table).delete().eq('id', id); if (error) throw dbErr(error); }
  async putFile(path, blob) {
    const { error } = await this.sb.storage.from('files').upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    if (error) throw dbErr(error);
  }
  async getFile(path) {
    const { data, error } = await this.sb.storage.from('files').download(path);
    if (error) throw dbErr(error); return data;
  }
  async rpc(name, args) {
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw dbErr(error); return data;
  }
}

export function dbErr(error) {
  const m = error?.message || String(error);
  let he = m;
  if (error?.code === '23503') he = 'אי אפשר למחוק: יש רשומות אחרות שקשורות לזה.';
  else if (error?.code === 'PGRST116' || error?.code === '42501' || /row-level security|permission denied/i.test(m)) he = 'אין לך הרשאה לפעולה הזו.';
  else if (error?.code === '23505') he = 'הרשומה כבר קיימת.';
  else if (/role_conflict/.test(m)) he = 'אי אפשר למנות את אותו אדם לשני התפקידים האלה באותו אתר (תקנות 2א(א)(2), 2ב(א)(2)).';
  else if (/no_delete/.test(m)) he = 'אי אפשר למחוק רשומה זו. אפשר לסגור אותה עם נימוק.';
  const e = new Error(he);
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) { e.offline = true; e.message = 'אין חיבור לאינטרנט.'; }
  return e;
}

function heAuthError(m) {
  if (/Invalid login/i.test(m)) return 'אימייל או סיסמה שגויים';
  if (/Email not confirmed/i.test(m)) return 'צריך לאשר את האימייל (קישור נשלח לתיבת הדואר)';
  if (/already registered/i.test(m)) return 'האימייל כבר רשום. אפשר להתחבר.';
  if (/Password should be/i.test(m)) return 'הסיסמה קצרה מדי (לפחות 6 תווים)';
  return m;
}

export const isCloud = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
export const db = isCloud() ? new CloudDB() : new LocalDB();
