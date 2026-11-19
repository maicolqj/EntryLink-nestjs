#!/usr/bin/env bash
# Funciones comunes de backup-db.sh y verify-backup.sh. Se carga con `source`.
#
# Variables (las carga el .service desde /root/.entrylink-backup.env):
#   PG_CONTAINER                 contenedor de Postgres (docker ps)
#   R2_ACCOUNT_ID                cuenta de Cloudflare (endpoint S3)
#   R2_BACKUP_ACCESS_KEY_ID      llave PROPIA del respaldo (no la de la API)
#   R2_BACKUP_SECRET_ACCESS_KEY
#   R2_BACKUP_BUCKET             bucket solo para respaldos
# Opcionales:
#   HEALTHCHECK_URL              ping al terminar bien; <url>/fail al fallar
#   S3_ENDPOINT                  otro endpoint S3 (pruebas con MinIO)
#   AWS_CLI_IMAGE                imagen de aws-cli (fijada por versión)
#   AWS_DOCKER_NETWORK           red de docker para aws-cli (default: host)

set -Eeuo pipefail

AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.17.0}"

# A stderr: el trap de error puede correr con stdout redirigido al dump.
log() { echo "[$(date -u +%H:%M:%SZ)] $*" >&2; }

require_vars() {
  local missing=0 var
  for var in "$@"; do
    if [ -z "${!var:-}" ]; then
      echo "ERROR: falta la variable $var" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

s3_endpoint() {
  echo "${S3_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
}

# aws-cli en un contenedor efímero. Las llaves van por el entorno (`-e NOMBRE`
# sin valor), nunca en la línea de comandos: así no aparecen en `ps`. Los
# archivos entran y salen por stdin/stdout, sin montar carpetas del host.
aws_s3() {
  AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY" \
  docker run --rm -i --network "${AWS_DOCKER_NETWORK:-host}" \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
    -e AWS_DEFAULT_REGION=auto \
    "$AWS_CLI_IMAGE" --endpoint-url "$(s3_endpoint)" s3 "$@"
}

# psql / pg_* dentro del contenedor de Postgres, con su propio usuario. Las
# variables POSTGRES_USER/POSTGRES_DB existen DENTRO del contenedor, no en el
# shell del host; por eso van entre comillas simples.
pg_in() {
  docker exec -i "$PG_CONTAINER" sh -c "$1"
}

healthcheck() {
  # $1: "" (éxito) o "/fail"
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL}$1" >/dev/null || true
}
