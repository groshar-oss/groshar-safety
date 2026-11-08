-- גרושר · ניהול בטיחות באתר · מסד נתונים (Supabase / PostgreSQL)
-- מריצים פעם אחת ב-SQL Editor של פרויקט Supabase חדש ונפרד (לא בפרויקט של מערכת קבלני המשנה: יש שמות טבלאות משותפים).
-- אפשר להריץ שוב בלי נזק (if not exists / or replace).

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tenants') then
    raise exception 'נראה שזה הפרויקט של מערכת קבלני המשנה. צריך פרויקט Supabase חדש ונפרד למערכת הבטיחות.';
  end if;
end $$;

create extension if not exists pgcrypto;

-- ===== טבלאות =====
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_service_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ארגון: יזם, קבלן ראשי, יועץ
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('developer','contractor','consultant')),
  reg_no text,
  contractor_reg text,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- שיוך משתמש לארגון לפי אימייל (אפשר להוסיף לפני שהמשתמש נרשם)
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  org_admin boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  profile jsonb not null default '{}',           -- הפרופיל המשפטי מאשף התחולה
  status text not null default 'planning' check (status in ('planning','approved','active','stopped','closed_order','done')),
  demo boolean not null default false,
  created_by text default lower(coalesce(auth.jwt()->>'email','')),
  created_at timestamptz not null default now()
);

create table if not exists site_orgs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete restrict,
  kind text not null check (kind in ('developer','contractor','consultant')),
  created_at timestamptz not null default now(),
  unique (site_id, org_id)
);

-- בעלי תפקידים באתר (נמעני ההתראות)
create table if not exists site_people (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  role text not null check (role in ('dev','bakar','con','so','sm','wm','rep','fa','sub','viewer')),
  name text not null,
  phone text,
  email text,
  license text,
  from_date date,
  to_date date,
  backup boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists site_people_site on site_people(site_id);
create index if not exists site_people_email on site_people(lower(email));

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  type text not null,
  occurred_at timestamptz not null,
  description text,
  reported_by text,
  created_at timestamptz not null default now()
);
create index if not exists events_site on events(site_id, occurred_at desc);

-- מופעי חובה: לא נמחקים אף פעם. נסגרים כבוצע (עם ראיה), לא חל או דחייה מוצדקת (עם נימוק)
create table if not exists duties (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  key text not null,
  side text not null check (side in ('dev','con')),
  holder text not null,
  kind text not null,
  title text not null,
  ref text,
  critical boolean not null default false,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','na','waived')),
  event_id uuid references events(id),
  seq int not null default 1,
  auto boolean not null default true,
  done_at timestamptz,
  closed_at timestamptz,
  done_by text,
  evidence_note text,
  evidence_ref text,
  file_path text,
  na_reason text,
  created_at timestamptz not null default now(),
  constraint done_needs_evidence check (status <> 'done' or (coalesce(evidence_note,'') <> '' and (coalesce(evidence_ref,'') <> '' or file_path is not null) ) or auto is false),
  constraint closed_needs_reason check (status not in ('na','waived') or coalesce(na_reason,'') <> '')
);
create index if not exists duties_site on duties(site_id, status);

-- יומן שליחה: WhatsApp נרשם "נפתח לשליחה" (opened), לא "נמסר"
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  duty_id uuid references duties(id),
  level text,
  channel text not null check (channel in ('whatsapp','email')),
  status text not null,
  recipient_name text,
  recipient text,
  person_id uuid,
  sent_at timestamptz not null default now(),
  sent_by text,
  created_at timestamptz not null default now()
);
create index if not exists notifications_duty on notifications(duty_id);

-- צ'ק-אין יומי והשגחה באתר (מנהל עבודה או נציג מבצע הבנייה). לא נמחק ולא משתנה
create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  duty_id uuid references duties(id),
  day int not null,
  person_id uuid references site_people(id),
  person_name text not null,
  role text,
  backup boolean not null default false,
  at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  accuracy int,
  checks jsonb not null default '{}',
  note text,
  by text,
  created_at timestamptz not null default now()
);
create index if not exists checkins_site on checkins(site_id, at desc);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_email text,
  table_name text not null,
  row_id uuid,
  site_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_site on audit_log(site_id, at desc);

-- התקנה קיימת (חבילה 1 / 1.1): מוסיפים את תפקיד נציג מבצע הבנייה
alter table site_people drop constraint if exists site_people_role_check;
alter table site_people add constraint site_people_role_check check (role in ('dev','bakar','con','so','sm','wm','rep','fa','sub','viewer'));

-- ===== פונקציות הרשאה =====
create or replace function my_email() returns text language sql stable as $$
  select lower(coalesce(auth.jwt()->>'email',''))
$$;

