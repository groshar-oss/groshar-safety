-- חתימות במערכת (חבילה 1.4): כתב הסמכה לנציג מבצע הבנייה. חתימה לא נערכת ולא נמחקת.
-- כל חתימה שומרת את נוסח המסמך ואת טביעת האצבע שלו (SHA-256), כדי שאפשר יהיה להוכיח על מה נחתם.
create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  doc_type text not null check (doc_type in ('auth_letter')),
  doc_ref uuid not null,
  doc_hash text not null,
  doc_snapshot text not null,
  slot text not null check (slot in ('executor','rep')),
  signer_name text not null,
  signer_title text,
  image text not null,
  signed_by_email text default lower(coalesce(auth.jwt()->>'email','')),
  signed_at timestamptz not null default now(),
  user_agent text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);
create index if not exists signatures_doc on signatures(doc_type, doc_ref);
create trigger signatures_no_delete before delete on signatures for each row execute function no_delete();
create trigger signatures_no_update before update on signatures for each row execute function no_update();
create trigger signatures_audit after insert on signatures for each row execute function audit_row();
alter table signatures enable row level security;
create policy p_sg_sel on signatures for select using (can_see_site(site_id));
create policy p_sg_ins on signatures for insert with check (has_site_role(site_id, array['dev','con','rep','wm','sm','so']));
revoke all on signatures from anon;
grant select, insert on signatures to authenticated;
-- מי חתם ומתי נקבעים בשרת, לא בדפדפן
create or replace function signature_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  new.signed_by_email := my_email();
  new.signed_at := now();
  new.created_at := now();
  return new;
end $$;
create trigger signatures_stamp before insert on signatures for each row execute function signature_stamp();
revoke execute on function signature_stamp() from public, anon, authenticated;
