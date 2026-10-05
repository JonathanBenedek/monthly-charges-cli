# Monthly Charges CLI

Lets you (or an AI coding agent acting on your behalf) add or edit a month of
expense data by handing it a credit-card Excel export and/or a bank-statement
PDF — instead of using the companion web app's upload form.

It reads and writes the **same Google Drive folder** the web app uses, so
anything it does shows up in the web app immediately and vice versa. S3 is
never touched by this tool — it only hosts the web app's static files.
Everything runs locally on your own machine; there is no backend server.

## For an AI agent setting this up on a new machine

If you were handed a link to this repo and asked to set up the CLI, do this:

1. `git clone` this repo somewhere reasonable (e.g. `~/monthly-charges-cli`).
2. Run `./setup.sh` from inside it. The script is idempotent and handles:
   installing Node.js if missing, `npm install`, and the Drive auth flow.
3. **If the script prints `MISSING_CLIENT_SECRET`: stop and ask the human
   user for the file.** It's `~/.monthly-charges/credentials/client_secret.json`
   — a shared OAuth client config that is deliberately *not* in this repo.
   The user should already know to get it from Jonathan (email, AirDrop, a
   USB stick — any transfer method works, it's just a file). Once they
   confirm it's in place at that exact path, re-run `./setup.sh`.
4. The script will then run `node bin/cli.js auth` — this opens a browser
   consent screen. **The human must complete this themselves**, signing in
   with their own Google account and clicking Allow. This step cannot and
   should not be automated away — it's what proves a real person is
   authorizing Drive access, not something silently granting itself access.
5. Once `setup.sh` finishes without errors, confirm everything works:
   `node bin/cli.js list-months` should print the real month names from Drive.
6. From then on, you can run `add-month`/`edit-month`/etc. directly — see
   "Commands" below. No further setup is needed on this machine.

## One-time project setup (already done — reference only)

This only needs doing once per Google Cloud project, not per machine or
per person:

1. In Google Cloud Console, **APIs & Services → Credentials → Create
   Credentials → OAuth client ID**, application type **Desktop app**.
2. Download its JSON — this is the `client_secret.json` referenced above.
   It is shared across every machine/person using this CLI; it is *not*
   regenerated per device.
3. If the OAuth consent screen is in **Testing** publishing status, add
   each person's Google account under **Test users**, or they won't be able
   to complete the consent flow.

## Commands

All commands print **one JSON object to stdout** (progress/logs go to
stderr), so an agent can parse the result reliably. `add-month`/`edit-month`
default to **dry-run** — nothing is written to Drive until you pass `--commit`.

```
node bin/cli.js list-months [--folder <name>]
node bin/cli.js show-month --month <Name> [--folder <name>]
node bin/cli.js add-month --month <Name> --excel <path.xlsx> [--pdf <path.pdf>] [--commit] [--folder <name>]
node bin/cli.js edit-month --month <Name> --patch <patch.json> [--commit] [--folder <name>]
```

`--folder` overrides the Drive root folder name (default `Monthly Expenses
Data`). Use it to point at a disposable test folder before ever touching
real data — see Verification below.

### Typical agent workflow

1. Run `add-month` (dry-run by default) with the two files the user provided.
2. Read `warnings` in the JSON output:
   - `UNMAPPED_MERCHANT` — a merchant has no category mapping yet. Ask the
     user what category it belongs to.
   - `AMBIGUOUS_MONTH_EXISTS` — this month already has saved data; re-running
     will overwrite it (per-transaction edits are preserved via signature
     matching). Confirm with the user if that's intended.
   - `BUDGET_DELTA_LARGE` — a category's total changed drastically vs. last
     time; worth a sanity check with the user before committing.
3. Once satisfied, re-run the same command with `--commit`.
4. For any later fix (recategorize, exclude, add a comment), write a small
   patch JSON and run `edit-month --commit`.

### `edit-month` patch file shape

```jsonc
{
  "transactions": [
    {
      // Target either by the exact Drive-saved id (fast path)...
      "target": { "id": "tx-37" },
      // ...or by the transaction's exact signature (when you only know the
      // human description, e.g. "the ₪54.90 charge at XYZ Burger on 4/2/26"):
      // "target": { "merchant": "XYZ BURGER", "date": "04/02/26", "amount": 54.90, "source": "credit" },

      "set": { "category": "אוכל", "excluded": false, "comment": "business lunch" },
      "rememberForFuture": true,   // optional: also saves this merchant->category to category-overrides.json
      "markAlwaysManual": false    // optional: also adds/removes the merchant from always-manual.json
    }
  ],
  "budget": {                      // optional
    "planned": { "אוכל": 2500 },
    "salaries": { "משכורת גל": { "April26": 9000 } }
  }
}
```

A patch entry with an ambiguous or unmatched target is skipped (not fatal to
the rest of the batch) and reported via `TX_NOT_FOUND`/`TX_SIGNATURE_AMBIGUOUS`
warnings.

## Multiple people, same Drive folder

If the Drive folder has been shared with you (via the web app's invite
feature), your own `node bin/cli.js auth` — using your own Google account —
is enough: the CLI looks up the folder by name across everything your
account can see, including folders shared with you, so you land on the same
shared data automatically. No separate "join" step needed.

## Verification (recommended before touching real data)

1. Everything below uses `--folder "Monthly Expenses Data TEST"` — a
   disposable folder, created fresh in your Drive, fully isolated from the
   real data.
2. `add-month` (dry-run) against a real pair of sample files, pointed at the
   TEST folder — sanity-check `summary.categoryTotals` looks reasonable.
3. Re-run with `--commit`, then open the web app and use "join shared folder"
   pointed at the TEST folder's Drive ID to visually confirm it renders.
4. `edit-month --commit` to exclude one transaction + add a comment; reload
   in the web app and confirm the change and budget total shift.
5. Re-run `add-month` on the same month (simulating a corrected re-upload)
   and confirm the edit survives via signature migration.
6. Only after all of the above pass, drop `--folder` for real use — and
   review one real dry-run before ever passing `--commit` against real data.
