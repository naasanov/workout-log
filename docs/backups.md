# Database backups

## What runs

`.github/workflows/db-backup.yml` runs nightly at 08:17 UTC (and on demand via
`workflow_dispatch`). It dumps the production JawsDB MySQL database with `mysqldump`,
gzips it, checks the dump is complete (`CREATE TABLE` for `food_entries` and the
trailing `-- Dump completed` line), encrypts it to a public certificate with
`openssl cms`, and uploads it to Cloudflare R2. The plaintext never leaves the runner.
Any failure fails the run, and GitHub emails the repo owner.

Secrets: `JAWSDB_URL`, `BACKUP_CERT_PEM`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`. The bucket name is `BACKUP_BUCKET` in the workflow `env`.

## Where files land

Bucket `workout-log-db-backups`, file `workout-log-YYYY-MM-DDTHHMMZ.sql.gz.cms`:

- `daily/<file>` every run
- `monthly/<file>` additionally on the 1st of the month (UTC)

Retention is an R2 lifecycle rule on the bucket, not code: `daily/` 30 days,
`monthly/` 365 days.

## The private key

The matching private key lives only at `~/.config/workout-log-backup/backup-key.pem`
on the owner's machine. It must also be saved in a password manager. Losing it makes
every backup unreadable, and the repo and bucket hold only the public certificate.

## Restore

`scripts/restoreBackup.sh <file.sql.gz.cms | r2-key> [target_db]` decrypts, gunzips,
and loads into a new schema on the local dev MySQL (`docker compose up -d`,
127.0.0.1:3307). The default target is `workout_log_restore`; names without `restore`
and hosts other than 127.0.0.1/localhost are refused, so the dev DB is never touched.

```
# local file
scripts/restoreBackup.sh ~/Downloads/workout-log-2026-10-18T0817Z.sql.gz.cms

# straight from R2 (needs the aws CLI)
export R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
scripts/restoreBackup.sh daily/workout-log-2026-10-18T0817Z.sql.gz.cms
```

Set `BACKUP_KEY` to use a key somewhere other than the default path. Row counts for
key tables are printed afterwards. Drop the schema when done.

Manual decrypt: `openssl cms -decrypt -binary -inform DER -inkey backup-key.pem -in x.cms | gunzip > dump.sql`.
