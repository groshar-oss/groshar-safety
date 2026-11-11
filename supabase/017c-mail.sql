-- חבילה 1.7 שלב ג: מיילים מהשרת (התראה קריטית מיידית, סיכום בוקר, דוח שבועי ליזם) דרך Resend, וגיבוי חודשי
-- להריץ פעם אחת ב-SQL Editor. בטוח להריץ שוב. השליחה עצמה מתחילה רק כשמפעילים (enabled = true)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ===== 1. הגדרות: סיסמה פנימית בין ה-cron לפונקציה, והפעלה =====
-- בלי הרשאות למשתמשים: רק השרת (service role) קורא את הטבלה
create table if not exists mail_settings (
  id int primary key default 1 check (id = 1),
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into mail_settings (id) values (1) on conflict (id) do nothing;
alter table mail_settings enable row level security;
revoke all on mail_settings from anon, authenticated;

-- ===== 2. יומן המיילים: מה נשלח ולמי. מונע שליחה כפולה =====
create table if not exists mail_log (
  id bigint generated always as identity primary key,
  key text not null unique,
  kind text not null,
  site_id uuid references sites(id) on delete set null,
  to_list text[] not null default '{}',
  subject text,
  ok boolean not null default false,
  provider_id text,
  error text,
  sent_at timestamptz not null default now()
);
create index if not exists mail_log_sent on mail_log(sent_at desc);
alter table mail_log enable row level security;
drop policy if exists p_ml_sel on mail_log;
create policy p_ml_sel on mail_log for select using (is_service_admin());
revoke all on mail_log from anon;
revoke insert, update, delete on mail_log from authenticated;
grant select on mail_log to authenticated;

-- ===== 3. הפעלה כל 15 דקות =====
-- הפונקציה מחליטה לבד מה לשלוח: התראות תמיד, סיכום בוקר מ-07:00 (לא בשבת), דוח שבועי ביום ראשון מ-07:00
do $$ begin perform cron.unschedule('safety-mail'); exception when others then null; end $$;
select cron.schedule('safety-mail', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://etzzkiusujebtpvzobnd.supabase.co/functions/v1/safety-mail',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from public.mail_settings where id = 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$cron$);

-- ===== 4. גיבוי חודשי: תיקייה פרטית. רק מנהל השירות מוריד =====
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
drop policy if exists safety_backups_sel on storage.objects;
create policy safety_backups_sel on storage.objects for select to authenticated using (bucket_id = 'backups' and is_service_admin());