create or replace function is_service_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_service_admin from profiles where user_id = auth.uid()), false)
$$;

-- התפקידים של המשתמש באתר: לפי ארגון (יזם / קבלן) ולפי שיוך אישי ברשימת בעלי התפקידים
create or replace function my_site_roles(s uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct r), '{}') from (
    select case so.kind when 'developer' then 'dev' when 'contractor' then 'con' else 'viewer' end as r
      from site_orgs so join memberships m on m.org_id = so.org_id
      where so.site_id = s and lower(m.email) = my_email()
    union all
    select sp.role from site_people sp where sp.site_id = s and sp.active and lower(coalesce(sp.email,'')) = my_email() and my_email() <> ''
    union all
    select 'dev' from sites x where x.id = s and x.created_by = my_email() and my_email() <> ''
  ) t
$$;

create or replace function can_see_site(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_service_admin() or cardinality(my_site_roles(s)) > 0
$$;
create or replace function has_site_role(s uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_service_admin() or my_site_roles(s) && roles
$$;
create or replace function role_side(r text) returns text language sql immutable as $$
  select case when r in ('dev','bakar','viewer') then 'dev' else 'con' end
$$;
-- חבר בארגון יזם (רשאי לפתוח אתר חדש)
create or replace function is_developer_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join orgs o on o.id = m.org_id where o.kind = 'developer' and lower(m.email) = my_email())
$$;

-- פרופיל נוצר בהרשמה
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email) values (new.id, lower(new.email)) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- המשתמשת הראשונה שנרשמת הופכת למנהלת השירות (רק אם עדיין אין כזו)
create or replace function claim_service_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email) select id, lower(email) from auth.users where id = auth.uid() on conflict do nothing;
  if exists (select 1 from profiles where is_service_admin) then return is_service_admin(); end if;
  update profiles set is_service_admin = true where user_id = auth.uid();
  return true;
end $$;

-- ===== כללים =====
-- אותו אדם לא יכול לכהן בשני תפקידים שהתקנות מפרידות ביניהם (תקנות 2א(א)(2), 2ב(א)(2))
create or replace function check_role_conflict() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad text[];
begin
  if not new.active then return new; end if;
  bad := case new.role when 'bakar' then array['wm','sm','so','rep'] when 'sm' then array['wm','bakar'] when 'wm' then array['bakar','sm'] when 'so' then array['bakar'] when 'rep' then array['bakar'] else array[]::text[] end;
  if exists (select 1 from site_people p where p.site_id = new.site_id and p.id <> new.id and p.active and p.role = any(bad)
      and ((coalesce(p.email,'') <> '' and lower(p.email) = lower(coalesce(new.email,'')))
        or (coalesce(p.phone,'') <> '' and regexp_replace(p.phone,'\D','','g') = regexp_replace(coalesce(new.phone,''),'\D','','g'))
        or trim(p.name) = trim(new.name))) then
    raise exception 'role_conflict';
  end if;
  return new;
end $$;
drop trigger if exists site_people_conflict on site_people;
create trigger site_people_conflict before insert or update on site_people for each row execute function check_role_conflict();

create or replace function no_delete() returns trigger language plpgsql as $$
begin raise exception 'no_delete'; end $$;
do $$ declare t text; begin
  foreach t in array array['duties','events','notifications','audit_log','checkins'] loop
    execute format('drop trigger if exists %I_no_delete on %I', t, t);
    execute format('create trigger %I_no_delete before delete on %I for each row execute function no_delete()', t, t);
  end loop;
end $$;

-- יומן ביקורת: אי אפשר לשנות רשומה קיימת
create or replace function no_update() returns trigger language plpgsql as $$
begin raise exception 'no_delete'; end $$;
drop trigger if exists audit_no_update on audit_log;
create trigger audit_no_update before update on audit_log for each row execute function no_update();

