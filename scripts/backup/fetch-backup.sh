#!/usr/bin/env bash
#
# Baja un respaldo de R2 y comprueba su sha256. No restaura nada.
#
#   fetch-backup.sh                       lista los últimos respaldos de daily/
#   fetch-backup.sh daily/<archivo>.dump  lo baja a /root/restore.dump
#
# Lee las llaves de /root/.entrylink-backup.env (sin mostrarlas).

set -a
# shellcheck source=/dev/null
. /root/.entrylink-backup.env
set +a
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$DIR/lib.sh"

if [ -z "${1:-}" ]; then
  aws_s3 ls "s3://${R2_BACKUP_BUCKET}/daily/" | grep '\.dump$' | tail -n 15
  exit 0
fi

out=/root/restore.dump
aws_s3 cp "s3://${R2_BACKUP_BUCKET}/$1" - > "$out"
aws_s3 cp "s3://${R2_BACKUP_BUCKET}/$1.sha256" - | sed "s#  .*#  $out#" | sha256sum -c
chmod 600 "$out"
log "listo: $out ($(du -h "$out" | cut -f1)). Tiene datos personales: bórralo al terminar."
