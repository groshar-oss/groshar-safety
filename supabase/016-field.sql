-- חבילה 1.6: נוכחות יומית, אישור עבודה בגובה חובה עם החרגה באישור, ביקורת באתר
-- להריץ פעם אחת ב-SQL Editor. בטוח להריץ שוב.

-- ===== 1. נוכחות יומית של עובדים =====
-- שורה לכל עובד ליום. מסמנים רק להיום (שעון ישראל). השעה ומי סימן נקבעים בשרת
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  worker_id uuid not null references workers(id),
  day date not null,
  present boolean not null default true,
  marked_by_email text,
  marked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (worker_id, day)
);
create index if not exists attendance_site_day on attendance(site_id, day);

create or replace function attendance_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if new.day <> (now() at time zone 'Asia/Jerusalem')::date then
    raise exception 'attendance_day: אפשר לסמן נוכחות רק להיום';
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
drop trigger if exists attendance_stamp on attendance;
create trigger attendance_stamp before insert or update on attendance for each row execute function attendance_stamp();
revoke execute on function attendance_stamp() from public, anon, authenticated;
drop trigger if exists attendance_no_delete on attendance;
create trigger attendance_no_delete before delete on attendance for each row execute function no_delete();
drop trigger if exists attendance_audit on attendance;
create trigger attendance_audit after insert or update on attendance for each row execute function audit_row();
alter table attendance enable row level security;
drop policy if exists p_att_sel on attendance;
create policy p_att_sel on attendance for select using (can_see_workers(site_id));
drop policy if exists p_att_ins on attendance;
create policy p_att_ins on attendance for insert with check (can_register_workers(site_id));
drop policy if exists p_att_upd on attendance;
create policy p_att_upd on attendance for update using (can_register_workers(site_id)) with check (can_register_workers(site_id));
revoke all on attendance from anon;
grant select, insert, update on attendance to authenticated;

-- ===== 2. החרגה מאישור עבודה בגובה =====
-- כל עובד באתר צריך אישור עבודה בגובה. החרגה רק באישור:
-- באתר שיש בו מנהל אתר: מנהל האתר בלבד. באתר בלי מנהל אתר: הנהלת הקבלן הראשי או מנהל השירות
create or replace function can_exempt_height(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from site_people p where p.site_id = s and p.role = 'sm' and p.active)
    then coalesce(my_site_roles(s) && array['sm'], false)
    else has_site_role(s, array['con']) end
$$;
revoke execute on function can_exempt_height(uuid) from public, anon;
grant execute on function can_exempt_height(uuid) to authenticated;

-- שורה לכל החלטה (החרגה או ביטול החרגה). לא נערכת ולא נמחקת. ההחלטה האחרונה קובעת
create table if not exists worker_exemptions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  worker_id uuid not null references workers(id),
  kind text not null default 'height' check (kind in ('height')),
  cancel boolean not null default false,
  reason text not null check (length(trim(reason)) >= 5),
  approver_name text,
  approver_role text,
  approved_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists worker_exemptions_w on worker_exemptions(worker_id);
create or replace function worker_exemption_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id) then raise exception 'worker_mismatch'; end if;
  new.approved_by_email := my_email();
  new.created_at := now();
  new.approver_role := case when exists (select 1 from site_people p where p.site_id = new.site_id and p.role = 'sm' and p.active) then 'sm'
    when is_service_admin() then 'admin' else 'con' end;
  return new;
