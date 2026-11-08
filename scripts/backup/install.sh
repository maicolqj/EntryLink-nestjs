#!/usr/bin/env bash
#
# Instala el respaldo automático en el host del VPS. Correr como root desde la
# carpeta copiada (scp -r scripts/backup root@<vps>:/root/entrylink-backup-src).
# Idempotente: se puede volver a correr para actualizar los scripts.
#
#   bash install.sh          instala scripts, units y la plantilla del .env
#   bash install.sh --enable además activa los dos timers (cuando el .env ya está)

set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST=/opt/entrylink-backup
ENV_FILE=/root/.entrylink-backup.env

[ "$(id -u)" -eq 0 ] || { echo "Correr como root" >&2; exit 1; }
command -v docker >/dev/null || { echo "Falta docker en el host" >&2; exit 1; }
command -v curl >/dev/null || { echo "Falta curl en el host" >&2; exit 1; }

install -d -m 700 "$DEST"
install -m 700 "$SRC/lib.sh" "$SRC/backup-db.sh" "$SRC/verify-backup.sh" "$SRC/fetch-backup.sh" "$DEST/"
install -m 644 "$SRC"/systemd/entrylink-backup*.{service,timer} /etc/systemd/system/

if [ ! -f "$ENV_FILE" ]; then
  install -m 600 "$SRC/entrylink-backup.env.example" "$ENV_FILE"
  echo "Creado $ENV_FILE: llénalo con nano y vuelve a correr con --enable"
fi
chmod 600 "$ENV_FILE"

systemctl daemon-reload

if [ "${1:-}" = "--enable" ]; then
  systemctl enable --now entrylink-backup.timer entrylink-backup-verify.timer
  systemctl list-timers 'entrylink-backup*' --no-pager
fi
echo "Listo. Primera corrida a mano: systemctl start entrylink-backup.service && journalctl -u entrylink-backup.service -n 30 --no-pager"
