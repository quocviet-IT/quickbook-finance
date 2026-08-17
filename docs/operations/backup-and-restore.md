# Backup and restore runbook

Owner: accounting operations. Review every quarter and after any schema change
that adds a table.

This runbook covers two independent things:

1. **Recovery** — bringing the database back after loss or corruption. This
   relies on Supabase, not on the application.
2. **Verification** — proving a recovered database is the one we lost. This
   relies on the application's company-data export, whose manifest carries the
   control totals a restored database must reproduce.

A backup you have never restored is a hope, not a control. The drill log at the
end is the evidence that this one works.

## 1. What the export archive is

`/settings/company` → **Export company data** produces a ZIP:

| Path | Contents |
|---|---|
| `manifest.json` | Schema version, generation time, per-file row counts and sha256, control totals, and the date those totals were measured |
| `data/<table>.csv` | One CSV per accounting table, header row = column names |
| `sensitive/vendor-tax.csv` | Vendor tax profiles **including taxpayer identification numbers** |
| `attachments.csv` | Attachment inventory: storage path, size, sha256, scan status. File bytes are not included |
| `README.txt` | How to read the archive |

Only `acc_bank_connection_secret` is excluded: those tokens are encrypted with
an environment key, so a copy is a live secret and a useless restore.

The archive is not a substitute for a database backup: it holds one company, not
the database, and it does not carry the bytes of any attachment. But it is no
longer a dead end. Settings → Backups can load one back into a **new** company
and report whether the control totals came back — see section 4a. Restoring
*over* a damaged company is still not possible; the way back is to restore
beside it and compare.

### Handling

The archive contains taxpayer identification numbers. Store it where the
company stores tax records, not in general file shares or chat. Every export
writes an `acc_audit_log` row recording who exported, when, how many rows, the
manifest checksum, and whether the sensitive file was included — the audit row
never contains the data itself.

## 2. Recovery objectives

| Item | Value | Confirmed by | Date |
|---|---|---|---|
| Supabase plan | *record the plan here* | | |
| Automatic backup frequency and retention | *record from Dashboard → Database → Backups* | | |
| Point-in-time recovery available | *yes/no per plan* | | |
| Recovery point objective (RPO) | *agree with the business* | | |
| Recovery time objective (RTO) | *agree with the business* | | |

These four rows are the only part of this runbook nobody in the codebase can
answer: backup retention and PITR availability depend on the Supabase plan,
which is visible only to the project owner in billing. Fill them in and date
them. Until they are filled in, the company does not know how much accounting
data it can lose.

## 3. Recovery procedure

1. **Stop writes.** Suspend the Vercel deployment or put the app in maintenance
   so no new postings land in a database you are about to replace.
2. **Pick the recovery point.** Dashboard → Database → Backups. For PITR choose
   the timestamp just before the incident; for a daily backup choose the most
   recent one that predates it.
3. **Restore.** Follow the dashboard restore flow. Note the target: an in-place
   restore overwrites the current database; a restore into a new project leaves
   the damaged one available for investigation. Prefer a new project when the
   cause is unknown.
4. **Re-point the application** if you restored into a new project: update
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_URL` in Vercel and in
   `.env.local`, then redeploy.
5. **Re-apply any migration** newer than the recovery point. `acc_schema_migrations`
   in the restored database tells you where it stands; the repository's
   `supabase/migrations/` tells you where it should be. Apply the difference in
   filename order.
6. **Verify** — section 4. Do not reopen the application to users first.
7. **Resume writes** and record the incident in the drill log.

## 4. Verifying a restored database

Take the most recent export archive from *before* the incident and compare its
manifest against the restored database.

```bash
cd ctyhp-accounting
node --env-file=.env.local -e "
const b=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
const h={apikey:k,Authorization:'Bearer '+k,'Content-Type':'application/json'};
const post=(fn,body)=>fetch(b+'/rest/v1/rpc/'+fn,{method:'POST',headers:h,body:JSON.stringify(body)}).then(r=>r.json());
(async()=>{
 const asOf = process.argv[1];            // pass controlTotalsAsOf from the manifest
 const tb = await post('acc_ledger_balances',{p_from:'1900-01-01',p_to:asOf});
 const ar = await post('acc_ar_ageing',{p_as_of:asOf});
 const ap = await post('acc_ap_ageing',{p_as_of:asOf});
 const sum=(rows,f)=>rows.reduce((s,x)=>s+Number(x[f]||0),0);
 console.log('trialBalanceDebitMinor ', sum(tb,'debit_base'));
 console.log('trialBalanceCreditMinor', sum(tb,'credit_base'));
 console.log('arTotalMinor           ', sum(ar,'balance_minor'));
 console.log('apTotalMinor           ', sum(ap,'balance_minor'));
})();" 2026-07-29
```

Journal line count:

```bash
curl -s -I -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: count=exact" \
  "$URL/rest/v1/acc_journal_line?select=id&limit=1" | grep -i content-range
