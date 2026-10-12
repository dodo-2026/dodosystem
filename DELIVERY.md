## Shared import trial implementation — 2026-10-12

The madeo2222 Vercel/Supabase ChatGPT connections stay dedicated to WARRANTY.
Do not request account switching, disconnection, or adding a DODO connection.
DODO publication/database setup is manual. See DODO-MANUAL-20261012.md.
The paired read-only verification SQL returns one READY/NOT_READY row for the
table shape, RLS, least-privilege grants, dedup constraint and monthly index;
it does not inspect draft rows or secrets.

Internal-only shared import save/list/reopen is wired into the existing import
screen. Dedicated additive SQL is provided, not applied. The server validates
input, deduplicates exact retries and checks stored integrity. It refuses
Production/foreign DB URLs and requires a server-only DODO preview key.
After a successful save, the screen now immediately reloads that exact draft
from the store before reporting the connected round trip. If only this reload
fails, it reports that save succeeded and directs the user to the monthly list;
it does not invite a blind duplicate retry.
1MB workspace limit remains. Monthly results now use a stable timestamp/UUID
cursor with 20 items per page; older saved drafts can be opened with Load more.
Local file workflow and separate guide sessions remain available.

Latest pagination repair: 7 shared-import tests, typecheck, changed-file ESLint
and dummy-env Next webpack build pass. The 349-test result belongs to the prior
3a55f45 implementation; the full suite was not repeated. The new 45-draft check
covers tied microsecond timestamps, a concurrent insert and the final draft's
60-row CSV/555000-yen payable roundtrip. Local HTTP with synthetic OFFICE login
returns imports200, anonymous307, missing-DB-config503 and cross-origin403.
The expected Chromium executable is absent; no browser download was retried.
The HTTP-store test double is not live DB verification. No push, PR, deployment,
DB/Storage/key change or field acceptance. Publication gate/rejected-push
boundary remains intact; manual publication must not bypass it.

Older unimplemented/switch-account directions below are superseded.

## Current DODO setup — 2026-10-07

DODO manages external guides' sales and settlements. Internal users have one
access level. Use OFFICE_LOGIN_ID, OFFICE_LOGIN_PASSWORD, OFFICE_SESSION_SECRET
(32+ characters), all Secret/Preview only. No inherited owner/staff split.
Login/logout routes: /api/office-login/login and /api/office-login/logout;
cookie: office_session. Guides use their independent guide_session.
Owner reports all five Preview env settings saved, including the final signing
secret. Values and connection were not read/verified. Supabase stays manual.
Vercel do-do5/dodosystem is connected to dodo-2026/dodosystem in owner screenshots.
Fresh do-do5 API read returned 403: connected Vercel identity has no access to it.
Do not deploy to the old madeo project or deploy the inherited main scaffold.
The workspace was pruned; saved 76e7972 code was recovered and the unpublished
login correction reconstructed. This is NOT old commit aa7e44f.
Shared database save/reload is still unimplemented. No public verification yet.

# DODO first office confirmation release

## Current connection facts — 2026-10-06

This section supersedes the historical connection blockers and owner setup
directions below. GitHub authorization for `dodo-2026/dodosystem` is complete;
do not ask the owner to repeat it. The Supabase plugin is reserved for STAR
WARRANTY. DODO Supabase operations are manual, using owner-run Dashboard SQL.
The owner has opened the existing DODO database and `dodo-preview`
(`zyyrzrncecpqvzmcocer`); the latter showed Healthy. Do not ask for Resume again.

The returned read-only schema report contains 13 public tables, including
`import_batches` and `import_rows`. Their columns support a batch and its row
records; the live save/reload flow is still unimplemented. All reported tables
have RLS enabled and no policies. Browser anon/authenticated CRUD therefore
cannot be assumed available. Preserve RLS and use office-verified server access;
never expose a service key in the browser or add broad public policies. The
report also shows broad direct grants, including TRUNCATE, on the business
tables; this is not a complete security audit. No grants have been changed.

The correct repository still has only remote `main` in the fresh branch lookup.
The accessible Vercel team has no project connected to the correct repository.
The existing `dodosystem` project is historical and does not establish a correct
release. Initial correct Preview Git connection/deployment needs the owner's
decision, and the previous six-hour build/recovery gate remains unresolved.
Do not bypass the prior rejected push or claim a working public URL.

