-- פנקס עובדים, הדרכות עם חתימות, ציוד ותסקירים (חבילה 1.5)
-- עובדים לא נכנסים למערכת. מי שרושם עובדים: מנהל עבודה, נציג מבצע הבנייה, או מנהל השירות.
-- תעודה מזהה מלאה וצילום שלה חובה. אסור לרשום עובד מתחת לגיל 18 (נבדק גם בשרת).

-- מי רואה את פנקס העובדים: צד הקבלן ובקר הבטיחות (לא היזם, בגלל מספרי תעודות וצילומים)
create or replace function can_see_workers(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_site_role(s, array['con','so','sm','wm','rep','bakar'])
$$;
-- מי רושם עובדים ומעביר הדרכות
create or replace function can_register_workers(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_site_role(s, array['wm','rep'])
$$;
revoke execute on function can_see_workers(uuid), can_register_workers(uuid) from public, anon;
grant execute on function can_see_workers(uuid), can_register_workers(uuid) to authenticated;

create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  id_type text not null check (id_type in ('il','passport')),
  id_number text not null check (length(trim(id_number)) >= 5),
  id_photo_path text not null,
  birth_date date not null,
  company text,
  trade text,
  phone text,
  foreign_worker boolean not null default false,
  nationality text,
  entry_date date,
  permit_no text,
  permit_until date,
  f8_date date,
  f8_institution text,
  f8_path text,
  height boolean not null default false,
  height_until date,
  height_path text,
  active boolean not null default true,
  added_by_email text,
  created_at timestamptz not null default now(),
  constraint foreign_needs_entry check (not foreign_worker or (entry_date is not null and permit_until is not null)),
  constraint height_needs_cert check (not height or (height_until is not null and height_path is not null))
);
create index if not exists workers_site on workers(site_id);
create unique index if not exists workers_site_id_number on workers(site_id, id_type, id_number);

-- גיל 18 ומעלה, ומי רשם: נקבעים בשרת
create or replace function worker_check() returns trigger language plpgsql set search_path = public as $$
begin
  if new.birth_date > (current_date - interval '18 years')::date then
    raise exception 'under_18: אסור להעסיק באתר בנייה עובד מתחת לגיל 18';
  end if;
  if tg_op = 'INSERT' then
    new.added_by_email := my_email();
    new.created_at := now();
  else
    new.added_by_email := old.added_by_email;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists workers_check on workers;
create trigger workers_check before insert or update on workers for each row execute function worker_check();
revoke execute on function worker_check() from public, anon, authenticated;
drop trigger if exists workers_no_delete on workers;
create trigger workers_no_delete before delete on workers for each row execute function no_delete();
drop trigger if exists workers_audit on workers;
create trigger workers_audit after insert or update on workers for each row execute function audit_row();
alter table workers enable row level security;
drop policy if exists p_w_sel on workers;
create policy p_w_sel on workers for select using (can_see_workers(site_id));
drop policy if exists p_w_ins on workers;
create policy p_w_ins on workers for insert with check (can_register_workers(site_id));
drop policy if exists p_w_upd on workers;
create policy p_w_upd on workers for update using (can_register_workers(site_id)) with check (can_register_workers(site_id));
revoke all on workers from anon;
grant select, insert, update on workers to authenticated;

-- הדרכות
create table if not exists trainings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('annual','intro','height','toolbox','other')),
  topic text not null,
  trainer_name text not null,
  trainer_title text,
  language text,
  content text,
  held_at timestamptz not null default now(),
  pdf_path text,
  pdf_at timestamptz,
  trainer_sig text,
  closed_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists trainings_site on trainings(site_id);
create or replace function training_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_email := my_email(); new.created_at := now(); new.held_at := least(coalesce(new.held_at, now()), now());
  else
    -- אחרי ההדרכה משנים רק את קובץ ה-PDF ואת הסגירה
    if row(new.site_id, new.kind, new.topic, new.trainer_name, new.trainer_title, new.language, new.content, new.held_at, new.created_by_email, new.created_at)
       is distinct from row(old.site_id, old.kind, old.topic, old.trainer_name, old.trainer_title, old.language, old.content, old.held_at, old.created_by_email, old.created_at) then
      raise exception 'training_locked: אי אפשר לשנות פרטי הדרכה אחרי שנפתחה';
    end if;
    if old.closed_at is not null and (new.closed_at is distinct from old.closed_at or new.trainer_sig is distinct from old.trainer_sig) then raise exception 'training_locked'; end if;
    if new.closed_at is not null and old.closed_at is null and coalesce(new.trainer_sig, '') = '' then raise exception 'training_needs_trainer_sig'; end if;
    if new.pdf_path is distinct from old.pdf_path then new.pdf_at := now(); end if;
    if new.closed_at is not null and old.closed_at is null then new.closed_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trainings_stamp on trainings;
create trigger trainings_stamp before insert or update on trainings for each row execute function training_stamp();
revoke execute on function training_stamp() from public, anon, authenticated;
drop trigger if exists trainings_no_delete on trainings;
create trigger trainings_no_delete before delete on trainings for each row execute function no_delete();
drop trigger if exists trainings_audit on trainings;
create trigger trainings_audit after insert or update on trainings for each row execute function audit_row();
alter table trainings enable row level security;
drop policy if exists p_t_sel on trainings;
create policy p_t_sel on trainings for select using (can_see_workers(site_id));
drop policy if exists p_t_ins on trainings;
create policy p_t_ins on trainings for insert with check (can_register_workers(site_id));
drop policy if exists p_t_upd on trainings;
create policy p_t_upd on trainings for update using (can_register_workers(site_id)) with check (can_register_workers(site_id));
revoke all on trainings from anon;
grant select, insert, update on trainings to authenticated;

