-- DODO data model draft (NOT A MIGRATION)
--
-- This file has never been applied to a local or remote database. The Supabase
-- CLI is not installed in the current workspace, so this deliberately lives
-- outside supabase/migrations. When the target Supabase project and its backup
-- are confirmed, create a real file with `supabase migration new dodo_core_schema`,
-- review the generated migration, and test it against a disposable local DB.
--
-- The current app uses a signed staff cookie rather than Supabase Auth. All
-- public tables therefore enable RLS without anon/authenticated policies
-- (default deny). Future app access must use a secret key from server-only code.

begin;

create table public.dodo_guides (
  id uuid primary key default gen_random_uuid(),
  guide_code text not null unique,
  name text not null,
  name_kana text,
  itc_number text,
  wechat_id text,
  phone_e164 text,
  bank_name text,
  bank_branch text,
  bank_account_type text,
  bank_account_number text,
  bank_account_holder text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dodo_guides_guide_code_not_blank check (btrim(guide_code) <> ''),
  constraint dodo_guides_name_not_blank check (btrim(name) <> ''),
  constraint dodo_guides_phone_e164_check check (
    phone_e164 is null or phone_e164 ~ '^\\+81[789]0[0-9]{8}$'
  ),
  constraint dodo_guides_bank_account_type_check check (
    bank_account_type is null
    or bank_account_type in ('ordinary', 'current', 'savings', 'other')
  )
);

create table public.dodo_guide_phone_challenges (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.dodo_guides(id) on delete restrict,
  phone_e164 text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dodo_guide_phone_challenges_phone_check check (phone_e164 ~ '^\\+81[789]0[0-9]{8}$'),
  constraint dodo_guide_phone_challenges_attempt_check check (attempt_count between 0 and 5),
  constraint dodo_guide_phone_challenges_expiry_check check (expires_at > created_at)
);

create table public.dodo_guide_sessions (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.dodo_guides(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dodo_guide_sessions_expiry_check check (expires_at > created_at)
);

create table public.dodo_import_batches (
  id uuid primary key default gen_random_uuid(),
  statement_month date not null,
  source_partner text not null,
  original_filename text not null,
  file_sha256 text not null,
  status text not null default 'draft',
  row_count integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint dodo_import_batches_month_start check (
    statement_month = date_trunc('month', statement_month)::date
  ),
  constraint dodo_import_batches_source_not_blank check (btrim(source_partner) <> ''),
  constraint dodo_import_batches_filename_not_blank check (btrim(original_filename) <> ''),
  constraint dodo_import_batches_sha256_check check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint dodo_import_batches_status_check check (
    status in ('draft', 'validated', 'confirmed', 'rejected')
  ),
  constraint dodo_import_batches_row_count_check check (row_count >= 0),
  constraint dodo_import_batches_file_unique unique (source_partner, file_sha256)
);

create table public.dodo_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.dodo_import_batches(id) on delete restrict,
  source_row_number integer not null,
  external_reference text,
  guide_code_raw text not null,
  guide_id uuid references public.dodo_guides(id) on delete restrict,
  work_date date not null,
  gross_com_yen bigint not null,
  dodo_fee_yen bigint not null,
  guide_payment_yen bigint not null,
  validation_status text not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  row_fingerprint text not null,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint dodo_import_rows_source_row_check check (source_row_number >= 1),
  constraint dodo_import_rows_guide_code_not_blank check (btrim(guide_code_raw) <> ''),
  constraint dodo_import_rows_gross_check check (gross_com_yen >= 0),
  constraint dodo_import_rows_fee_check check (dodo_fee_yen >= 0),
  constraint dodo_import_rows_payment_check check (guide_payment_yen >= 0),
  constraint dodo_import_rows_validation_status_check check (
    validation_status in ('pending', 'valid', 'invalid', 'duplicate')
  ),
  constraint dodo_import_rows_errors_array_check check (jsonb_typeof(validation_errors) = 'array'),
  constraint dodo_import_rows_fingerprint_check check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint dodo_import_rows_source_row_unique unique (batch_id, source_row_number),
  constraint dodo_import_rows_fingerprint_unique unique (row_fingerprint)
);

create table public.dodo_monthly_settlements (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.dodo_guides(id) on delete restrict,
  statement_month date not null,
  status text not null default 'draft',
  gross_com_yen bigint not null default 0,
  dodo_fee_yen bigint not null default 0,
  adjustment_yen bigint not null default 0,
  guide_payment_yen bigint not null default 0,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint dodo_monthly_settlements_month_start check (
    statement_month = date_trunc('month', statement_month)::date
  ),
  constraint dodo_monthly_settlements_status_check check (
    status in ('draft', 'confirmed', 'payable', 'paid', 'void')
  ),
  constraint dodo_monthly_settlements_gross_check check (gross_com_yen >= 0),
  constraint dodo_monthly_settlements_fee_check check (dodo_fee_yen >= 0),
  constraint dodo_monthly_settlements_payment_check check (guide_payment_yen >= 0),
  constraint dodo_monthly_settlements_guide_month_unique unique (guide_id, statement_month)
);

create table public.dodo_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.dodo_monthly_settlements(id) on delete restrict,
  import_row_id uuid not null unique references public.dodo_import_rows(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint dodo_settlement_lines_pair_unique unique (settlement_id, import_row_id)
);