The local office workflow was recovered from the saved ac26af6 bundle and the
two exact recorded patches. Replayed commits have new identities; do not label
them with the old SHA. The six work-file/CSV tests pass after recovery. This is
code recovery, not new browser, DB or field-trial verification.

Updated 2026-10-04. This checkout targets only `dodo-2026/dodosystem`.

## Connected confirmation workflow

Open `/imports` after office login. Enter the partner and statement month, then
choose a UTF-8 CSV/TSV. Correct any reported errors. Save the DODO work file
(`dodo-workspace-YYYY-MM.json`) to the computer. Refresh the page and select that
work file to restore the partner, month and all source rows. Valid rows are grouped
by guide code for the confirmation statement. Use “精算書を印刷・PDF出力” and
the browser print destination “PDFに保存”.

The work file is an explicit local-file save. There is no shared database record
and no automatic browser storage. Keep work files with other confidential office
documents. Amounts come directly from the CSV; no fee formula is assumed.
This output is a draft confirmation, not an issued payment or receipt certificate.

## Verification of the base local slice (ac26af6)

- Save/reopen round trip with 60 rows and two guides preserves source text,
  partner and month; each guide's 30 rows total 277,500 yen payable.
- Wrong format versions and invalid monetary values cannot produce statements.
- Typecheck, lint and all 336 tests pass. Production build passes.

Browser file-download, refresh/upload and print/PDF output still require actual
browser verification. The build and model tests do not establish a field trial.

### Save/reopen repair — 2026-10-04

CSV/TSV input remains limited to 5 MiB. Saved work files can be up to 12 MiB,
because JSON escaping can expand a valid CSV beyond 5 MiB. The restored original
source still must be at most 5 MiB in UTF-8 bytes; a JSON wrapper cannot bypass
the source limit. Two new regression tests cover a valid 600-row CSV whose saved
JSON exceeds 5 MiB, exact source boundaries, multibyte text and oversized JSON.
The focused import suite (25 tests), typecheck, lint and Next.js production
build pass after this repair. The full 336-test result above belongs to ac26af6;
the full suite was not repeated for this targeted change.

Browser verification was attempted, but no browser executable was available;
the bounded Chromium acquisition failed with an invalid/truncated archive.
No file-download, reupload, refresh or print operation has been observed in an
actual browser. This is a local code repair, not a new published confirmation URL.

The validated values can also be downloaded as a UTF-8 confirmation CSV. The
export includes every validated row (not only the 50-row screen preview),
quotes text safely, and neutralizes spreadsheet-formula prefixes. This output
is still a confirmation draft; it does not record payment or receipt issuance.

## Publication blockers and release gate

- Correct GitHub development branch creation returns 403
  `Resource not accessible by integration`. The visible GitHub App installation
  belongs to `madeo2222-coder`, not `dodo-2026`. Do not retry remote writes without
  new access evidence.
- Correct repository main is still `58efab03b6b0a95ae854bd4fb13f4535a25c148b`;
  no open PR exists. This local work has not been pushed or delivered.
- The accessible Vercel project's latest READY deployment uses the old repository
  and SHA `5cd231071a494522f3092df489f72812c5f412c0`. It cannot validate this release.
- The connected Supabase account exposes no DODO project. Do not use the
  other project's database. Shared draft save/reload awaits the approved DODO
  test project and actual schema.

Owner setup status: the user has already inspected the `dodo-2026` Installed
GitHub Apps page, which showed no installed apps. Do not ask for that inspection
or a duplicate account connection again. The existing `madeo2222-coder`
connection is valid; the blocked boundary is App-mediated repository write
coverage, not proof that another ChatGPT account connection is mandatory.
Identify the actual App and authorization route before issuing further owner
steps. The dedicated DODO Supabase test project and intended Vercel confirmation
project remain inaccessible from the current connections. Preserve existing
account links and never request secret credentials in chat.

The earlier 2026-10-06 18:00 JST confirmation target remains conditional on
resolving those connections on 2026-10-04; it is not a committed public delivery
date. Re-estimate if they remain unavailable. The next release gate is real
office login → save → refresh/reopen → matching output at the correct Preview URL.

Do not merge main, deploy Production, change production data, or change another
project. Preserve the existing minimum six-hour spacing of build-inducing remote
operations and verify the correct project's prior attempt/recovery ledger first.
Extend this office workflow before disconnected notification components.
