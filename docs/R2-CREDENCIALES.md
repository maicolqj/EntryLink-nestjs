# Credenciales de Cloudflare R2: exposición y plan de rotación

Este documento no contiene ningún valor secreto. **Nada de esto se ha ejecutado:** ni la rotación ni ningún cambio en Cloudflare, Coolify o el VPS.

## 1. Dónde se usan

| Componente | Variables | Uso |
|---|---|---|
| API (`src/core/config/r2.config.ts` → `R2StorageService`) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Subir, leer (URL firmada) y borrar los archivos de la plataforma: fotos, documentos privados (DPA, documentos del conjunto), adjuntos de comunicados, soportes de pago |
| Validación del entorno (`env-validation.ts`) | las cuatro primeras, obligatorias en producción | Los errores nombran la variable, nunca el valor (#276) |
| Respaldo (`scripts/backup-db.sh`) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BACKUP_BUCKET` | Sube el `pg_dump` diario a `s3://$R2_BACKUP_BUCKET/daily/` y borra los de más de `RETENTION_DAYS` |
| Migración de carpetas (`scripts/migrate-r2-layout.ts`) | las mismas de la API | Script manual de una sola vez. Imprime bucket y conteos, no las llaves |
| `docker-compose.prod.yml` / Coolify | referencias `${R2_…}` | Inyección al contenedor; no hay valores en el repositorio |

**Confirmado en Cloudflare y Coolify (2026-11-04):**
- el token de la API tiene alcance **solo sobre el bucket de archivos**;
- en Coolify no existen `R2_BACKUP_BUCKET` ni Scheduled Tasks: hoy no hay respaldo en R2.

Por eso los respaldos no quedaron expuestos por esta llave. El script, tal como está, usaría las mismas llaves que la API; por eso el plan crea un token propio para el respaldo.

**Las mismas llaves (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) sirven a la API y al respaldo.** Si el token de R2 tiene alcance sobre los dos buckets (no se puede saber desde el repositorio: se ve en Cloudflare → R2 → *Manage API tokens*), quien tenga la llave puede leer y borrar los respaldos de la base completa.

## 2. Cómo se expusieron

- **Origen:** `R2StorageService.onModuleInit` hacía `logger.warn` de `accountId`, `accessKeyId` y `secretAccessKey`. Las líneas entraron con el módulo de R2 (commits del 2026-05-16, `b0ba0d9` / `d073354`) y se quitaron el 2026-08-01 (`15d719b`).
- **Cuándo:** en **cada arranque** de la API durante ese periodo. Cada despliegue, cada reinicio de Coolify y cada arranque local.
- **Dónde pudieron quedar:**

| Tipo de log | ¿Afectado? | Comentario |
|---|---|---|
| Salida del contenedor en producción (`docker logs`, pantalla de logs de Coolify) | **Sí** | Nivel `warn`, que en producción se imprime. Coolify guarda el log del contenedor mientras exista, y el de despliegues anteriores según su retención |
| Cualquier agregador o *log drain* configurado en Coolify en esa época | **Posible** | Confirmar en Coolify si hubo alguno |
| Consola y archivos de log locales de desarrollo | **Sí** | Terminales, `*.log` locales y capturas compartidas |
| Sentry | No | Se integró el 2026-10-26, después de quitar el log. Ahora además depura secretos |
| GitHub Actions | No | El CI no arranca la API con llaves reales: las pruebas no levantan `R2StorageService` con valores de producción |
| Repositorio | No | No hay valores en el código ni en el historial (solo los nombres de las variables) |

- **Otras rutas revisadas (2026-11-04):**
  - errores de validación del entorno: ya no llevan el valor (#276);
  - errores del SDK de S3: no incluyen la llave secreta;
  - `scripts/backup-db.sh` pasaba las llaves como `-e NOMBRE=valor` a `docker run`, así que mientras el respaldo corría quedaban visibles en `ps` y en `/proc` del VPS. **Corregido en este PR:** se pasan por el entorno.

## 3. Qué se considera comprometido

1. **El par `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` que estaba vigente entre el 2026-05-16 y hoy.** Quitar el log no lo invalida. Mientras no se revoque, quien haya visto un log de esa época puede leer, escribir y borrar en los buckets de su alcance.
2. ~~Los respaldos en `R2_BACKUP_BUCKET`~~: **descartado** (el token solo alcanza el bucket de archivos y no hay bucket de respaldos configurado). Era el riesgo si el token también los alcanzaba: tienen la base completa, con datos personales de residentes. Hay que tratar su confidencialidad como no garantizada y revisar su integridad (que no se hayan borrado o reemplazado).
3. `R2_ACCOUNT_ID` no es una credencial por sí solo (identifica la cuenta en el endpoint), pero también se imprimió. No hace falta cambiarlo. Basta con saber que es público.

## 4. Plan de rotación (cada paso requiere autorización)

1. **Identificar.** En Cloudflare → R2 → *Manage API tokens*: anotar el nombre (no el valor) del token cuyo *Access Key ID* termina igual que el de Coolify (comparar los últimos 4 caracteres, sin copiar el valor), su alcance (qué buckets), sus permisos y su fecha de creación. Revisar si hay otros tokens que nadie use.
2. **Crear credenciales nuevas, separadas por función**:
   - token **API**: *Object Read & Write* solo sobre el bucket de archivos;
   - token **Respaldo**: *Object Read & Write* solo sobre `R2_BACKUP_BUCKET`.

   Así una fuga de la API no alcanza los respaldos. Guardar los valores directo en Coolify, nunca en chats, tickets ni archivos.
3. **Actualización controlada de variables (Coolify).**
   1. En el recurso de la API, reemplazar `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY` por el token API.
   2. En la tarea programada del respaldo, poner el token Respaldo: o bien variables propias (`R2_BACKUP_ACCESS_KEY_ID` / `R2_BACKUP_SECRET_ACCESS_KEY`, con un cambio menor del script), o bien sus valores en las mismas variables si la tarea tiene su propio entorno.
   3. Redesplegar la API (reinicio, sin código nuevo).
4. **Prueba de lectura y escritura** (en producción, sin tocar datos de residentes):
   - `GET /health` en 200 y el log de arranque con `Cloudflare R2 configurado correctamente`;
   - desde la web, subir un archivo de prueba en un conjunto de prueba (o un adjunto de comunicado en borrador), abrirlo con la URL firmada y borrarlo;
   - revisar Sentry: sin errores `InvalidAccessKeyId` ni `SignatureDoesNotMatch`.
5. **Verificación de respaldos:**
   - correr la tarea de respaldo una vez a mano con el token nuevo;
   - comprobar que el objeto nuevo aparece en `daily/` con un tamaño parecido al anterior;
   - descargarlo y restaurarlo en una base aparte con el procedimiento de `INTEGRACION-GROWTH/05` §2 (huella idéntica);
   - listar `daily/` y comparar con lo esperado según `RETENTION_DAYS`. Si falta alguno o alguno tiene un tamaño raro, tratarlo como incidente.
6. **Revocar las credenciales anteriores**, en Cloudflare → *Manage API tokens* → *Roll* o *Delete* sobre el token viejo, **solo después** de que los pasos 4 y 5 pasen. Volver a correr el paso 4 para confirmar que nada dependía de la llave vieja.
7. **Confirmar que los logs no vuelvan a exponer secretos:**
   - este PR agrega el depurador de secretos (`src/core/config/secret-scrubber.ts`): el logger de la app y Sentry reemplazan por `[redactado]` el valor de cualquier variable secreta (`*SECRET*`, `*PASSWORD*`, `PASSDB*`, `*TOKEN*`, `*_KEY(S)`, `*ACCESS_KEY_ID*`, `*ACCOUNT_ID*`, `*DSN*`);
   - una prueba (`secret-scrubber.spec.ts`) arranca `R2StorageService` con llaves falsas y falla si alguna aparece en el log;
   - después del redespliegue, buscar en el log del contenedor los últimos 4 caracteres de la llave nueva: no debe aparecer;
   - opcional: purgar o rotar en Coolify los logs de despliegues anteriores al 2026-08-01, si siguen guardados.

**Orden mínimo seguro:** 2 → 3 → 4 → 5 → 6 → 7. No revocar antes de probar: si se revoca primero, la API y el respaldo fallan hasta terminar.
