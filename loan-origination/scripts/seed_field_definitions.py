#!/usr/bin/env python3
"""
Sync public.field_definitions from the Sphinx Loan Data Dictionary ("Loan Data" tab).

Targeted, idempotent upsert on `key` (merge-duplicates): writes only the columns the dictionary
owns for display/visibility — key, label, section, type, options, lender_only, repeat_group — and
OMITS source, required_stage, calc_key, verifiable, programs, sort and broker_visible so existing
DB values survive. This is deliberate: a full overwrite would clobber later migrations (e.g. 0011
set `ltv` source=manual though the sheet lists it calculated) and the app's programs model, and
re-open migration 0030's RLS fix (the sheet flags only `trade` as "Lender only", not closing/admin).

`lender_only` is the sheet's "Lender only" column OR membership in an internal section
(trade/closing/data_tape/admin), so the UI-hidden sections stay protected at the DB.

Usage:
  python3 scripts/seed_field_definitions.py --xlsx "/path/Loan Data Dictionary.xlsx" --dry-run
  python3 scripts/seed_field_definitions.py --json "/path/grid.json" --dry-run      # rows as a 2D array
  python3 scripts/seed_field_definitions.py --json "/path/grid.json" \
      --endpoint https://<app>/api/admin/seed-field-defs                            # via deployed route

--endpoint posts {secret, rows} to the deployed admin route (SHEETS_SYNC_SECRET from .env.local);
use it because the local service-role key is revoked. Direct PostgREST mode (no --endpoint) needs a
live SUPABASE_SERVICE_ROLE_KEY. Dry-run writes scripts/out/field_definitions.json and a summary.
"""
import argparse, json, os, urllib.request

# Sections hidden from brokers/borrowers in the UI; flagged lender_only so RLS matches the UI
# (keeps migration 0030's fix). broker_visible is omitted here, so the broker-safe subset survives.
INTERNAL_SECTIONS = {"trade", "closing", "data_tape", "admin"}
# Identity / system columns that live on `loans`, not as editable fields.
SKIP_KEYS = {"deal_id", "loan_number", "stage"}


def map_type(t: str) -> str:
    t = (t or "").lower().strip()
    if "currency" in t:
        return "currency"
    if "percent" in t:
        return "percent"
    if t == "date":
        return "date"
    if "select" in t or "enum" in t:
        return "select"
    if "email" in t:
        return "email"
    if "phone" in t:  # "phone number" -> phone (checked before number)
        return "phone"
    if "integer" in t or "decimal" in t or t == "number":
        return "number"
    return "text"  # text, long text, uuid


def parse_options(allowed: str):
    """New sheet: a clean comma-separated enum list. Values may contain parenthetical notes with no
    inner comma, so a plain split is safe."""
    return [p.strip() for p in (allowed or "").split(",") if p.strip()]


def build_rows_from_grid(rows):
    header = rows[0]
    H = {("" if c is None else str(c).strip()): i for i, c in enumerate(header)}

    def g(r, name):
        i = H.get(name)
        if i is None or i >= len(r):
            return ""
        return "" if r[i] is None else str(r[i]).strip()

    out, skipped, warnings = [], [], []
    for r in rows[1:]:
        key = g(r, "Key")
        if not key:
            continue  # blank spacer / note rows at the bottom
        if key in SKIP_KEYS:
            skipped.append((key, "system column"))
            continue
        section = (g(r, "Section").lower().split() or [""])[0]
        if not section:
            skipped.append((key, "no section"))
            continue
        typ = map_type(g(r, "Type"))
        options = parse_options(g(r, "Options")) if typ == "select" else []
        rep = g(r, "Repeat").lower()
        repeat_group = rep if rep in ("property", "guarantor") else None
        sheet_lender = g(r, "Lender only").upper() in ("TRUE", "YES", "1")
        lender_only = sheet_lender or section in INTERNAL_SECTIONS

        out.append({
            "key": key,
            "label": g(r, "Label") or key,
            "section": section,
            "type": typ,
            "options": options,
            "lender_only": lender_only,
            "repeat_group": repeat_group,
            # omitted (preserved on existing rows): source, required_stage, calc_key, verifiable,
            # programs, sort, broker_visible.
        })
    return out, skipped, warnings


