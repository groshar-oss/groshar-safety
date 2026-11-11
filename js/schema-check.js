// בדיקת התקנה: מה חסר במסד לעומת מה שהקוד צריך. expected: "טבלה.עמודה" ← קובץ SQL
export function schemaDiff(expected, live) {
  const have = new Set(live.map(r => `${r.table_name}.${r.column_name}`));
  const missing = Object.keys(expected).filter(k => !have.has(k));
  return { missing, files: [...new Set(missing.map(k => expected[k]))].sort() };
}
