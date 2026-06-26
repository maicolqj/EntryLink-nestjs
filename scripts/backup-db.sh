#!/usr/bin/env bash
#
# Respaldo de Postgres -> Cloudflare R2, ejecutado DENTRO del VPS.
#
# Hace pg_dump vía `docker exec` sobre el contenedor de Postgres (misma versión
# del motor, sin exponer el puerto a internet) y sube el dump comprimido a R2
# usando la imagen oficial de aws-cli. Pensado para correr como Scheduled Task
# de Coolify o entrada de cron del host.
#
# Variables de entorno requeridas (Coolify ya inyecta las de R2 y la BD):
#   DB_USERNAME           usuario de Postgres
#   DB_NAME               nombre de la base de datos
#   PASSDB_POSTGRES       password de Postgres
#   R2_ACCOUNT_ID         account id de Cloudflare (para el endpoint S3)
#   R2_ACCESS_KEY_ID      access key de R2
#   R2_SECRET_ACCESS_KEY  secret key de R2
#   R2_BACKUP_BUCKET      bucket destino de los respaldos (separado del de archivos)
#
# Variables opcionales:
#   PG_CONTAINER          nombre del contenedor Postgres (default: entrylink-postgres)
#   RETENTION_DAYS        días a conservar en R2 (default: 30)
#
# Uso:
#   ./scripts/backup-db.sh
#
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-entrylink-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

for var in DB_USERNAME DB_NAME PASSDB_POSTGRES R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BACKUP_BUCKET; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: falta la variable de entorno $var" >&2
    exit 1
  fi
done

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
file="residash-${stamp}.sql.gz"
tmp="$(mktemp -d)/${file}"
trap 'rm -rf "$(dirname "$tmp")"' EXIT

echo "[backup] generando dump de '${DB_NAME}' desde ${PG_CONTAINER}..."
docker exec -e PGPASSWORD="$PASSDB_POSTGRES" "$PG_CONTAINER" \
  pg_dump --no-owner --no-privileges -U "$DB_USERNAME" -d "$DB_NAME" \
  | gzip -9 > "$tmp"
echo "[backup] dump generado: $(du -h "$tmp" | cut -f1)"

run_aws() {
  docker run --rm \
    -v "$(dirname "$tmp"):/data" \
    -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    -e AWS_DEFAULT_REGION=auto \
    amazon/aws-cli:latest \
    --endpoint-url "$ENDPOINT" "$@"
}

echo "[backup] subiendo a s3://${R2_BACKUP_BUCKET}/daily/${file}..."
run_aws s3 cp "/data/${file}" "s3://${R2_BACKUP_BUCKET}/daily/${file}"

echo "[backup] purgando respaldos con más de ${RETENTION_DAYS} días..."
cutoff="$(date -u -d "${RETENTION_DAYS} days ago" +%Y-%m-%d)"
run_aws s3 ls "s3://${R2_BACKUP_BUCKET}/daily/" | while read -r d _ _ name; do
  if [ -n "$name" ] && [ "$d" \< "$cutoff" ]; then
    echo "[backup]   borrando $name (${d})"
    run_aws s3 rm "s3://${R2_BACKUP_BUCKET}/daily/${name}" || true
  fi
done

echo "[backup] completado: ${file}"