end $$;
drop trigger if exists worker_exemptions_stamp on worker_exemptions;
create trigger worker_exemptions_stamp before insert on worker_exemptions for each row execute function worker_exemption_stamp();
revoke execute on function worker_exemption_stamp() from public, anon, authenticated;
drop trigger if exists worker_exemptions_no_delete on worker_exemptions;
create trigger worker_exemptions_no_delete before delete on worker_exemptions for each row execute function no_delete();
drop trigger if exists worker_exemptions_no_update on worker_exemptions;
create trigger worker_exemptions_no_update before update on worker_exemptions for each row execute function no_update();
drop trigger if exists worker_exemptions_audit on worker_exemptions;
create trigger worker_exemptions_audit after insert on worker_exemptions for each row execute function audit_row();
alter table worker_exemptions enable row level security;
drop policy if exists p_wx_sel on worker_exemptions;
create policy p_wx_sel on worker_exemptions for select using (can_see_workers(site_id));
drop policy if exists p_wx_ins on worker_exemptions;
create policy p_wx_ins on worker_exemptions for insert with check (can_exempt_height(site_id));
revoke all on worker_exemptions from anon;
grant select, insert on worker_exemptions to authenticated;

-- ===== 3. ביקורת באתר =====
-- רישום של כל ביקורת: מי המבקר, מתי נפתחה, למי נשלחה הודעה, וה-PDF שהופק
create table if not exists site_inspections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  inspector_name text not null,
  inspector_role text,
  purpose text,
  started_at timestamptz not null default now(),
  started_by_email text,
  notified jsonb not null default '[]'::jsonb,
  pdf_path text,
  pdf_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists site_inspections_site on site_inspections(site_id);
create or replace function site_inspection_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.started_at := now(); new.created_at := now(); new.started_by_email := my_email(); new.pdf_at := null;
  else
    -- אחרי הפתיחה משנים רק את רשימת ההודעות ואת ה-PDF
    if row(new.site_id, new.inspector_name, new.inspector_role, new.purpose, new.started_at, new.started_by_email, new.created_at)
       is distinct from row(old.site_id, old.inspector_name, old.inspector_role, old.purpose, old.started_at, old.started_by_email, old.created_at) then
      raise exception 'inspection_locked';
    end if;
    if new.pdf_path is distinct from old.pdf_path then new.pdf_at := now(); else new.pdf_at := old.pdf_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists site_inspections_stamp on site_inspections;
create trigger site_inspections_stamp before insert or update on site_inspections for each row execute function site_inspection_stamp();
revoke execute on function site_inspection_stamp() from public, anon, authenticated;
drop trigger if exists site_inspections_no_delete on site_inspections;
create trigger site_inspections_no_delete before delete on site_inspections for each row execute function no_delete();
drop trigger if exists site_inspections_audit on site_inspections;
create trigger site_inspections_audit after insert or update on site_inspections for each row execute function audit_row();
alter table site_inspections enable row level security;
drop policy if exists p_si_sel on site_inspections;
create policy p_si_sel on site_inspections for select using (can_see_site(site_id));
drop policy if exists p_si_ins on site_inspections;
create policy p_si_ins on site_inspections for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
drop policy if exists p_si_upd on site_inspections;
create policy p_si_upd on site_inspections for update using (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']))
  with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
revoke all on site_inspections from anon;
grant select, insert, update on site_inspections to authenticated;

-- יומן הביקורת: נוכחות והחרגות גלויות רק למי שרואה את פנקס העובדים
drop policy if exists p_a_sel on audit_log;
create policy p_a_sel on audit_log for select using (is_service_admin() or (site_id is not null and can_see_site(site_id)
  and (table_name not in ('workers','trainings','attendance','worker_exemptions') or can_see_workers(site_id))));

-- קבצים: דוח ביקורת עם פרטי עובדים נשמר בתיקיית העובדים. מותר לשמור אותו גם למי שרואה את פנקס העובדים (למשל הנהלת הקבלן)
drop policy if exists safety_files_ins on storage.objects;
create policy safety_files_ins on storage.objects for insert to authenticated with check (bucket_id = 'files'
  and case when (storage.foldername(name))[2] = 'workers' then
             can_register_workers(((storage.foldername(name))[1])::uuid)
             or ((storage.foldername(name))[3] = 'inspections' and can_see_workers(((storage.foldername(name))[1])::uuid))
           else has_site_role(((storage.foldername(name))[1])::uuid, array['dev','bakar','con','so','sm','wm','rep']) end);
