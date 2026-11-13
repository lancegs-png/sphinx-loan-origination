---
name: open-loan
description: Open a new loan end-to-end — the Google Drive folder (with subfolders + DSCR dashboard) AND the app record with a loan number, in one command. Use when asked to "open/create/start a new loan", "set up a new deal", or "put a new loan in the app", especially when an address is given. For Drive-folder-only work (no app record), use the open-loan-files skill instead.
metadata:
  version: "1.0.0"
  argument-hint: <address> [borrower name]
---

# Open a new loan (end-to-end)

Runs `scripts/open-loan.mjs`, which creates the deal's Drive folder + subfolders + DSCR
dashboard **and** the app loan record (address, guarantor, linked folder/dashboard, and an
SPHX number if asked) in one shot. This replaces doing the two halves by hand.

## Why a script (not direct DB writes)

The local Supabase service-role key is revoked, so the app record **cannot** be written
from a local script directly. The app record is created through the deployed, secret-gated
`/api/admin/create-loan` endpoint (service role, in the repo). The script does the Drive
work with the Google service account, then calls that endpoint. The sibling ops endpoints
are `/api/admin/promote-loan` (opportunity → signed loan) and `/api/admin/relink-sheet`.

## Before running

Confirm with the user (don't guess these):
- **Address** — full street, city, ST, ZIP.
- **Borrower name** — goes on the folder (`<address> [First Last]`) and as the guarantor.
  If they want it address-only for now, omit `--borrower`.
- **Number** — OPP#### now with the SPHX assigned at signing (default), or assign the SPHX
  **now** (`--sphinx`). 

Prereqs (already set for this project): `.env.local` has `GOOGLE_SERVICE_ACCOUNT_JSON`,
`GOOGLE_DRIVE_PARENT_FOLDER_ID`, and `SHEETS_SYNC_SECRET`. DSCR only (the dashboard template
is the DSCR Deal Dashboard).

## Run it

From `loan-origination/`:

```bash
node scripts/open-loan.mjs --address "18300 Lynn Road, North Fort Myers, FL 33917" --borrower "Jay Taveras" --sphinx
```

Flags: `--sphinx` (assign SPHX now), `--dry-run` (validate + show the plan, create nothing),
`--force` (create even if a folder for that street already exists — the script otherwise
stops on a suspected duplicate).

It prints the loan number, the in-app link, the Drive folder link, and the dashboard link.
Relay those to the user. The endpoint also seeds the dashboard, and the folder/dashboard/app
record are linked so edits sync between the app and the sheet.

## If the endpoint 404s

The deployed app may be mid-redeploy. Re-run after it finishes. Creating is **not**
idempotent — each successful run makes a new loan — so don't blindly re-run on an ambiguous
error; check whether a loan/number was already created first.
