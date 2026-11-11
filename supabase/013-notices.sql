-- הודעות רשמיות שממתינות לאישור (חבילה 1.3). טיוטה ← אישור ← שליחה. אין מחיקה; כל שינוי נרשם ביומן.
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  duty_id uuid references duties(id),
  key text not null,
  channel text not null check (channel in ('gov','email','letter')),
  status text not null default 'draft' check (status in ('draft','approved','sent','cancelled')),
  title text,
  to_list jsonb not null default '[]',
  subject text,
  body text,
  fields jsonb not null default '[]',
  approved_by text,
  approved_at timestamptz,
  sent_by text,
  sent_at timestamptz,
  sent_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- שום הודעה לא נרשמת כנשלחה בלי אישור
  constraint sent_needs_approval check (status <> 'sent' or approved_at is not null)
);
create index if not exists notices_duty on notices(duty_id);
create index if not exists notices_site on notices(site_id);

drop trigger if exists notices_no_delete on notices;
create trigger notices_no_delete before delete on notices for each row execute function no_delete();
-- הודעה שנשלחה נעולה
create or replace function notice_lock() returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'sent' then raise exception 'notice_sent_locked'; end if;
  return new;
end $$;
drop trigger if exists notices_lock on notices;
create trigger notices_lock before update on notices for each row execute function notice_lock();
drop trigger if exists notices_audit on notices;
create trigger notices_audit after insert or update on notices for each row execute function audit_row();

alter table notices enable row level security;
drop policy if exists p_nt_sel on notices;
create policy p_nt_sel on notices for select using (can_see_site(site_id));
drop policy if exists p_nt_ins on notices;
create policy p_nt_ins on notices for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
drop policy if exists p_nt_upd on notices;
create policy p_nt_upd on notices for update using (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep'])) with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
revoke all on notices from anon;
grant select, insert, update on notices to authenticated;
revoke execute on function notice_lock() from public, anon, authenticated;
