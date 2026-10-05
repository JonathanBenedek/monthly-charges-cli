---
name: add-month
description: Add (or refresh) a month of expense data via the Monthly Charges CLI. Asks for the credit-card Excel file, the bank statement PDF, and the month name, runs a dry run first, surfaces any warnings for the user to resolve, then commits once confirmed. Use whenever the user wants to add a new month or re-import a month's files.
argument-hint: [month] [excel-path] [pdf-path]
allowed-tools: [Bash, Read]
---

# Add Month

Runs this repo's CLI (`bin/cli.js add-month`) to parse a credit-card Excel
export and/or a bank statement PDF, categorize the transactions, and save
the month to the shared Google Drive store that the web app also reads from.

## Step 1 — Collect the three parameters

Use whichever of these were already given as arguments ($ARGUMENTS); ask the
user directly for any that are missing — don't guess or assume:

1. **Month name** — e.g. `October26` (month abbreviation + 2-digit year,
   matching the existing naming convention).
2. **Credit-card Excel file path** — the `.xlsx` export.
3. **Bank statement PDF file path** — the `.pdf` export.

At least one of the Excel/PDF files is required, but not both — if the user
only has one of the two (e.g. just a corrected bank PDF), that's fine, proceed
with just that one and omit the other flag in Step 2.

## Step 2 — Dry run first

Run (omitting `--excel`/`--pdf` if one wasn't provided):

```
node bin/cli.js add-month --month <MONTH> --excel <EXCEL_PATH> --pdf <PDF_PATH>
```

This does **not** write anything to Drive. Read the JSON output's `warnings`
and `summary`, and summarize it for the user in plain language — don't just
dump raw JSON at them:

- `UNMAPPED_MERCHANT` — ask the user what category each one belongs to.
- `AMBIGUOUS_MONTH_EXISTS` — this month already has saved data and will be
  overwritten (per-transaction edits are preserved via signature matching).
  Confirm this is intended before proceeding.
- `BUDGET_DELTA_LARGE` — a category changed drastically vs. last time; flag
  it as a sanity check, not necessarily a blocker.
- If `auth.js` reports `NOT_AUTHENTICATED`, tell the user to run
  `node bin/cli.js auth` first (or `./setup.sh`) and stop.

## Step 3 — Commit

Once the user confirms (or there were no concerning warnings), re-run the
exact same command with `--commit` added. Confirm success and report the
final category totals from the output.

## Reference

See this repo's `README.md` (or `CLI.md`) for the full command surface, the
JSON output schema, and the `edit-month` patch format — useful if the user
wants to fix an `UNMAPPED_MERCHANT` or exclude/recategorize a transaction
after this month is committed.
