// עבודה בלי קליטה: פעולות נשמרות בטלפון (IndexedDB) ונשלחות לבד כשחוזרת קליטה.
// גם הנתונים האחרונים שנטענו נשמרים, כדי שהמערכת תיפתח במרתף או בקומה בלי רשת.
const DBN = 'tzi-safety-offline';
let _db;
function open() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
      d.createObjectStore('blobs');
      d.createObjectStore('snap');
      d.createObjectStore('failed', { keyPath: 'seq', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return _db;
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const all = store => tx(store, 'readonly', s => s.getAll());

// מצב לתצוגה: כמה פעולות ממתינות ואם יש קליטה
export const net = { pending: 0, failed: 0, offline: !navigator.onLine, syncing: false, snapAt: null };
const emit = (x = {}) => window.dispatchEvent(new CustomEvent('outbox', { detail: { ...net, ...x } }));
export async function refreshCount(x) {
  try { net.pending = (await all('ops')).length; net.failed = (await all('failed')).length; } catch { /* בלי IndexedDB */ }
  emit(x); return net.pending;
}

export const isNetErr = e => !!(e && (e.offline || /Failed to fetch|NetworkError|network|Load failed|fetch failed|abort|timed? ?out/i.test(e.message || '')));
export const looksOffline = () => !navigator.onLine;

export async function queue(op) {
  if (op.kind === 'file') { await tx('blobs', 'readwrite', s => s.put(op.blob, op.path)); op = { kind: 'file', path: op.path, type: op.blob.type || '' }; }
  await tx('ops', 'readwrite', s => s.add({ ...op, at: new Date().toISOString() }));
  net.offline = true; await refreshCount({ queued: true });
}
export const pendingOps = () => all('ops');
export async function localFile(path) { try { return await tx('blobs', 'readonly', s => s.get(path)); } catch { return null; } }
export const failedOps = () => all('failed');
export async function clearFailed() { await tx('failed', 'readwrite', s => s.clear()); await refreshCount(); }

// שליחה לפי הסדר. עוצרים בבעיית רשת; פעולה שהשרת דחה עוברת לרשימת "לא נשלח" כדי לא לחסום את השאר
export async function flush(raw) {
  if (net.syncing) return 0;
  const ops = await pendingOps();
  if (!ops.length) { net.offline = false; emit(); return 0; }
  net.syncing = true; emit();
  let sent = 0;
  try {
    for (const op of ops) {
      try {
        if (op.kind === 'insert') await raw.insert(op.table, op.rows).catch(e => { if (e.code !== '23505') throw e; });
        else if (op.kind === 'update') await raw.update(op.table, op.id, op.patch);
        else if (op.kind === 'file') {
          const blob = await localFile(op.path);
          if (blob) await raw.putFile(op.path, blob).catch(e => { if (!/exists|Duplicate/i.test(e.raw || e.message)) throw e; });
        }
      } catch (e) {
        if (isNetErr(e)) { net.offline = true; break; }
        const { seq, ...rest } = op; await tx('failed', 'readwrite', s => s.add({ ...rest, error: e.message, failed_at: new Date().toISOString() }));
      }
      await tx('ops', 'readwrite', s => s.delete(op.seq));
      if (op.kind === 'file') await tx('blobs', 'readwrite', s => s.delete(op.path)).catch(() => {});
      sent++;
    }
    if (sent === ops.length) net.offline = false;
  } finally { net.syncing = false; await refreshCount(); }
  return sent;
}

// הנתונים האחרונים שנטענו, לכל משתמש בנפרד
export async function saveSnap(email, ctx, data) {
  try { const at = new Date().toISOString(); await tx('snap', 'readwrite', s => s.put({ ctx, data, at }, (email || '').toLowerCase())); net.snapAt = at; } catch (e) { console.warn('snap', e); }
}
export async function loadSnap(email) {
  try { const v = await tx('snap', 'readonly', s => s.get((email || '').toLowerCase())); if (v) net.snapAt = v.at; return v || null; } catch { return null; }
}

// מחילים על הנתונים המקומיים את מה שעוד לא נשלח, כדי שהמסכים יראו אותו
export async function applyPending(data) {
  const ops = await pendingOps().catch(() => []);
  for (const op of ops) {
    const arr = data[op.table];
    if (!arr) continue;
    if (op.kind === 'insert') for (const r of op.rows) { if (!arr.some(x => x.id === r.id)) arr.push({ ...r, _pending: true }); }
    if (op.kind === 'update') { const r = arr.find(x => x.id === op.id); if (r) Object.assign(r, op.patch, { _pending: true }); }
  }
  return data;
}
