#!/usr/bin/env bash
# מפיק את js/schema-expected.js: כל עמודה במסד וקובץ ה-SQL (supabase/0*.sql, לפי הסדר) שהוסיף אותה.
# להריץ אחרי כל קובץ SQL חדש (דורש Postgres מקומי: PGHOST/PGPORT).
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-55432} -U postgres -v ON_ERROR_STOP=1 -q"
DB=safety_schema_gen
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d $DB -f tests/sql/stub.sql >/dev/null
$PSQL -d $DB -c "create table _seen(k text primary key, f text not null)"
COLS="select c.table_name||'.'||c.column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema='public' and t.table_type='BASE TABLE' and c.table_name <> '_seen'"
for f in supabase/0*.sql; do
  sed -E '/create extension if not exists pg_(cron|net)/d' "$f" | PGOPTIONS="-c client_min_messages=warning" $PSQL -d $DB >/dev/null
  $PSQL -d $DB -c "insert into _seen select k, '$(basename "$f")' from ($COLS) x(k) on conflict do nothing"
done
{
  echo "// נוצר אוטומטית ע\"י scripts/gen-schema-expected.sh. לא לערוך ידנית."
  echo "// \"טבלה.עמודה\" ← קובץ ה-SQL שמוסיף אותה (בדיקת התקנה במסך הגדרות ותצוגה)"
  printf "export const SCHEMA_EXPECTED = "
  $PSQL -d $DB -At -c "select json_object_agg(k, f order by k) from _seen"
  echo ";"
} > js/schema-expected.js
$PSQL -d postgres -c "drop database $DB"
echo "js/schema-expected.js מוכן"