```

**Use the manifest's `controlTotalsAsOf` date, not today's date.** Reported
balances exclude entries dated after the reporting date, and this company has
future-dated entries — on 2026-07-29 the trial balance read 24,606,460 as of
that day and 24,625,360 with no date ceiling. Comparing across two different
dates produces a difference that looks like data loss and is not.

All five figures must match. If they do not:

- **Trial balance differs**: postings are missing or duplicated. Do not reopen
  the app. Restore from an earlier point.
- **AR or AP differs but the trial balance matches**: the subledger and the
  control account disagree — investigate allocations before reopening.
- **Journal line count differs but every money figure matches**: usually void
  entries, which stay in history by design. Confirm the extra lines belong to
  voided entries before accepting.

Then check attachments: `attachments.csv` lists every file with its storage
path and sha256. Object storage is restored separately from the database, so
confirm a sample of paths still resolves in the Storage browser.

### 4a. Restoring one company beside the running books

When one company's books are wrong and the rest of the database is healthy, a
Supabase restore is the wrong tool — it would replace every company to rescue
one. Instead:

1. **Settings → Backups** in the affected company. Pick the last snapshot before
   the damage. A row marked *skipped* means the books had not changed that day,
   so the figures are the ones in the row above it.
2. **Restore as new company.** The running company is not written to.
3. Read the control-total result the restore reports. All five figures matching
   is the evidence the copy is faithful; a mismatch names the figure and both
   values.
4. Open the same report on both companies and compare. The difference tells you
   which account moved and by how much — which is the question an incident
   actually asks.
5. Correct the running books with a journal entry. Do not delete and re-import:
   the restored copy is evidence, and a closed period cannot be edited anyway.

The restored company holds vendor tax profiles. Delete it when the comparison is
done, and treat it as tax records until then.

## 5. Drill cadence

Run a verification drill quarterly and after any migration that adds a table.
A drill is: take a fresh export, compare its manifest against the live database
using section 4, and record the result below. A full restore-into-a-new-project
drill should run at least once a year — a same-company restore (section 4a) run
against a real sample company satisfies this without touching Supabase itself.

The comparison is automated as an end-to-end test:

```bash
cd ctyhp-accounting && npm run test:e2e:document-ledger-report -- company-export
```

It packages the real company, unzips the archive, re-reads the ledger
independently, checks every file checksum, and proves no taxpayer identifier
appears outside `sensitive/`.

## 6. Drill log

| Date | Performed by | Method | Result | Notes |
|---|---|---|---|---|
| 2026-07-29 | Accounting operations | Export manifest verified against the live database (`company-export` end-to-end test) | **Pass** | 66 tables, 957 rows, 72.8 KiB. Control totals as of 2026-07-29: trial balance 24,606,460 debit = 24,606,460 credit; AR 850,548; AP 1,586,500; 152 journal lines. Every file checksum matched; no TIN found outside `sensitive/`. Full restore into a new project not yet exercised. |

The first entry verifies the export and the comparison procedure, not a
recovery. Section 2 is still blank and a restore has not been performed, so
recovery itself remains unproven — that is the next drill.
