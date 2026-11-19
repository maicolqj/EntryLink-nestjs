# Respaldo automático de PostgreSQL

Corre en el **host del VPS** con timers de systemd. No corre dentro de la API (la imagen no trae `bash`, `docker` ni `scripts/`) ni como Scheduled Task de Coolify. La base `entrylink-postgres` no es un recurso «Database» de Coolify, así que el respaldo integrado de Coolify tampoco la cubre.

| Qué | Cuándo (UTC) | Hora en Bogotá | Script |
|---|---|---|---|
| Respaldo: `pg_dump -Fc`, `pg_restore --list`, sha256 y subida a R2 | todos los días, 08:15 | 03:15 | `scripts/backup/backup-db.sh` |
| Verificación: baja el último dump, revisa el sha256, lo restaura en `restore_check` y cuenta tablas | domingos, 09:15 | 04:15 | `scripts/backup/verify-backup.sh` |

- **Destino:** `s3://<R2_BACKUP_BUCKET>/{daily,weekly,monthly}/entrylink-<UTC>.dump` + `.sha256`. Los domingos se copia también a `weekly/` y el día 1 a `monthly/`.
- **Retención:** 14 diarios, 8 semanales y 6 mensuales (`KEEP_*` en el `.env`).
- **Alertas:** un *ping* a Healthchecks.io al terminar bien, y `/fail` cuando algo falla. Si el ping no llega, Healthchecks avisa por correo.
- **Llaves:** token de R2 **propio** del respaldo, con acceso solo al bucket de respaldos. No es el de la API. Las llaves van por el entorno, así que no aparecen en `ps`.
- **RPO:** 24 h. **RTO:** el que mide la verificación de cada domingo (sale en el log), más el reinicio de la API.

## Instalación (una sola vez)

### 1. Cloudflare R2 (panel, lo hace el usuario)
1. R2 → **Create bucket** `entrylink-backups` (privado, sin dominio público).
2. R2 → **Manage API tokens** → **Create API token**:
   - nombre `entrylink-backup-2026-11`;
   - permiso **Object Read & Write**;
   - **Apply to specific buckets only** → `entrylink-backups`.

   Copia el Access Key ID y el Secret **directo al `.env` del VPS** (paso 4). Nunca los pegues en un chat ni en un archivo del repositorio.
3. Opcional (recomendado): en el bucket, una regla de **Bucket lock** de 7 días sobre el prefijo `daily/`, para que una llave filtrada no pueda borrar la última semana.

### 2. Healthchecks.io (opcional, recomendado)
Crea dos chequeos y copia sus URL de ping:
- «EntryLink respaldo»: periodo de 1 día, gracia de 2 h;
- «EntryLink verificación»: periodo de 7 días, gracia de 6 h.

### 3. Copiar los scripts al VPS (desde el PC)
```powershell
scp -r scripts/backup root@<IP_DEL_VPS>:/root/entrylink-backup-src
```

### 4. Instalar (en el VPS, como root)
```bash
bash /root/entrylink-backup-src/install.sh          # crea /root/.entrylink-backup.env (600)
docker ps --format '{{.Names}}  {{.Image}}' | grep -i postgis   # nombre para PG_CONTAINER
df -h /                                              # espacio para una copia temporal de la base
nano /root/.entrylink-backup.env                     # llenar los valores (paso 1 y 2)
bash /root/entrylink-backup-src/install.sh --enable  # activa los dos timers
```

### 5. Primera corrida a mano (también sirve de respaldo previo a un despliegue)
```bash
systemctl start entrylink-backup.service
journalctl -u entrylink-backup.service -n 30 --no-pager     # debe terminar en «RESPALDO OK: …»
systemctl start entrylink-backup-verify.service
journalctl -u entrylink-backup-verify.service -n 30 --no-pager  # «VERIFICACIÓN OK: … (RTO ≈ Ns)»
systemctl list-timers 'entrylink-backup*' --no-pager
```

## Operación

| Qué | Comando |
|---|---|
| Ver la última corrida | `journalctl -u entrylink-backup.service -n 50 --no-pager` |
| Respaldo manual antes de una migración | `systemctl start entrylink-backup.service` (el `respaldo manual verificado` de `05` §2 sigue valiendo) |
| Actualizar los scripts | repetir el paso 3 y `bash install.sh` |
| Pausar | `systemctl disable --now entrylink-backup.timer entrylink-backup-verify.timer` |

## Restaurar

```bash
# 1. Ver los últimos y bajar el elegido (comprueba el sha256)
/opt/entrylink-backup/fetch-backup.sh
/opt/entrylink-backup/fetch-backup.sh daily/<archivo>.dump        # → /root/restore.dump

# 2. Probar SIEMPRE primero en una base aparte (<ctr> = PG_CONTAINER)
docker exec <ctr> sh -c 'createdb -U "$POSTGRES_USER" restore_check'
docker exec -i <ctr> sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner --exit-on-error' < /root/restore.dump
```

Restaurar **sobre la base productiva** reemplaza todo lo escrito después del respaldo. Solo se hace con orden expresa: detener la API en Coolify, usar `pg_restore --clean --if-exists` sobre `$POSTGRES_DB` y volver a arrancar la API. Antes de eso, intentar el rollback de imagen o el revert de la migración (`INTEGRACION-GROWTH/05` §4).

El `.dump` tiene datos personales: bórralo del VPS (`rm /root/restore.dump*`) apenas deje de servir.
