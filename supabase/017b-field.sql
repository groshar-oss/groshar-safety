-- חבילה 1.7 שלב ב: דוח ביקור בקר בטלפון, תיעוד תאונה עם הצהרות עדים חתומות
-- להריץ פעם אחת ב-SQL Editor, אחרי 017a-field.sql. בטוח להריץ שוב.

-- ===== 1. דוח ביקור בקר בטיחות =====
create table if not exists bakar_reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  duty_id uuid references duties(id),
  event_id uuid references events(id),
  visit_at timestamptz not null,
  stage text,
  bakar_name text not null,
  summary text,
  findings jsonb not null default '[]'::jsonb,
  recommendations text,
  pdf_path text,
  pdf_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists bakar_reports_site on bakar_reports(site_id);
create or replace function bakar_report_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.visit_at > now() + interval '5 minutes' then raise exception 'visit_future: מועד הביקור לא יכול להיות בעתיד'; end if;
    new.created_by_email := my_email(); new.created_at := now(); new.pdf_at := null;
    return new;
  end if;
  -- אחרי השמירה משנים רק את קובץ ה-PDF
  if row(new.site_id, new.duty_id, new.event_id, new.visit_at, new.stage, new.bakar_name, new.summary, new.findings, new.recommendations, new.created_by_email, new.created_at)
     is distinct from row(old.site_id, old.duty_id, old.event_id, old.visit_at, old.stage, old.bakar_name, old.summary, old.findings, old.recommendations, old.created_by_email, old.created_at) then
    raise exception 'report_locked: דוח שנשמר לא משתנה';
  end if;
  if new.pdf_path is distinct from old.pdf_path then new.pdf_at := now(); else new.pdf_at := old.pdf_at; end if;
  return new;
end $$;
drop trigger if exists bakar_reports_stamp on bakar_reports;
create trigger bakar_reports_stamp before insert or update on bakar_reports for each row execute function bakar_report_stamp();
revoke execute on function bakar_report_stamp() from public, anon, authenticated;
drop trigger if exists bakar_reports_no_delete on bakar_reports;
create trigger bakar_reports_no_delete before delete on bakar_reports for each row execute function no_delete();
drop trigger if exists bakar_reports_audit on bakar_reports;
create trigger bakar_reports_audit after insert or update on bakar_reports for each row execute function audit_row();
alter table bakar_reports enable row level security;
drop policy if exists p_br_sel on bakar_reports;
create policy p_br_sel on bakar_reports for select using (can_see_site(site_id));
-- כותב: הבקר, או היזם כשאין בקר (תקנה 1א(ב))
drop policy if exists p_br_ins on bakar_reports;
create policy p_br_ins on bakar_reports for insert with check (has_site_role(site_id, array['bakar','dev']));
drop policy if exists p_br_upd on bakar_reports;
create policy p_br_upd on bakar_reports for update using (has_site_role(site_id, array['bakar','dev'])) with check (has_site_role(site_id, array['bakar','dev']));
revoke all on bakar_reports from anon;
grant select, insert, update on bakar_reports to authenticated;

-- ===== 2. תיעוד תאונה =====
create table if not exists accident_reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  event_id uuid not null references events(id),
  worker_id uuid references workers(id),
  injured_name text not null,
  injured_id text,
  occurred_at timestamptz not null,
  place text not null,
  how text not null,
  injury text,
  evac text,
  first_aid text,
  photos jsonb not null default '[]'::jsonb,
  witnesses jsonb not null default '[]'::jsonb,
  pdf_path text,
  closed_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now(),
  unique (event_id)
);
create or replace function accident_report_stamp() returns trigger language plpgsql set search_path = public as $$
declare n int;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from events e where e.id = new.event_id and e.site_id = new.site_id) then raise exception 'event_mismatch'; end if;
    new.created_by_email := my_email(); new.created_at := now(); new.closed_at := null; new.pdf_path := null; new.witnesses := '[]'::jsonb;
    return new;
  end if;
  if old.closed_at is not null then raise exception 'accident_closed: התיעוד הסתיים ולא משתנה'; end if;
  if row(new.site_id, new.event_id, new.worker_id, new.injured_name, new.injured_id, new.occurred_at, new.place, new.how, new.injury, new.evac, new.first_aid, new.photos, new.created_by_email, new.created_at)
     is distinct from row(old.site_id, old.event_id, old.worker_id, old.injured_name, old.injured_id, old.occurred_at, old.place, old.how, old.injury, old.evac, old.first_aid, old.photos, old.created_by_email, old.created_at) then
    raise exception 'accident_locked: פרטי התאונה לא משתנים אחרי השמירה';
  end if;
  -- הצהרות עדים: רק מוסיפים. הצהרה שנחתמה לא משתנה ולא נמחקת
  n := jsonb_array_length(old.witnesses);
  if jsonb_array_length(new.witnesses) < n or (n > 0 and (select jsonb_agg(e order by i) from jsonb_array_elements(new.witnesses) with ordinality as t(e, i) where i <= n) <> old.witnesses) then
    raise exception 'witness_locked: הצהרה שנחתמה לא משתנה';
  end if;
  if new.closed_at is not null then new.closed_at := now(); end if;
  return new;
end $$;
drop trigger if exists accident_reports_stamp on accident_reports;
create trigger accident_reports_stamp before insert or update on accident_reports for each row execute function accident_report_stamp();
revoke execute on function accident_report_stamp() from public, anon, authenticated;
drop trigger if exists accident_reports_no_delete on accident_reports;
create trigger accident_reports_no_delete before delete on accident_reports for each row execute function no_delete();
drop trigger if exists accident_reports_audit on accident_reports;
create trigger accident_reports_audit after insert or update on accident_reports for each row execute function audit_row();
alter table accident_reports enable row level security;
-- גלוי לצד הקבלן ולבקר (כמו פנקס העובדים) וגם ליזם
drop policy if exists p_ar_sel on accident_reports;
create policy p_ar_sel on accident_reports for select using (can_see_workers(site_id) or has_site_role(site_id, array['dev']));
drop policy if exists p_ar_ins on accident_reports;
create policy p_ar_ins on accident_reports for insert with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
drop policy if exists p_ar_upd on accident_reports;
create policy p_ar_upd on accident_reports for update using (has_site_role(site_id, array['con','so','sm','wm','rep'])) with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
revoke all on accident_reports from anon;
grant select, insert, update on accident_reports to authenticated;

-- יומן הביקורת: תיעוד תאונה גלוי רק למי שרואה אותו
drop policy if exists p_a_sel on audit_log;
create policy p_a_sel on audit_log for select using (is_service_admin() or (site_id is not null and can_see_site(site_id)
  and (table_name not in ('workers','trainings','attendance','worker_exemptions','accident_reports') or can_see_workers(site_id)
       or (table_name = 'accident_reports' and has_site_role(site_id, array['dev'])))));

-- קבצים: צילומי התאונה והצהרות העדים גלויים רק למי שרואה את תיעוד התאונה
drop policy if exists safety_files_sel on storage.objects;
create policy safety_files_sel on storage.objects for select to authenticated using (bucket_id = 'files'
  and case when (storage.foldername(name))[2] = 'workers' then can_see_workers(((storage.foldername(name))[1])::uuid)
           when (storage.foldername(name))[2] = 'reports' and (storage.foldername(name))[3] = 'accident' then
             can_see_workers(((storage.foldername(name))[1])::uuid) or has_site_role(((storage.foldername(name))[1])::uuid, array['dev'])
           else can_see_site(((storage.foldername(name))[1])::uuid) end);
