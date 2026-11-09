-- חבילה 1.7 שלב א: עבודה בלי קליטה, נוסח חתימה בשפת העובד, ליקויי בטיחות עם צילום לפני ואחרי
-- להריץ פעם אחת ב-SQL Editor. בטוח להריץ שוב.

-- ===== 1. נוכחות שסומנה בלי קליטה =====
-- נוכחות שסומנה בטלפון בלי קליטה נשלחת כשחוזרת הקליטה, לפעמים למחרת. מותר לסמן להיום ועד יומיים אחורה
create or replace function attendance_stamp() returns trigger language plpgsql set search_path = public as $$
declare d date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if new.day > d or new.day < d - 2 then
    raise exception 'attendance_day: אפשר לסמן נוכחות להיום, ועד יומיים אחורה לסימון שנעשה בלי קליטה';
  end if;
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id and w.active) then
    raise exception 'worker_mismatch';
  end if;
  if tg_op = 'UPDATE' then
    if new.worker_id <> old.worker_id or new.site_id <> old.site_id or new.day <> old.day then raise exception 'attendance_locked'; end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.marked_by_email := my_email();
  new.marked_at := now();
  return new;
end $$;
revoke execute on function attendance_stamp() from public, anon, authenticated;

-- ===== 2. שפת העובד ונוסח החתימה בשפתו =====
alter table workers add column if not exists language text not null default 'he';
alter table workers drop constraint if exists workers_language_chk;
alter table workers add constraint workers_language_chk check (language in ('he','ar','ru','th','ro','zh','en'));

alter table training_signatures add column if not exists statement_local text;
alter table training_signatures add column if not exists lang text;
-- שעת הטלפון בחתימה (חשוב לחתימה שנעשתה בלי קליטה). שעת השרת נשארת signed_at
alter table training_signatures add column if not exists client_signed_at timestamptz;

create or replace function training_sig_stamp() returns trigger language plpgsql set search_path = public as $$
declare t trainings;
begin
  select * into t from trainings where id = new.training_id;
  if t.id is null or t.site_id <> new.site_id then raise exception 'training_mismatch'; end if;
  if t.closed_at is not null then raise exception 'training_closed: ההדרכה נסגרה ואי אפשר להוסיף חתימות'; end if;
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id and w.active) then raise exception 'worker_mismatch'; end if;
  new.signed_at := now(); new.created_at := now(); new.signed_by_email := my_email();
  -- שעת טלפון מתקבלת רק אם היא סבירה: לא בעתיד ולא יותר משלושה ימים אחורה
  if new.client_signed_at is not null and (new.client_signed_at > now() + interval '5 minutes' or new.client_signed_at < now() - interval '3 days') then
    new.client_signed_at := null;
  end if;
  return new;
end $$;
revoke execute on function training_sig_stamp() from public, anon, authenticated;

-- הדרכה שנפתחה בלי קליטה ונסגרת אחרי החתימות: סדר השליחה נשמר, אין צורך בשינוי

-- ===== 3. ליקויי בטיחות =====
create table if not exists defects (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  title text not null check (length(trim(title)) >= 3),
  location text,
  severity text not null default 'high' check (severity in ('crit','high','normal')),
  source text not null default 'other' check (source in ('checkin','so','bakar','sm','inspector','other')),
  responsible text not null check (length(trim(responsible)) >= 2),
  due_date date not null,
  before_path text not null,
  after_path text,
  fix_note text,
  closed_at timestamptz,
  closed_by_email text,
  event_id uuid references events(id),
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists defects_site on defects(site_id, closed_at);

create or replace function defect_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_email := my_email(); new.created_at := now();
    new.after_path := null; new.fix_note := null; new.closed_at := null; new.closed_by_email := null;
    return new;
  end if;
  if old.closed_at is not null then raise exception 'defect_closed: ליקוי שנסגר לא משתנה'; end if;
  if row(new.site_id, new.title, new.before_path, new.source, new.event_id, new.created_by_email, new.created_at)
     is distinct from row(old.site_id, old.title, old.before_path, old.source, old.event_id, old.created_by_email, old.created_at) then
    raise exception 'defect_locked';
  end if;
  -- סגירה: רק עם צילום אחרי ותיאור. השעה ומי סגר נקבעים בשרת
  if new.after_path is not null or new.closed_at is not null then
    if new.after_path is null or length(trim(coalesce(new.fix_note, ''))) < 3 then raise exception 'defect_needs_after: ליקוי נסגר רק עם צילום אחרי ותיאור התיקון'; end if;
    new.closed_at := now(); new.closed_by_email := my_email();
  end if;
  return new;
end $$;
drop trigger if exists defects_stamp on defects;
create trigger defects_stamp before insert or update on defects for each row execute function defect_stamp();
revoke execute on function defect_stamp() from public, anon, authenticated;
drop trigger if exists defects_no_delete on defects;
create trigger defects_no_delete before delete on defects for each row execute function no_delete();
drop trigger if exists defects_audit on defects;
create trigger defects_audit after insert or update on defects for each row execute function audit_row();
alter table defects enable row level security;
drop policy if exists p_df_sel on defects;
create policy p_df_sel on defects for select using (can_see_site(site_id));
drop policy if exists p_df_ins on defects;
create policy p_df_ins on defects for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
drop policy if exists p_df_upd on defects;
create policy p_df_upd on defects for update using (has_site_role(site_id, array['con','so','sm','wm','rep']))
  with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
revoke all on defects from anon;
grant select, insert, update on defects to authenticated;
