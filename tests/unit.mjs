// בדיקות יחידה בלי דפדפן:  node tests/unit.mjs
import assert from 'node:assert/strict';
import { schemaDiff } from '../js/schema-check.js';
import { SCHEMA_EXPECTED } from '../js/schema-expected.js';
import fs from 'node:fs';

const live = Object.keys(SCHEMA_EXPECTED).map(k => ({ table_name: k.split('.')[0], column_name: k.slice(k.indexOf('.') + 1) }));
assert.deepEqual(schemaDiff(SCHEMA_EXPECTED, live), { missing: [], files: [] });
const one = Object.keys(SCHEMA_EXPECTED).find(k => SCHEMA_EXPECTED[k] === '017c-mail.sql');
const r = schemaDiff(SCHEMA_EXPECTED, live.filter(x => `${x.table_name}.${x.column_name}` !== one));
assert.deepEqual(r, { missing: [one], files: ['017c-mail.sql'] });
for (const f of new Set(Object.values(SCHEMA_EXPECTED))) assert.ok(fs.existsSync(new URL(`../supabase/${f}`, import.meta.url)), f);
console.log('ok   schema check (' + Object.keys(SCHEMA_EXPECTED).length + ' columns)');
