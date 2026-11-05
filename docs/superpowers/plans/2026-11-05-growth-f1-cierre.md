# F1 — Cierre de seguridad e infraestructura (plan verificable)

_2026-11-05 · Deriva de `specs/2026-11-05-growth-auditoria-integral.md` §8, aprobada por el usuario: modelo único, puerto único, orden F1 → F2 → F3._
_Este documento **no autoriza** fusiones, despliegues, migraciones ni SQL de escritura: cada paso marcado 🔒 necesita orden expresa._

---

## 1. Detalle de los PR #297, #298 y #299

Verificado el 2026-11-05: los tres en **borrador**, base `main`, `mergeStateStatus = CLEAN`, CI `quality` + `integration` en **verde**.

### 1.1 #297 — `RESIDENT_ROL` duplicado (0.42.13, `8b1129f`, +206/−39)

| | |
|---|---|
| **Objetivo** | Producción tiene dos filas `RESIDENT_ROL`: la del seed (`d8e9f0a1-…1f2c`, 75 usuarios) y una vacía («Usuario», `cad6ca58-…8f05`). Cuatro lugares la buscan por nombre sin orden y pueden recibir la vacía: un residente nuevo quedaría **sin permisos**, sin ningún error |
| **Archivos** | `roles/utils/resident-base-role.util.ts` (nuevo `findResidentRole`, `RESIDENT_ROLE_ID`) · `roles/roles.service.ts` (`onModuleInit` ya no crea la fila «Usuario») · `residents/services/residents.service.ts`, `residents-import.service.ts`, `users/services/excel-import.service.ts` (usan el helper) · `seeds/datas/roles.data.seed.ts` (id desde la constante) · migración `1781011700000-DeactivateDuplicateResidentRole.ts` · 3 specs · `package.json` |
| **Migración** | **Sí**, la única de los tres PR. `UPDATE roles SET status = false` (+ `frontName` y `metadata` con el estado anterior), solo sobre filas `RESIDENT_ROL` distintas de la del seed **sin** usuarios, permisos ni hijos, y solo si existe la del seed. No borra nada. El `down` restaura estado y nombre desde `metadata` |
| **Dependencias** | Respaldo verificado previo (F1-1). Ninguna dependencia de código con #298 ni #299 |
| **Pruebas** | Unitarias 1258/1259 (la que falla es la intermitente de #299). `find-resident-role.util.spec.ts`: la fila del seed gana aunque la otra sea más antigua. SQL `up` y `down` probado en Postgres 17 con 3 filas. `integration` del CI: migraciones desde cero + rollback |
| **Después de desplegar** | La migración corre sola al arrancar el contenedor (≈ 30 s de 503 en el cambio). `/health` = 0.42.13. La fila vacía queda «Residente (duplicado sin uso)», `status = f`. Los residentes existentes no cambian: ya tienen el rol del seed. Las altas nuevas siempre reciben el del seed |
| **Rollback** | Imagen anterior (`sha-63d22bb`, 0.42.12) **y** `migration:revert` dentro del contenedor. También sirve dejar la migración aplicada: la imagen vieja ignora una migración que no conoce, y la fila inactiva no le afecta |
| **Fuera de alcance** | «Residente» tiene 3 permisos en producción y el seed define 18. **No se toca aquí** (cambiaría lo que pueden hacer 75 usuarios) |

### 1.2 #298 — Respaldo automático (0.42.14, `d75e8b8`, +415/−80)

| | |
|---|---|
| **Objetivo** | Hoy **no hay ningún respaldo automático**. Lo agrega en el **host** del VPS, con systemd |
| **Archivos** | `scripts/backup/` (`lib.sh`, `backup-db.sh`, `verify-backup.sh`, `fetch-backup.sh`, `install.sh`, `entrylink-backup.env.example`, `systemd/*.service` y `*.timer`) · borra `scripts/backup-db.sh` (el viejo) · `docs/RESPALDO-AUTOMATICO.md` · `docs/R2-CREDENCIALES.md` · `.gitattributes` (LF) · `package.json` |
| **Migración** | No |
| **Dependencias** | El usuario: bucket y token de R2 propios, Healthchecks (opcional) y acceso al VPS. **No depende de fusionarse**: se instala desde la rama |
| **Pruebas** | Local, con Postgres 17 + S3Mock: 3 respaldos con retención, verificación con restauración, contenedor inexistente / variable faltante / dump corrupto ⇒ código 1 + aviso. `shellcheck` limpio. **Falta la prueba real en el VPS** (§2) |
| **Después de fusionar** | La API **no cambia** (los scripts no van en la imagen), pero el merge construye y despliega la imagen 0.42.14: unos 30 s de 503. El respaldo corre por el timer del host, no por el despliegue |
| **Rollback** | `systemctl disable --now entrylink-backup.timer entrylink-backup-verify.timer` |

### 1.3 #299 — Pruebas intermitentes (0.42.15, `183d2c6`, +39/−4)

| | |
|---|---|
| **Objetivo** | Que `resident-device`, `data-export` y `resident-tenancy` dejen de fallar por timeout cuando la suite corre con carga |
| **Archivos** | Los 3 specs y `package.json`. **No toca código de la app** |
| **Migración** | No |
| **Pruebas** | Estrés: 1257/1257 (una corrida doble y una con `--maxWorkers=100%`). Una prueba nueva fija que producción siga en 12 rondas de bcrypt o más |
| **Después de fusionar** | El comportamiento no cambia. El merge despliega la imagen 0.42.15 (unos 30 s de 503) |

### 1.4 Orden y trampa de versiones

- Los tres parten de 0.42.12 y suben `package.json` a 0.42.13, 0.42.14 y 0.42.15. **Después de fusionar el primero, los otros dos quedan en conflicto en la línea de versión.** Hay dos salidas:
  - (a) 🔒 rebasar cada uno sobre el `main` nuevo con *force push*, que el modo automático bloquea y requiere autorización rama por rama;
  - (b) resolver el conflicto en la web de GitHub, que crea un merge commit en la rama sin forzar.
- **Orden:** #297 → #298 → #299, uno por vez, verificando `/health.version` antes de seguir.
- Opción más barata: como #298 y #299 no cambian el comportamiento, se pueden **juntar en un solo despliegue**. Se fusiona #298, se rebasa #299 sobre él y se despliega una vez. Así hay un solo corte de 30 s en vez de dos.

---

## 2. Procedimiento: instalar y verificar el respaldo automático (F1-1)

Guía operativa completa: `docs/RESPALDO-AUTOMATICO.md` (rama de #298). Aquí, el **guion con evidencia**. Las marcas: 👤 lo hace el usuario · 🔒 toca producción.

### 2.1 Preparación (sin tocar producción)
1. 👤 **Cloudflare R2:**
   - bucket `entrylink-backups`, privado;
   - token `entrylink-backup-2026-11`: *Object Read & Write*, **solo** ese bucket.

   Las llaves van **directo** al `.env` del VPS en el paso 2.4. Nunca por chat.
2. 👤 **Healthchecks.io:** chequeo «respaldo» (cada 1 día, 2 h de gracia) y «verificación» (cada 7 días, 6 h de gracia).
3. 👤 **Desde el PC:**
   ```powershell
   scp -r C:\Users\maico\Apps\BACKEND\phone-dialer-nestjs-ci2\scripts\backup root@<IP_DEL_VPS>:/root/entrylink-backup-src
   ```
   La rama tiene `.gitattributes` con LF, así que los scripts llegan sin CRLF. Antes de copiar, confirma que ese worktree está en `feat/respaldo-automatico` (`git -C … branch --show-current`).

### 2.2 Inventario previo en el VPS (solo lectura)
```bash
df -h /                                                        # E1: espacio libre
docker ps --format '{{.Names}}  {{.Image}}' | grep -i postgis  # E2: nombre del contenedor
crontab -l; ls /etc/cron.d; systemctl list-timers --all | grep -iE 'backup|respaldo'   # E3: no hay otro respaldo
docker exec <ctr> sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_size_pretty(pg_database_size(current_database()))"'  # E4: tamaño
```

### 2.3 Instalación
```bash
bash /root/entrylink-backup-src/install.sh           # crea /opt/entrylink-backup y /root/.entrylink-backup.env (600)
nano /root/.entrylink-backup.env                     # PG_CONTAINER, R2_*, HEALTHCHECK_*
stat -c '%a %U' /root/.entrylink-backup.env          # E5: «600 root»
```

### 2.4 Primera corrida a mano (🔒 lee la base de producción: un `pg_dump`, sin escritura y de bajo impacto con 33 MB)
```bash
systemctl start entrylink-backup.service
journalctl -u entrylink-backup.service -n 20 --no-pager    # E6: «… N tablas con datos …» y «RESPALDO OK: entrylink-<UTC>.dump»
/opt/entrylink-backup/fetch-backup.sh                      # E7: el archivo aparece en daily/
```

### 2.5 Restauración de prueba automática (base temporal `restore_check`, nunca la productiva)
```bash
systemctl start entrylink-backup-verify.service
journalctl -u entrylink-backup-verify.service -n 20 --no-pager   # E8: «sha256 correcto», «restaurado en Ns: X tablas», «VERIFICACIÓN OK»
docker exec <ctr> sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "select count(*) from pg_database where datname = '"'"'restore_check'"'"'"'   # E9: 0 (se borró)
```

### 2.6 Restauración de prueba con huella (una vez, la más estricta)
Compara la base productiva con la restaurada usando `INTEGRACION-GROWTH/06-verificacion-restauracion.sql`, la misma huella del ensayo del 2026-11-04. Se corre en un momento de poco uso, porque una escritura entre el dump y la huella genera diferencias en tablas que cambian solas.
```bash
/opt/entrylink-backup/fetch-backup.sh daily/<último>.dump                 # baja y comprueba el sha256
docker exec <ctr> sh -c 'createdb -U "$POSTGRES_USER" restore_check'
docker exec -i <ctr> sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner --exit-on-error' < /root/restore.dump
docker exec -i <ctr> sh -c 'psql -U "$POSTGRES_USER" -At -d "$POSTGRES_DB"' < 06-verificacion-restauracion.sql > huella-prod.txt
docker exec -i <ctr> sh -c 'psql -U "$POSTGRES_USER" -At -d restore_check' < 06-verificacion-restauracion.sql > huella-rest.txt
diff huella-prod.txt huella-rest.txt && echo "RESPALDO VERIFICADO"          # E10
docker exec <ctr> sh -c 'dropdb -U "$POSTGRES_USER" restore_check'; rm -f /root/restore.dump*
```
Si `diff` muestra diferencias, se revisan: solo se aceptan en tablas que se escriben solas (sesiones, `refresh_tokens`, `audit_logs`). Cualquier otra diferencia **detiene F1**.

### 2.7 Activación del programa
```bash
bash /root/entrylink-backup-src/install.sh --enable
systemctl list-timers 'entrylink-backup*' --no-pager      # E11: próximas corridas, diaria y dominical
```
👤 **E12:** los dos chequeos de Healthchecks en verde; **E13:** al día siguiente, un objeto nuevo en `daily/` sin intervención.

### 2.8 Evidencia que se entrega
Las salidas de E1–E13 (solo esas líneas), **sin llaves ni contenido de la base**. Con eso F1-1 queda cerrada.

### 2.9 Rollback del respaldo
`systemctl disable --now entrylink-backup.timer entrylink-backup-verify.timer`; borrar `/opt/entrylink-backup` y `/etc/systemd/system/entrylink-backup*`. No afecta a la API.

---

## 3. Plan seguro para #287 (SUPER_ADMIN sin excepciones indebidas)

### 3.1 Qué cambia #287 (verificado en la rama `39b987d`)
- **Hoy, en `main`:** el SUPER_ADMIN pasa **siempre**. Si el permiso está inactivo, solo queda una línea en el log (`universal-role-permission.guard.ts:84`). `actorHas` (Growth) hace lo mismo.
- **Con #287:**
  - un permiso **inactivo no autoriza a nadie**, tampoco al SUPER_ADMIN;
  - con el permiso **activo**, el SUPER_ADMIN pasa aunque no lo tenga en el token (no necesita roles de Growth);
  - si el **rol** SUPER_ADMIN está inactivo, tampoco pasa.
  - El estado se toma con un máximo de 30 s de caché y, si no es confiable, falla cerrado.
- **Consecuencia:** para que el SUPER_ADMIN conserve Growth basta con **activar los permisos que de verdad usa**. No hay que activar los roles de Growth, ni asignar nada a cumplimiento, ni correr el §4 completo de `ACTIVATION.md`. Ese §4 es la activación de toda la suite, que es F8.
- **Estado del PR:** `DIRTY` (conflictos con `main`) y versión 0.43.0, que hay que renumerar.

### 3.2 Por qué activar un permiso no le da nada a nadie más (hay que verificarlo, §3.3 C1–C3)
Los permisos de Growth solo están asignados a los 3 roles de Growth, que están **inactivos**, y desde #286 un rol inactivo no concede nada. No hay excepciones GRANT, y cumplimiento no tiene ninguno. Si C1–C3 lo confirman, activar un permiso cambia algo **solo** para quien tenga SUPER_ADMIN, que ya lo usa por la excepción. **El efecto en producción es nulo hasta que se despliegue #287.**

### 3.3 Pasos

| Paso | Qué | Toca producción | Evidencia |
|---|---|---|---|
| P1 | Rebasar #287 sobre `main`, resolver conflictos, renumerar (0.42.16 o la que corresponda) y CI verde | No (🔒 *force push* a la rama: necesita autorización) | CI verde, `CLEAN` |
| P2 | **Consultas de solo lectura** C1–C4 (abajo) | Lectura | Salida de cada consulta |
| P3 | **Evidencia de uso:** buscar `con permisos inactivos` en los logs de la API de los últimos 30 días y sacar la lista de permisos distintos que usó el SUPER_ADMIN | Lectura | Lista |
| P4 | **Decidir el conjunto S** de permisos a activar (§3.4); el usuario lo aprueba por escrito | No | Aprobación |
| P5 | Respaldo verificado (F1-1 ya hecho, o una corrida manual) | Lectura | `RESPALDO OK` |
| P6 | 🔒 **Activar solo S** (§3.5), en una transacción con verificación | **Sí** (escritura mínima, sin efecto visible) | Conteos de C5 |
| P7 | Esperar 24 h y volver a buscar `con permisos inactivos`: **no debe aparecer ninguno de S**. Si aparece otro permiso, volver a P4 | Lectura | Log limpio para S |
| P8 | 🔒 Fusionar #287 (`--match-head-commit`) → verificar `/health.version` | **Sí** | Versión correcta |
| P9 | **Prueba con el SUPER_ADMIN:** flujos de `/growth` (lista, ficha, validar, duplicados, importar) funcionan. Una operación **fuera de S** (de lectura, p. ej. la lista de fuentes si no está en S) responde *forbidden* | Lectura | Capturas y log |
| P10 | **Prueba negativa:** un usuario de **prueba** sin Growth no ve `/growth` ni sus operaciones | Lectura | Respuesta denegada |

**Consultas de solo lectura (P2):**
```sql
-- C1: permisos de Growth y su estado
SELECT name, status FROM public.permissions WHERE "group" = 'GROWTH' ORDER BY name;
-- C2: ¿a qué roles están asignados, y esos roles están activos?
SELECT r.name, r.status, count(*) AS permisos
  FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
 WHERE p."group" = 'GROWTH' GROUP BY r.name, r.status ORDER BY r.name;
-- C3: excepciones GRANT por usuario sobre permisos de Growth (debe ser 0)
SELECT count(*) FROM public.user_permission_overrides o JOIN public.permissions p ON p.id = o.permission_id
 WHERE p."group" = 'GROWTH' AND o.effect = 'GRANT';
-- C4: rol SUPER_ADMIN activo y quién lo tiene
SELECT r.status, count(uhr.*) AS usuarios FROM public.roles r
  LEFT JOIN public.user_has_roles uhr ON uhr.role_id = r.id
 WHERE r.name = 'SUPER_ADMIN_ROL' GROUP BY r.status;
```
Columnas de C3 confirmadas contra las entidades (`user_permission_overrides.effect` GRANT/DENY, `user_has_roles.role_id`).

### 3.4 Conjunto S propuesto (se ajusta con la evidencia de P3)
- **Activar:** lo que la interfaz de hoy necesita para operar Prospect:
  - `VIEW_GROWTH_PROSPECTS`, `VIEW_ALL_GROWTH_PROSPECTS`, `EDIT_GROWTH_PROSPECTS`;
  - `VALIDATE_GROWTH_PROSPECTS`, `MERGE_GROWTH_DUPLICATES`, `IMPORT_GROWTH_DATA`;
  - `VIEW_GROWTH_ACTIVITY`, `VIEW_GROWTH_TEAM`, `VIEW_GROWTH_SOURCES`.
- **Incluido por decisión D-2 (2026-11-05):** `VIEW_GROWTH_CONTACT_DATA` (CRITICAL: ver correos y teléfonos de contactos; su uso queda auditado).
- **Incluidos por decisión D-5 (2026-11-05), para operar la pantalla `/growth/fuentes` (web #211):** `MANAGE_GROWTH_SOURCES` (alta, edición y activación) y `REVIEW_GROWTH_SOURCES_LEGAL` (revisión jurídica con referencia). `APPROVE_GROWTH_PAID_SOURCES` **sigue fuera**: Google Places no se aprueba.
- **Solo si P3 muestra uso y el usuario lo aprueba:** `ASSIGN_GROWTH_PROSPECTS`, `MANAGE_GROWTH_SCORING`.
- **Quedan inactivos, sin excepción para nadie:**
  - `APPROVE_GROWTH_PAID_SOURCES` (gasto), `APPROVE_GROWTH_SCORING` y `MANAGE_GROWTH_IMPORT_TEMPLATES` (activación manual);
  - `LIFT_GROWTH_SUPPRESSIONS`, `MANAGE_GROWTH_PRIVACY_REQUESTS`, `MANAGE_GROWTH_LEGAL_HOLDS`, `REVIEW_GROWTH_LEGAL_BASIS`, `AUTHORIZE_GROWTH_CONTACT` y `MANAGE_GROWTH_TEAM`.
  - Se activan cuando haya pantalla y un dueño (F2-2), y quedan registrados al activarse.
- **Separación de funciones:** con #287 y `APPROVE_GROWTH_SCORING` activo, el SUPER_ADMIN podría aprobar su propio borrador de scoring. **Decisión D-1 (2026-11-05): se mantiene inactivo** hasta que haya un segundo aprobador.

### 3.5 SQL de activación (🔒, solo con orden; se muestra para revisión)
```sql
BEGIN;
UPDATE public.permissions SET status = true
 WHERE "group" = 'GROWTH' AND name::text IN (<S aprobado>);
-- C5: verificación dentro de la transacción
SELECT name, status FROM public.permissions WHERE "group" = 'GROWTH' ORDER BY name;
-- Si algo no cuadra: ROLLBACK;
COMMIT;
```
No toca roles, ni `role_permissions`, ni `tokenVersion`: el SUPER_ADMIN no necesita el permiso en el token. **Reversión:** el mismo `UPDATE` con `status = false`; el guard lo aplica en 30 s como mucho.

### 3.6 Si algo sale mal después de P8
- El SUPER_ADMIN pierde una pantalla de Growth: activar el permiso que falta, si está en el alcance aprobado, **o** volver a la imagen anterior en Coolify. #287 no trae migraciones, así que el rollback de imagen es limpio.
- El SUPER_ADMIN pierde el acceso **administrativo no-Growth:** no debería pasar, porque #287 solo afecta a permisos **inactivos** y los permisos del panel están activos. Si pasa, rollback de imagen inmediato y se revisa C1 para el permiso en cuestión.

---

## 4. Tareas de F1: qué se puede hacer sin afectar producción

| Tarea | Categoría | Quién | Requiere orden |
|---|---|---|---|
| Revisar el código de #297, #298 y #299 | **A: sin tocar producción** | Usuario / asistente | No |
| Rebasar #287 y renumerar (P1) | A (rama en GitHub; *force push*) | Asistente | Autorización del *force push* |
| `@dependabot recreate` en #188 | A (solo dispara el CI) | Usuario o asistente | No (es un comentario en el PR) |
| Preparar y revisar las consultas C1–C5 y el conjunto S | A | Asistente + usuario | No |
| Crear el bucket y el token de R2, y los chequeos de Healthchecks | A (cuentas externas; no toca la app) | Usuario | No |
| Instalar los scripts del respaldo **sin** `--enable` (§2.3) | **B: toca el servidor, no la app ni los datos** | Usuario | Recomendado avisar |
| Primera corrida y verificación del respaldo (§2.4–2.6) | B (lee la base; la restauración va a una base temporal) | Usuario | Sí: es una operación sobre el servidor de producción |
| Consultas de solo lectura C1–C4 y búsqueda en los logs (P2, P3) | B (lectura) | Usuario | Recomendado |
| Paso 7 de R2 (buscar en el log los 4 últimos caracteres de la llave nueva), revisar la HMAC en Sentry | B (lectura) | Usuario | No |
| Borrar los `.dump` del VPS y del PC | B (archivos del host) | Usuario | Sí (es irreversible; solo después de E13) |
| Desactivar la actualización automática de Coolify | B (configuración del servidor) | Usuario | Sí |
| Fusionar #297 | **C: cambia producción** (migración + despliegue) | Asistente | 🔒 Sí |
| Fusionar #298 / #299 | C (despliegue, unos 30 s de 503, sin cambio funcional) | Asistente | 🔒 Sí |
| Activar el conjunto S (P6) y fusionar #287 (P8) | C | Usuario (SQL) / asistente (merge) | 🔒 Sí |
| Fusionar Dependabot #188 / #291 | C | Asistente | 🔒 Sí |
| Prueba de suspensión con un usuario de prueba (F1-4) | C (cambia datos de una cuenta de **prueba**) | Usuario | Sí |
| Publicar RemoteLink 1.15.1 en Play | C (usuarios reales) | Usuario | Sí |

**Lo que se puede hacer ya, sin riesgo para producción:** todas las tareas A. Son el rebase de #287 (con la autorización del *force push*), recrear #188 y preparar las consultas, más las cuentas externas del respaldo.

---

## 5. Criterio de cierre de F1

F1 está cerrada cuando existe evidencia de:
1. E1–E13 del respaldo, con el `diff` de huella limpio (o con diferencias solo en tablas volátiles, justificadas);
2. `/health` = la versión de cada merge, uno por uno;
3. la consulta posterior a #297 (fila duplicada con `status = f`) y el alta de un residente de prueba con el rol del seed;
4. el log sin `con permisos inactivos` durante 24 h después de P6, y P9 y P10 superados;
5. la prueba de suspensión con un usuario de prueba;
6. la higiene: `.dump` borrados, paso 7 de R2, HMAC revisada, decisión sobre Coolify y #188/#291 resueltos (fusionados o descartados).

**Decisiones de F1 (tomadas por el usuario el 2026-11-05):**
- **D-1 ✅** `APPROVE_GROWTH_SCORING` queda inactivo hasta que exista un segundo aprobador.
- **D-2 ✅** `VIEW_GROWTH_CONTACT_DATA` entra en el conjunto S.
- **D-3 ✅** #298 y #299 salen en **un solo despliegue**: se fusiona #298, se rebasa #299 sobre él y se despliega una vez. #297 va antes, en su propio despliegue, por la migración.
- **D-5 ✅** El SUPER_ADMIN gestiona y valida fuentes: `MANAGE_GROWTH_SOURCES` y `REVIEW_GROWTH_SOURCES_LEGAL` entran en S (web #211).
- **D-4 ✅ Desactivar la actualización automática de Coolify** (delegado al criterio técnico).
  - **Por qué:** el 2026-11-05 Coolify se actualizó solo a 4.6 y rompió el deploy dos veces sin avisar (GET → 405; la validación nueva de nombres de variables frenó todo deployment). #293 lo detecta ahora, pero no lo evita. En un servidor con un único operador, una actualización que llega sola es un cambio de producción sin orden ni ventana.
  - **Costo:** las actualizaciones (y sus parches de seguridad) pasan a ser manuales.
  - **Mitigación:** revisar una vez al mes las *release notes* de Coolify; actualizar en una ventana con poco uso, justo después del respaldo diario; tras actualizar, hacer un redeploy de prueba y comprobar `/health.version`. Un parche de seguridad crítico de Coolify se aplica sin esperar al mes.
  - **Cómo (👤, en el panel):** Coolify → **Settings** → **Auto Update** (o *Update*): apagar «Auto Update Enabled» → Save. Evidencia: captura del ajuste apagado y la versión actual de Coolify.