-- חתימת עובד על קבלת הדרכה: לא נערכת ולא נמחקת. השעה והמשתמש שהחזיק את הטלפון נקבעים בשרת
create table if not exists training_signatures (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references trainings(id),
  site_id uuid not null references sites(id) on delete cascade,
  worker_id uuid not null references workers(id),
  worker_name text not null,
  statement text not null,
  image text not null,
  signed_at timestamptz not null default now(),
  signed_by_email text,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (training_id, worker_id)
);
create index if not exists training_sigs_t on training_signatures(training_id);
create index if not exists training_sigs_w on training_signatures(worker_id);
create or replace function training_sig_stamp() returns trigger language plpgsql set search_path = public as $$
declare t trainings;
begin
  select * into t from trainings where id = new.training_id;
  if t.id is null or t.site_id <> new.site_id then raise exception 'training_mismatch'; end if;
  if t.closed_at is not null then raise exception 'training_closed: ההדרכה נסגרה ואי אפשר להוסיף חתימות'; end if;
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id and w.active) then raise exception 'worker_mismatch'; end if;
  new.signed_at := now(); new.created_at := now(); new.signed_by_email := my_email();
  return new;
end $$;
drop trigger if exists training_sigs_stamp on training_signatures;
create trigger training_sigs_stamp before insert on training_signatures for each row execute function training_sig_stamp();
revoke execute on function training_sig_stamp() from public, anon, authenticated;
drop trigger if exists training_sigs_no_delete on training_signatures;
create trigger training_sigs_no_delete before delete on training_signatures for each row execute function no_delete();
drop trigger if exists training_sigs_no_update on training_signatures;
create trigger training_sigs_no_update before update on training_signatures for each row execute function no_update();
-- בלי יומן ביקורת לחתימות: השורה עצמה לא ניתנת לשינוי, והשעה והמשתמש נקבעו בשרת
alter table training_signatures enable row level security;
drop policy if exists p_ts_sel on training_signatures;
create policy p_ts_sel on training_signatures for select using (can_see_workers(site_id));
drop policy if exists p_ts_ins on training_signatures;
create policy p_ts_ins on training_signatures for insert with check (can_register_workers(site_id));
revoke all on training_signatures from anon;
grant select, insert on training_signatures to authenticated;

-- ציוד ותסקירים: כל בדיקה נשמרת כשורה נפרדת (היסטוריה מלאה)
create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('lift_machine','lift_gear','other')),
  name text not null,
  ident text,
  owner text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists equipment_site on equipment(site_id);
create table if not exists inspections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  equipment_id uuid not null references equipment(id),
  inspected_at date not null,
  next_due date not null,
  inspector text not null,
  cert_path text,
  note text,
  created_by_email text default lower(coalesce(auth.jwt()->>'email','')),
  created_at timestamptz not null default now(),
  constraint next_after check (next_due > inspected_at)
);
create index if not exists inspections_eq on inspections(equipment_id);
drop trigger if exists equipment_no_delete on equipment;
create trigger equipment_no_delete before delete on equipment for each row execute function no_delete();
drop trigger if exists equipment_audit on equipment;
create trigger equipment_audit after insert or update on equipment for each row execute function audit_row();
drop trigger if exists inspections_no_delete on inspections;
create trigger inspections_no_delete before delete on inspections for each row execute function no_delete();
drop trigger if exists inspections_no_update on inspections;
create trigger inspections_no_update before update on inspections for each row execute function no_update();
drop trigger if exists inspections_audit on inspections;
create trigger inspections_audit after insert on inspections for each row execute function audit_row();
alter table equipment enable row level security;
alter table inspections enable row level security;
drop policy if exists p_eq_sel on equipment;
create policy p_eq_sel on equipment for select using (can_see_site(site_id));
drop policy if exists p_eq_ins on equipment;
create policy p_eq_ins on equipment for insert with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
drop policy if exists p_eq_upd on equipment;
create policy p_eq_upd on equipment for update using (has_site_role(site_id, array['con','so','sm','wm','rep'])) with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
drop policy if exists p_in_sel on inspections;
create policy p_in_sel on inspections for select using (can_see_site(site_id));
drop policy if exists p_in_ins on inspections;
create policy p_in_ins on inspections for insert with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
revoke all on equipment, inspections from anon;
grant select, insert, update on equipment to authenticated;
grant select, insert on inspections to authenticated;

-- קבצי עובדים (צילום תעודה, אישור גובה, PDF הדרכה): רק מי שרואה את פנקס העובדים
drop policy if exists safety_files_sel on storage.objects;
create policy safety_files_sel on storage.objects for select to authenticated using (bucket_id = 'files'
  and case when (storage.foldername(name))[2] = 'workers' then can_see_workers(((storage.foldername(name))[1])::uuid)
           else can_see_site(((storage.foldername(name))[1])::uuid) end);
drop policy if exists safety_files_ins on storage.objects;
create policy safety_files_ins on storage.objects for insert to authenticated with check (bucket_id = 'files'
  and case when (storage.foldername(name))[2] = 'workers' then can_register_workers(((storage.foldername(name))[1])::uuid)
           else has_site_role(((storage.foldername(name))[1])::uuid, array['dev','bakar','con','so','sm','wm','rep']) end);

-- יומן הביקורת: שינויים בפנקס העובדים ובהדרכות גלויים רק למי שרואה את הפנקס
drop policy if exists p_a_sel on audit_log;
create policy p_a_sel on audit_log for select using (is_service_admin() or (site_id is not null and can_see_site(site_id)
  and (table_name not in ('workers','trainings') or can_see_workers(site_id))));
