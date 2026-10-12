-- Read-only verification for dodo-preview / zyyrzrncecpqvzmcocer.
-- Run after 20261012_office_import_drafts.sql. It does not read draft data.
with target as (
  select to_regclass('public.office_import_drafts') as relid
), column_check as (
  select coalesce(
    array_agg(column_name::text order by ordinal_position) = array[
      'id', 'source_partner', 'statement_month', 'row_count',
      'workspace_text', 'content_hash', 'created_at'
    ]::text[],
    false
  ) as columns_match
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'office_import_drafts'
), privilege_check as (
  select
    coalesce(
      array_agg(privilege_type::text order by privilege_type)
        filter (where grantee = 'service_role') = array['INSERT', 'SELECT']::text[],
      false
    ) as service_role_is_least_privilege,
    count(*) filter (where grantee in ('PUBLIC', 'anon', 'authenticated')) = 0
      as browser_roles_have_no_grants
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'office_import_drafts'
), checks as (
  select
    target.relid is not null as table_exists,
    coalesce((select relrowsecurity from pg_class where oid = target.relid), false)
      as rls_enabled,
    column_check.columns_match,
    privilege_check.service_role_is_least_privilege,
    privilege_check.browser_roles_have_no_grants,
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'office_import_drafts'
    ) as no_browser_policies,
    exists (
      select 1 from pg_constraint
      where conrelid = target.relid
        and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (content_hash)'
    ) as content_hash_is_unique,
    to_regclass('public.office_import_drafts_month_created') is not null
      as month_index_exists
  from target cross join column_check cross join privilege_check
)
select
  case when table_exists and rls_enabled and columns_match
    and service_role_is_least_privilege and browser_roles_have_no_grants
    and no_browser_policies and content_hash_is_unique and month_index_exists
    then 'READY' else 'NOT_READY' end as verification_status,
  *
from checks;
