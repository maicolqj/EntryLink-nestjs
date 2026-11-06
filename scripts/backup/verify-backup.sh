#!/usr/bin/env bash
#
# Verificación semanal del respaldo (timer `entrylink-backup-verify.timer`).
#
# Descarga el último dump de daily/, comprueba su sha256, lo restaura en una
# base temporal `restore_check` del mismo contenedor y compara la cantidad de
# tablas con datos del índice contra las tablas restauradas. Borra la base
# temporal al final, pase lo que pase. Nunca toca la base productiva.
#
# Variables: ver lib.sh. HEALTHCHECK_VERIFY_URL es el monitor de esta tarea.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$DIR/lib.sh"

HEALTHCHECK_URL="${HEALTHCHECK_VERIFY_URL:-}"
RESTORE_DB="restore_check"

require_vars PG_CONTAINER R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY R2_BACKUP_BUCKET
[ -n "${S3_ENDPOINT:-}" ] || require_vars R2_ACCOUNT_ID

work="$(mktemp -d)"
cleanup() {
  pg_in "dropdb -U \"\$POSTGRES_USER\" --if-exists $RESTORE_DB" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
trap 'healthcheck /fail; log "VERIFICACIÓN FALLIDA"' ERR

latest="$(aws_s3 ls "s3://${R2_BACKUP_BUCKET}/daily/" \
  | awk '{print $4}' | grep -E '^entrylink-.*\.dump$' | sort | tail -n 1 || true)"
if [ -z "$latest" ]; then
  log "ERROR: no hay ningún respaldo en daily/"
  false
fi
log "último respaldo: $latest"

aws_s3 cp "s3://${R2_BACKUP_BUCKET}/daily/$latest" - > "$work/$latest"
aws_s3 cp "s3://${R2_BACKUP_BUCKET}/daily/$latest.sha256" - > "$work/$latest.sha256"
(cd "$work" && sha256sum -c "$latest.sha256" >/dev/null)
log "sha256 correcto"

# Espacio: la restauración ocupa más o menos lo mismo que la base.
log "disco del host: $(df -h / | awk 'NR==2 {print $4 " libres"}')"

expected="$(pg_in 'pg_restore --list' < "$work/$latest" | grep -c 'TABLE DATA' || true)"

pg_in "dropdb -U \"\$POSTGRES_USER\" --if-exists $RESTORE_DB && createdb -U \"\$POSTGRES_USER\" $RESTORE_DB"
start=$(date +%s)
pg_in "pg_restore -U \"\$POSTGRES_USER\" -d $RESTORE_DB --no-owner --no-privileges --exit-on-error" < "$work/$latest"
secs=$(( $(date +%s) - start ))

restored="$(pg_in "psql -U \"\$POSTGRES_USER\" -d $RESTORE_DB -At -c \"SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')\"")"
log "restaurado en ${secs}s: ${restored} tablas (el índice trae ${expected} con datos)"

if [ "${restored:-0}" -lt "${expected:-1}" ]; then
  log "ERROR: se restauraron menos tablas de las esperadas"
  false
fi

healthcheck ""
log "VERIFICACIÓN OK: $latest (RTO de la restauración ≈ ${secs}s)"