def load_grid(xlsx_path, json_path):
    if json_path:
        data = json.load(open(json_path))
        return data["values"] if isinstance(data, dict) else data
    import openpyxl
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["Loan Data"] if "Loan Data" in wb.sheetnames else wb[wb.sheetnames[0]]
    return [list(r) for r in ws.iter_rows(values_only=True)]


def load_env():
    env = {}
    with open(os.path.join(os.path.dirname(__file__), "..", ".env.local")) as f:
        for line in f:
            if "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def upsert(rows):
    env = load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/field_definitions?on_conflict=key"
    body = json.dumps(rows).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", env["SUPABASE_SERVICE_ROLE_KEY"])
    req.add_header("Authorization", "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"])
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates,return=minimal")
    with urllib.request.urlopen(req) as resp:
        return resp.status


def post_endpoint(rows, endpoint):
    """Upsert via the deployed /api/admin/seed-field-defs route (service role lives server-side;
    the local key is revoked). Secret read from .env.local SHEETS_SYNC_SECRET."""
    env = load_env()
    body = json.dumps({"secret": env["SHEETS_SYNC_SECRET"], "rows": rows}).encode()
    req = urllib.request.Request(endpoint, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        return resp.status, resp.read().decode()


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--xlsx", help="Dictionary workbook; reads the 'Loan Data' tab.")
    src.add_argument("--json", help="Grid as a 2D array (or a get_values response object).")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--endpoint", help="Deployed /api/admin/seed-field-defs URL; upsert through it "
                    "instead of PostgREST (use when the local service key is revoked).")
    args = ap.parse_args()

    rows, skipped, warnings = build_rows_from_grid(load_grid(args.xlsx, args.json))
    print(f"Built {len(rows)} field rows. Skipped {len(skipped)} rows.")
    by_sec = {}
    for r in rows:
        by_sec[r["section"]] = by_sec.get(r["section"], 0) + 1
    print("By section:", by_sec)
    by_type = {}
    for r in rows:
        by_type[r["type"]] = by_type.get(r["type"], 0) + 1
    print("By type:", by_type)
    print("Lender-only:", sum(1 for r in rows if r["lender_only"]),
          "| Repeat(property):", sum(1 for r in rows if r["repeat_group"] == "property"),
          "| Repeat(guarantor):", sum(1 for r in rows if r["repeat_group"] == "guarantor"))
    emails = [r["key"] for r in rows if r["type"] == "email"]
    phones = [r["key"] for r in rows if r["type"] == "phone"]
    print("Email-typed:", ", ".join(emails))
    print("Phone-typed:", ", ".join(phones))
    print("Admin section:", ", ".join(r["key"] for r in rows if r["section"] == "admin"))
    print("Contact section:", ", ".join(r["key"] for r in rows if r["section"] == "contact"))
    if warnings:
        print("\nWARNINGS:", *(f"\n  - {w}" for w in warnings))
    if skipped:
        print("\nSkipped ->", ", ".join(f"{t}({why})" for t, why in skipped))

    if args.dry_run:
        outdir = os.path.join(os.path.dirname(__file__), "out")
        os.makedirs(outdir, exist_ok=True)
        path = os.path.join(outdir, "field_definitions.json")
        json.dump(rows, open(path, "w"), indent=2)
        print(f"\nDry run — wrote {path}")
        return
    if args.endpoint:
        status, resp = post_endpoint(rows, args.endpoint)
        print(f"\nUpserted via endpoint. HTTP {status} {resp}")
        return
    status = upsert(rows)
    print(f"\nUpserted. HTTP {status}")


if __name__ == "__main__":
    main()
