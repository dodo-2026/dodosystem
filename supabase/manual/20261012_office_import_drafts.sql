-- Manual trial setup ONLY: dodo-preview / zyyrzrncecpqvzmcocer.
-- Additive; does not change import_batches, import_rows or guide records.
-- Review the project identity in Dashboard before executing.
begin;
create table public.office_import_drafts (
  id uuid primary key default gen_random_uuid(),
  source_partner text not null check (length(source_partner) between 1 and 200),
  statement_month text not null check (statement_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  row_count integer not null check (row_count > 0),
  workspace_text text not null check (octet_length(workspace_text) <= 1048576),
  content_hash text not null unique check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index office_import_drafts_month_created on public.office_import_drafts (statement_month, created_at desc, id desc);
alter table public.office_import_drafts enable row level security;
revoke all on public.office_import_drafts from public, anon, authenticated;
revoke all on public.office_import_drafts from service_role;
grant select, insert on public.office_import_drafts to service_role;
-- No public RLS policies: only authenticated server API may use the server key.
notify pgrst, 'reload schema';
commit;
