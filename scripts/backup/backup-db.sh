#!/usr/bin/env bash
#
# Respaldo diario de Postgres → Cloudflare R2. Corre en el HOST del VPS
# (timer de systemd `entrylink-backup.timer`), no dentro de la API: la imagen
# de la API no trae bash, ni docker, ni esta carpeta.
#
# 1. pg_dump -Fc dentro del contenedor de Postgres.
# 2. pg_restore --list del dump: si el índice no se lee, no se sube y falla.
# 3. sha256 del dump; se suben los dos a daily/, y los domingos a weekly/ y el
#    día 1 a monthly/.
# 4. Retención: 14 diarios, 8 semanales, 6 mensuales.
# 5. Ping al monitor (HEALTHCHECK_URL) al terminar; /fail si algo falló.
#
# Variables: ver lib.sh. Uso: backup-db.sh (sin argumentos).

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$DIR/lib.sh"

KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-6}"

require_vars PG_CONTAINER R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY R2_BACKUP_BUCKET
[ -n "${S3_ENDPOINT:-}" ] || require_vars R2_ACCOUNT_ID

trap 'healthcheck /fail; log "RESPALDO FALLIDO"' ERR

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
name="entrylink-${stamp}.dump"
dump="$work/$name"

log "pg_dump desde ${PG_CONTAINER}…"
# shellcheck disable=SC2016 # se expanden dentro del contenedor, no aquí
pg_in 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$dump"
size="$(du -h "$dump" | cut -f1)"

# Integridad: el índice tiene que leerse completo y traer datos.
tables="$(pg_in 'pg_restore --list' < "$dump" | grep -c 'TABLE DATA' || true)"
if [ "${tables:-0}" -lt 1 ]; then
  log "ERROR: el dump no trae ninguna TABLE DATA"
  false
fi

(cd "$work" && sha256sum "$name" > "$name.sha256")
log "dump ${size}, ${tables} tablas con datos, sha256 $(cut -c1-12 "$work/$name.sha256")…"

upload() {
  # $1: prefijo (daily|weekly|monthly)
  aws_s3 cp - "s3://${R2_BACKUP_BUCKET}/$1/${name}" < "$dump" >/dev/null
  aws_s3 cp - "s3://${R2_BACKUP_BUCKET}/$1/${name}.sha256" < "$dump.sha256" >/dev/null
  log "subido a $1/"
}

upload daily
[ "$(date -u +%u)" = "7" ] && upload weekly
[ "$(date -u +%d)" = "01" ] && upload monthly

# Retención: los nombres llevan la fecha UTC, así que ordenar por nombre es
# ordenar por fecha. Se conservan los N más nuevos de cada nivel.
prune() {
  # $1: prefijo, $2: cuántos conservar
  local old
  old="$(aws_s3 ls "s3://${R2_BACKUP_BUCKET}/$1/" \
    | awk '{print $4}' | grep -E '^entrylink-.*\.dump$' | sort -r | tail -n +"$(( $2 + 1 ))" || true)"
  for f in $old; do
    aws_s3 rm "s3://${R2_BACKUP_BUCKET}/$1/$f" >/dev/null
    aws_s3 rm "s3://${R2_BACKUP_BUCKET}/$1/$f.sha256" >/dev/null || true
    log "retención: borrado $1/$f"
  done
}

prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"
prune monthly "$KEEP_MONTHLY"

healthcheck ""
log "RESPALDO OK: ${name}"
