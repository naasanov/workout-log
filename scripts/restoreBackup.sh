#!/usr/bin/env bash
# Restore an encrypted backup into a NEW schema on the LOCAL dev MySQL only.
#
# Usage: scripts/restoreBackup.sh <file.sql.gz.cms | r2-key> [target_db]
#
# An argument that is not an existing local file is treated as an R2 object key
# (e.g. daily/workout-log-2026-10-18T0817Z.sql.gz.cms) and downloaded with the aws CLI.
# Download needs: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (bucket
# workout-log-db-backups, overridable with BACKUP_BUCKET).
#
# Env: BACKUP_KEY   private key path (default ~/.config/workout-log-backup/backup-key.pem)
#      DB_HOST      must be 127.0.0.1 or localhost (default 127.0.0.1)
#      DB_PORT      default 3307
#      DB_USERNAME / DB_PASSWORD  need CREATE on the target schema (default root/root)
set -euo pipefail

input="${1:-}"
target="${2:-workout_log_restore}"
if [ -z "$input" ]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

host="${DB_HOST:-127.0.0.1}"
port="${DB_PORT:-3307}"
user="${DB_USERNAME:-root}"
export MYSQL_PWD="${DB_PASSWORD:-root}"
key="${BACKUP_KEY:-$HOME/.config/workout-log-backup/backup-key.pem}"
bucket="${BACKUP_BUCKET:-workout-log-db-backups}"

case "$host" in
  127.0.0.1|localhost) ;;
  *) echo "Refusing to restore to host '$host': local dev MySQL only." >&2; exit 1 ;;
esac
case "$target" in
  *restore*) ;;
  *) echo "Refusing target schema '$target': name must contain 'restore'." >&2; exit 1 ;;
esac
if ! [[ "$target" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "Target schema may only contain letters, digits, and underscores." >&2; exit 1
fi
[ -r "$key" ] || { echo "Private key not found at $key (set BACKUP_KEY)." >&2; exit 1; }

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

if [ -f "$input" ]; then
  encrypted="$input"
else
  : "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}" "${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}" \
    "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}"
  encrypted="$workdir/backup.sql.gz.cms"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    aws s3 cp "s3://${bucket}/${input}" "$encrypted" \
    --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi

mysql_cmd=(mysql -h "$host" -P "$port" -u "$user")

echo "Creating schema $target on $host:$port"
"${mysql_cmd[@]}" -e "DROP DATABASE IF EXISTS \`$target\`; CREATE DATABASE \`$target\`;"

echo "Decrypting and loading"
openssl cms -decrypt -binary -inform DER -inkey "$key" -in "$encrypted" \
  | gunzip -c \
  | "${mysql_cmd[@]}" "$target"

echo "Row counts in $target:"
for table in users sections movements variations variation_history body_weight food_entries habit_tallies; do
  count=$("${mysql_cmd[@]}" -N -B "$target" -e "SELECT COUNT(*) FROM \`$table\`" 2>/dev/null || echo "n/a")
  printf '  %-20s %s\n' "$table" "$count"
done
echo "Done. Drop with: mysql -h $host -P $port -u $user -e 'DROP DATABASE \`$target\`'"