create table public.dodo_payment_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft',
  export_sha256 text,
  created_at timestamptz not null default now(),
  exported_at timestamptz,
  completed_at timestamptz,
  constraint dodo_payment_batches_status_check check (
    status in ('draft', 'exported', 'completed', 'cancelled')
  ),
  constraint dodo_payment_batches_export_sha256_check check (
    export_sha256 is null or export_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create table public.dodo_payments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.dodo_payment_batches(id) on delete restrict,
  settlement_id uuid not null unique references public.dodo_monthly_settlements(id) on delete restrict,
  guide_id uuid not null references public.dodo_guides(id) on delete restrict,
  amount_yen bigint not null,
  status text not null default 'pending',
  bank_transfer_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dodo_payments_amount_check check (amount_yen >= 0),
  constraint dodo_payments_status_check check (
    status in ('pending', 'exported', 'paid', 'failed', 'cancelled')
  )
);

create table public.dodo_documents (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.dodo_guides(id) on delete restrict,
  settlement_id uuid references public.dodo_monthly_settlements(id) on delete restrict,
  document_type text not null,
  status text not null default 'draft',
  storage_path text,
  file_sha256 text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint dodo_documents_type_check check (
    document_type in ('settlement', 'payment_certificate', 'receipt', 'work_report')
  ),
  constraint dodo_documents_status_check check (status in ('draft', 'final', 'void')),
  constraint dodo_documents_version_check check (version >= 1),
  constraint dodo_documents_sha256_check check (
    file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint dodo_documents_version_unique unique (
    guide_id,
    settlement_id,
    document_type,
    version
  )
);

create table public.dodo_work_reports (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.dodo_guides(id) on delete restrict,
  settlement_id uuid not null unique references public.dodo_monthly_settlements(id) on delete restrict,
  status text not null default 'draft',
  signer_name text,
  signature_storage_path text,
  signature_sha256 text,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dodo_work_reports_status_check check (
    status in ('draft', 'sent', 'signed', 'void')
  ),
  constraint dodo_work_reports_signature_sha256_check check (
    signature_sha256 is null or signature_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint dodo_work_reports_signed_fields_check check (
    status <> 'signed'
    or (
      signer_name is not null
      and signature_storage_path is not null
      and signature_sha256 is not null
      and signed_at is not null
    )
  )
);

create index dodo_import_rows_batch_id_idx on public.dodo_import_rows(batch_id);
create index dodo_guide_phone_challenges_guide_id_idx on public.dodo_guide_phone_challenges(guide_id);
create index dodo_guide_sessions_guide_id_idx on public.dodo_guide_sessions(guide_id);
create index dodo_import_rows_guide_id_idx on public.dodo_import_rows(guide_id);
create index dodo_import_rows_work_date_idx on public.dodo_import_rows(work_date);
create index dodo_monthly_settlements_guide_id_idx on public.dodo_monthly_settlements(guide_id);
create index dodo_monthly_settlements_month_idx on public.dodo_monthly_settlements(statement_month);
create index dodo_settlement_lines_settlement_id_idx on public.dodo_settlement_lines(settlement_id);
create index dodo_payments_batch_id_idx on public.dodo_payments(batch_id);
create index dodo_payments_guide_id_idx on public.dodo_payments(guide_id);
create index dodo_documents_guide_id_idx on public.dodo_documents(guide_id);
create index dodo_documents_settlement_id_idx on public.dodo_documents(settlement_id);
create index dodo_work_reports_guide_id_idx on public.dodo_work_reports(guide_id);

alter table public.dodo_guides enable row level security;
alter table public.dodo_guide_phone_challenges enable row level security;
alter table public.dodo_guide_sessions enable row level security;
alter table public.dodo_import_batches enable row level security;
alter table public.dodo_import_rows enable row level security;
alter table public.dodo_monthly_settlements enable row level security;
alter table public.dodo_settlement_lines enable row level security;
alter table public.dodo_payment_batches enable row level security;
alter table public.dodo_payments enable row level security;
alter table public.dodo_documents enable row level security;
alter table public.dodo_work_reports enable row level security;

revoke all on table public.dodo_guides from anon, authenticated;
revoke all on table public.dodo_guide_phone_challenges from anon, authenticated;
revoke all on table public.dodo_guide_sessions from anon, authenticated;
revoke all on table public.dodo_import_batches from anon, authenticated;
revoke all on table public.dodo_import_rows from anon, authenticated;
revoke all on table public.dodo_monthly_settlements from anon, authenticated;
revoke all on table public.dodo_settlement_lines from anon, authenticated;
revoke all on table public.dodo_payment_batches from anon, authenticated;
revoke all on table public.dodo_payments from anon, authenticated;
revoke all on table public.dodo_documents from anon, authenticated;
revoke all on table public.dodo_work_reports from anon, authenticated;

grant select, insert, update, delete on table public.dodo_guides to service_role;
grant select, insert, update, delete on table public.dodo_guide_phone_challenges to service_role;
grant select, insert, update, delete on table public.dodo_guide_sessions to service_role;
grant select, insert, update, delete on table public.dodo_import_batches to service_role;
grant select, insert, update, delete on table public.dodo_import_rows to service_role;
grant select, insert, update, delete on table public.dodo_monthly_settlements to service_role;
grant select, insert, update, delete on table public.dodo_settlement_lines to service_role;
grant select, insert, update, delete on table public.dodo_payment_batches to service_role;
grant select, insert, update, delete on table public.dodo_payments to service_role;
grant select, insert, update, delete on table public.dodo_documents to service_role;
grant select, insert, update, delete on table public.dodo_work_reports to service_role;

-- Keep this draft non-operative even if accidentally pasted into a transaction.
rollback;