-- כל שינוי נרשם ביומן
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log(user_email, table_name, row_id, site_id, action, old_data, new_data)
  values (my_email(), tg_table_name, (r->>'id')::uuid,
          case when tg_table_name = 'sites' then (r->>'id')::uuid else nullif(r->>'site_id','')::uuid end,
          lower(tg_op), case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['orgs','memberships','sites','site_orgs','site_people','duties','events','checkins'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row()', t, t);
  end loop;
end $$;

-- ===== RLS =====
alter table profiles enable row level security;
alter table orgs enable row level security;
alter table memberships enable row level security;
alter table sites enable row level security;
alter table site_orgs enable row level security;
alter table site_people enable row level security;
alter table events enable row level security;
alter table duties enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;
alter table checkins enable row level security;

drop policy if exists p_profiles on profiles;
create policy p_profiles on profiles for select using (user_id = auth.uid() or is_service_admin());

-- ארגונים: רואים את הארגון שלך ואת הארגונים באתרים שלך. יוצרים ועורכים: מנהלת השירות
drop policy if exists p_orgs_sel on orgs;
create policy p_orgs_sel on orgs for select using (is_service_admin()
  or exists (select 1 from memberships m where m.org_id = orgs.id and lower(m.email) = my_email())
  or exists (select 1 from site_orgs so where so.org_id = orgs.id and can_see_site(so.site_id)));
drop policy if exists p_orgs_all on orgs;
create policy p_orgs_all on orgs for all using (is_service_admin()) with check (is_service_admin());

drop policy if exists p_mem_sel on memberships;
create policy p_mem_sel on memberships for select using (is_service_admin() or lower(email) = my_email());
drop policy if exists p_mem_all on memberships;
create policy p_mem_all on memberships for all using (is_service_admin()) with check (is_service_admin());

-- אתרים: יוצרים מנהלת השירות או חבר בארגון יזם. עורכים פרופיל: צד היזם
drop policy if exists p_sites_sel on sites;
create policy p_sites_sel on sites for select using (can_see_site(id) or created_by = my_email());
drop policy if exists p_sites_ins on sites;
create policy p_sites_ins on sites for insert with check (is_service_admin() or is_developer_member());
drop policy if exists p_sites_upd on sites;
create policy p_sites_upd on sites for update using (has_site_role(id, array['dev'])) with check (has_site_role(id, array['dev']));
drop policy if exists p_sites_del on sites;
create policy p_sites_del on sites for delete using (is_service_admin());

drop policy if exists p_so_sel on site_orgs;
create policy p_so_sel on site_orgs for select using (can_see_site(site_id));
drop policy if exists p_so_all on site_orgs;
create policy p_so_all on site_orgs for all using (has_site_role(site_id, array['dev'])) with check (has_site_role(site_id, array['dev']));

-- בעלי תפקידים: היזם ממנה את תפקידי צד היזם (כולל בקר), הקבלן את תפקידי צד הקבלן
drop policy if exists p_sp_sel on site_people;
create policy p_sp_sel on site_people for select using (can_see_site(site_id));
drop policy if exists p_sp_all on site_people;
create policy p_sp_all on site_people for all
  using (has_site_role(site_id, array[case when role_side(role) = 'dev' then 'dev' else 'con' end]))
  with check (has_site_role(site_id, array[case when role_side(role) = 'dev' then 'dev' else 'con' end]));

-- חובות ואירועים: כל בעל תפקיד פעיל באתר (חוץ מצופה) יוצר ומעדכן. ההגבלה למי רשאי לסגור איזו חובה נעשית במסך.
drop policy if exists p_d_sel on duties;
create policy p_d_sel on duties for select using (can_see_site(site_id));
drop policy if exists p_d_ins on duties;
create policy p_d_ins on duties for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
drop policy if exists p_d_upd on duties;
create policy p_d_upd on duties for update using (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep'])) with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));

drop policy if exists p_e_sel on events;
create policy p_e_sel on events for select using (can_see_site(site_id));
drop policy if exists p_e_ins on events;
create policy p_e_ins on events for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));

drop policy if exists p_n_sel on notifications;
create policy p_n_sel on notifications for select using (can_see_site(site_id));
drop policy if exists p_n_ins on notifications;
create policy p_n_ins on notifications for insert with check (can_see_site(site_id));

drop policy if exists p_c_sel on checkins;
create policy p_c_sel on checkins for select using (can_see_site(site_id));
drop policy if exists p_c_ins on checkins;
create policy p_c_ins on checkins for insert with check (has_site_role(site_id, array['con','wm','rep']));
-- אין עדכון ואין מחיקה של צ'ק-אין
drop trigger if exists checkins_no_update on checkins;
create trigger checkins_no_update before update on checkins for each row execute function no_update();

drop policy if exists p_a_sel on audit_log;
create policy p_a_sel on audit_log for select using (is_service_admin() or (site_id is not null and can_see_site(site_id)));

-- ===== קבצי ראיה: תיקייה ראשונה בנתיב = מזהה האתר =====
insert into storage.buckets (id, name, public, file_size_limit) values ('files', 'files', false, 26214400) on conflict (id) do nothing;
drop policy if exists safety_files_sel on storage.objects;
create policy safety_files_sel on storage.objects for select to authenticated using (bucket_id = 'files' and can_see_site(((storage.foldername(name))[1])::uuid));
drop policy if exists safety_files_ins on storage.objects;
create policy safety_files_ins on storage.objects for insert to authenticated with check (bucket_id = 'files'
  and has_site_role(((storage.foldername(name))[1])::uuid, array['dev','bakar','con','so','sm','wm','rep']));
-- אין מחיקת קבצי ראיה (אין מדיניות delete)

grant execute on function claim_service_admin() to authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
