#!/usr/bin/env python3
"""
Seed public.field_definitions from the Sphinx Loan Data Dictionary (Field Dictionary tab).

Idempotent: upserts on `key` (PostgREST merge-duplicates). Run after migration 0009.

Usage:
  python3 scripts/seed_field_definitions.py --xlsx "/path/Sphinx Loan Data Dictionary v0.6.xlsx" --dry-run
  python3 scripts/seed_field_definitions.py --xlsx "/path/.../v0.6.xlsx"        # live upsert

Live mode reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
Dry-run writes the computed rows to scripts/out/field_definitions.json and prints a summary.
"""
import argparse, json, os, re, sys, urllib.request
import openpyxl

VALID_STAGES = {
    "intake", "pre_qualification", "quote_term_sheet", "processing",
    "underwriting", "final_approval", "closing", "post_close",
}
VALID_SOURCES = {"intake", "manual", "calculated", "system", "config"}
# Identity / system columns that live on `loans`, not as editable fields.
SKIP_KEYS = {"deal_id", "loan_number", "stage"}


def map_type(t: str) -> str:
    t = (t or "").lower()
    if "currency" in t:
        return "currency"
    if "percent" in t:
        return "percent"
    if t.strip() == "date":
        return "date"
    if "enum" in t:
        return "select"
    if "integer" in t or "decimal" in t or t.strip() == "number":
        return "number"
    return "text"  # text, long text, email, phone, uuid


def norm_section(s: str):
    s = (s or "").strip().lower()
    if s.startswith("app_settings"):
        return None  # company config -> app_settings table (P19), not a field
    base = s.split("(")[0].strip().split()
    return base[0] if base else None


def parse_options(allowed: str):
    if not allowed:
        return []
    low = allowed.lower()
    if "existing" in low or "list from" in low or "e.g." in low or "format" in low.split(":")[0]:
        return []  # not an enumerable value list; leave for manual review
    parts, depth, cur = [], 0, ""
    for ch in allowed:
        if ch == "(":
            depth += 1; cur += ch
        elif ch == ")":
            depth = max(0, depth - 1); cur += ch
        elif ch == "," and depth == 0:
            parts.append(cur); cur = ""
        else:
            cur += ch
    parts.append(cur)
    opts = []
    for p in parts:
        p = re.sub(r"\(.*?\)", "", p).strip().strip("[]").strip()
        if p:
            opts.append(p)
    return opts


def build_rows(xlsx_path: str):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["Field Dictionary"]
    rows = list(ws.iter_rows(values_only=True))
    H = {("" if c is None else str(c).strip()): i for i, c in enumerate(rows[0])}

    def g(r, name):
        i = H.get(name)
        if i is None or i >= len(r):
            return ""
        return "" if r[i] is None else str(r[i]).strip()

    out, skipped, warnings = [], [], []
    sort = 0
    for r in rows[1:]:
        tag = g(r, "Tag")
        if not tag:
            continue
        section = norm_section(g(r, "Supabase section"))
        if section is None:
            skipped.append((tag, "app_settings"))
            continue
        key = tag.replace("_n_", "_")
        if key in SKIP_KEYS:
            skipped.append((tag, "system column"))
            continue

        lvl = g(r, "Level").lower()
        repeat_group = "property" if lvl == "property" else ("guarantor" if lvl == "guarantor" else None)
        typ = map_type(g(r, "Type"))
        options = parse_options(g(r, "Allowed values / format")) if typ == "select" else []
        if typ == "select" and not options:
            warnings.append(f"{key}: enum with no parsed options (allowed='{g(r,'Allowed values / format')}')")

        prog = g(r, "Program").strip()
        # Match loan_programs.loan_type_key, which is lowercase (dscr, rtl, ...).
        programs = [] if prog.lower() in ("both", "", "n/a") else [prog.lower()]
        verifiable = "verified" in g(r, "Initial / Verified").lower()
        stage = g(r, "Supabase stage").strip()
        required_stage = stage if stage in VALID_STAGES else None
        source = g(r, "Source").strip().lower()
        if source not in VALID_SOURCES:
            source = None
        calc_key = key if source == "calculated" else None

        sort += 10
        out.append({
            "key": key,
            "label": g(r, "Label") or key,
            "section": section,
            "type": typ,
            "options": options,
            # hashtag intentionally omitted: new fields use {{key}}; omitting it on upsert
            # leaves any existing row's hashtag (old #alias) untouched (brief decision 1).
            "lender_only": section == "trade",
            "verifiable": verifiable,
            "repeat_group": repeat_group,
            "programs": programs,
            "required_stage": required_stage,
            "source": source,
            "calc_key": calc_key,
            "sort": sort,
        })
    return out, skipped, warnings


def upsert(rows):
    env = {}
    with open(os.path.join(os.path.dirname(__file__), "..", ".env.local")) as f:
        for line in f:
            if "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    url = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/field_definitions?on_conflict=key"
    body = json.dumps(rows).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", env["SUPABASE_SERVICE_ROLE_KEY"])
    req.add_header("Authorization", "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"])
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates,return=minimal")
    with urllib.request.urlopen(req) as resp:
        return resp.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows, skipped, warnings = build_rows(args.xlsx)
    print(f"Built {len(rows)} field rows. Skipped {len(skipped)} rows.")
    by_sec = {}
    for r in rows:
        by_sec.setdefault(r["section"], 0)
        by_sec[r["section"]] += 1
    print("By section:", by_sec)
    print("Verifiable:", sum(1 for r in rows if r["verifiable"]),
          "| Calculated:", sum(1 for r in rows if r["source"] == "calculated"),
          "| Repeat(property):", sum(1 for r in rows if r["repeat_group"] == "property"),
          "| Repeat(guarantor):", sum(1 for r in rows if r["repeat_group"] == "guarantor"))
    if warnings:
        print("\nWARNINGS (review enum options manually):")
        for w in warnings:
            print("  -", w)
    print("\nSkipped ->", ", ".join(f"{t}({why})" for t, why in skipped))

    if args.dry_run:
        outdir = os.path.join(os.path.dirname(__file__), "out")
        os.makedirs(outdir, exist_ok=True)
        path = os.path.join(outdir, "field_definitions.json")
        json.dump(rows, open(path, "w"), indent=2)
        print(f"\nDry run — wrote {path}")
        return
    status = upsert(rows)
    print(f"\nUpserted. HTTP {status}")


if __name__ == "__main__":
    main()
