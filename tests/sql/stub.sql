-- תחליף מקומי לחלקים של Supabase שהמסד צריך. רק לבדיקות מקומיות, לעולם לא מול Supabase אמיתי.
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, '{}'::jsonb) $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid default auth.uid(), created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
-- pg_cron / pg_net לא קיימים מקומית: פונקציות ריקות באותם שמות
create schema if not exists cron;
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$ select true $$;
create schema if not exists net;
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
