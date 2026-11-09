// שכבת נתונים: מצב ענן (Supabase) או מצב הדגמה (נשמר בדפדפן בלבד)
import { CONFIG } from './config.js';
import { store } from './util.js';
import { demoData } from './demo.js';
import { queue, flush, isNetErr, looksOffline, localFile, refreshCount } from './offline.js';

const LOCAL_KEY = 'grosher-safety-demo-v1';
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

const TABLES = ['orgs', 'memberships', 'sites', 'site_orgs', 'site_people', 'duties', 'events', 'notifications', 'files', 'audit_log', 'checkins', 'notices', 'signatures', 'workers', 'trainings', 'training_signatures', 'equipment', 'inspections', 'attendance', 'worker_exemptions', 'site_inspections', 'defects', 'bakar_reports', 'accident_reports'];
const AUDITED = ['orgs', 'memberships', 'sites', 'site_orgs', 'site_people', 'duties', 'events', 'notices', 'workers', 'trainings', 'equipment', 'inspections', 'attendance', 'worker_exemptions', 'site_inspections', 'defects', 'bakar_reports', 'accident_reports'];

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
    if (['duties', 'audit_log', 'notifications', 'notices', 'signatures', 'workers', 'trainings', 'training_signatures', 'equipment', 'inspections', 'attendance', 'worker_exemptions', 'site_inspections', 'defects', 'bakar_reports', 'accident_reports'].includes(table)) throw new Error('אי אפשר למחוק רשומה זו. אפשר לסגור אותה עם נימוק.');
    const row = this.data.tables[table].find(r => r.id === id);
    this.data.tables[table] = this.data.tables[table].filter(r => r.id !== id);
    if (row) this.audit(table, 'delete', row, { ...row });
    this.save();
  }
  async signOut() {}
  async flush() { return 0; }
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
    // קליטה חלשה: בקשה שלא נענית תוך 45 שניות נחשבת כמו בלי קליטה, והפעולה נשמרת בטלפון
    const tfetch = (u, o = {}) => fetch(u, { ...o, signal: o.signal || (AbortSignal.timeout ? AbortSignal.timeout(45e3) : undefined) });
    this.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: true }, global: { fetch: tfetch } });
    this.sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') this.recovery = true; });
    const { data, error } = await this.sb.auth.getSession().catch(e => ({ data: {}, error: e }));
    if (/access_token|type=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
    let u = data?.session?.user;
    // בלי קליטה אי אפשר לחדש את ההתחברות: ממשיכים עם המשתמש השמור בטלפון, והחידוש יקרה כשחוזרת קליטה
    if (!u && (looksOffline() || isNetErr(error))) {
      try { const k = Object.keys(localStorage).find(x => /^sb-.*-auth-token$/.test(x)); u = k ? JSON.parse(localStorage.getItem(k))?.user : null; } catch { u = null; }
    }
    this.user = u ? { id: u.id, email: u.email } : null;
    refreshCount();
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
  // כתיבה: אם אין קליטה, נשמר בטלפון ונשלח אחר כך. מחזירים את השורה כאילו נשמרה
  async insert(table, rows) {
    // מזהה נקבע בטלפון, כדי ששליחה חוזרת אחרי ניתוק לא תיצור כפילות
    const arr = (Array.isArray(rows) ? rows : [rows]).map(r => r.id ? r : { id: uuid(), ...r });
    if (looksOffline()) return this.queueInsert(table, arr);
    try { return await this.rawInsert(table, arr); } catch (e) { if (isNetErr(e)) return this.queueInsert(table, arr); throw e; }
  }
  async queueInsert(table, arr) {
    const now = new Date().toISOString();
    const rows = arr.map(r => ({ id: uuid(), created_at: now, ...r }));
    await queue({ kind: 'insert', table, rows });
    return rows.map(r => ({ ...r, _pending: true }));
  }
  async update(table, id, patch) {
    if (looksOffline()) return this.queueUpdate(table, id, patch);
    try { return await this.rawUpdate(table, id, patch); } catch (e) { if (isNetErr(e)) return this.queueUpdate(table, id, patch); throw e; }
  }
  async queueUpdate(table, id, patch) { await queue({ kind: 'update', table, id, patch }); return { id, ...patch, _pending: true }; }
  async putFile(path, blob) {
    if (looksOffline()) return queue({ kind: 'file', path, blob });
    try { return await this.rawPutFile(path, blob); } catch (e) { if (isNetErr(e)) return queue({ kind: 'file', path, blob }); throw e; }
  }
  async getFile(path) {
    const local = await localFile(path); if (local) return local;
    return this.rawGetFile(path);
  }
  // שליחת מה שנשמר בטלפון
  async flush() { if (!this.user) return 0; return flush({ insert: (t, r) => this.rawInsert(t, r), update: (t, i, p) => this.rawUpdate(t, i, p), putFile: (p, b) => this.rawPutFile(p, b) }); }
  async rawInsert(table, arr) {
    const out = [];
    for (let i = 0; i < arr.length; i += 500) {
      const { data, error } = await this.sb.from(table).insert(arr.slice(i, i + 500), { defaultToNull: false }).select();
      if (error) throw dbErr(error);
      out.push(...data);
    }
    return out;
  }
  async rawUpdate(table, id, patch) {
    const { data, error } = await this.sb.from(table).update(patch).eq('id', id).select().single();
    if (error) throw dbErr(error); return data;
  }
  async remove(table, id) { const { error } = await this.sb.from(table).delete().eq('id', id); if (error) throw dbErr(error); }
  async rawPutFile(path, blob) {
    const { error } = await this.sb.storage.from('files').upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    if (error) throw dbErr(error);
  }
  async rawGetFile(path) {
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
  else if (/^[a-z_0-9]+: .*[א-ת]/.test(m)) he = m.replace(/^[a-z_0-9]+: /, '');
  const e = new Error(he); e.code = error?.code; e.raw = m;
  if (/Failed to fetch|NetworkError|network|Load failed|abort|timed? ?out/i.test(m)) { e.offline = true; e.message = 'אין חיבור לאינטרנט.'; }
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
