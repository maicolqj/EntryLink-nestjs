# Growth Suite — Procedimiento de activación

> **Requiere aprobación expresa** del responsable del producto antes de
> ejecutar cualquier paso en producción. Este documento no autoriza nada por sí
> mismo.

Encender la bandera **no** activa los roles ni los permisos: son dos pasos
distintos a propósito. Con la bandera encendida y los roles inactivos, solo
SUPER_ADMIN puede usar la suite.

## 0. Estado después de desplegar la fase 0 (bandera apagada)

| Elemento | Estado |
|---|---|
| Esquema `growth` y sus 24 tablas (7 de la fase 0 + 10 de 1A + 4 de 1B + 3 de 1C) | creados, vacíos (salvo 6 fuentes `PENDING_APPROVAL`, la fila de `growth.settings` y las 6 reglas de scoring sembradas) |
| `GROWTH_MANAGER_ROL`, `SALES_ROL`, `GROWTH_RESEARCHER_ROL` | existen con `status = false`: no se pueden asignar |
| 24 permisos del grupo `GROWTH` (13 de la fase 0 + 8 de 1A + 2 de 1B + 1 de 1C) | existen con `status = false`, asignados solo a esos 3 roles |
| `COMPILANCE_OFFICER_ROL` | sin permisos de la suite |
| API GraphQL | sin operaciones `growth*`; el esquema solo suma 27 valores nuevos de los enums `ValidRoles` (3) y `ValidPermissions` (24) |

## 1. Requisitos previos

- [ ] Revisión jurídica de las finalidades y bases de tratamiento (ver `DATA-PROTECTION.md`).
- [ ] Texto del aviso de privacidad para el primer contacto aprobado (se usa en la fase 3).
- [ ] Respaldo reciente de la base de producción.

## 2. Generar la llave HMAC (una vez)

En una máquina de confianza, no en el chat ni en un ticket:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

La llave se guarda **solo** en las variables de entorno de Coolify. Si se
pierde, las exclusiones hechas con ella no se pueden volver a verificar y la
consulta de exclusiones queda bloqueada (falla cerrada).

## 3. Variables en Coolify (servicio de la API)

```
GROWTH_ENABLED=true
GROWTH_SUPPRESSION_HMAC_KEYS=1:<llave base64 del paso 2>
GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION=1
```

Sin `GROWTH_SUPPRESSION_HMAC_KEYS`, con la bandera encendida la validación de
entorno detiene el arranque. Por eso se configuran las tres a la vez.

Redesplegar y verificar:

- `https://api.alternaqj.com/health` responde 200.
- En el log: `GrowthModule dependencies initialized`.
- Sin `No se pudo verificar el llavero HMAC` en el log.

## 4. Activar roles y permisos (SQL, una vez)

Se ejecuta en una transacción. Es idempotente.

```sql
BEGIN;

UPDATE public.permissions SET status = true
 WHERE "group" = 'GROWTH'
   AND name::text NOT IN ('MANAGE_GROWTH_IMPORT_TEMPLATES', 'APPROVE_GROWTH_SCORING'); -- activación manual: ver §13

UPDATE public.roles SET status = true
 WHERE name IN ('GROWTH_MANAGER_ROL', 'SALES_ROL', 'GROWTH_RESEARCHER_ROL');

-- El oficial de cumplimiento recibe el lado legal de la suite.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p ON p.name::text IN (
    'VIEW_GROWTH_TEAM', 'VIEW_GROWTH_ACTIVITY', 'VIEW_GROWTH_SOURCES',
    'REVIEW_GROWTH_SOURCES_LEGAL', 'VIEW_GROWTH_SUPPRESSIONS',
    'LIFT_GROWTH_SUPPRESSIONS', 'VIEW_GROWTH_PRIVACY_REQUESTS',
    'MANAGE_GROWTH_PRIVACY_REQUESTS', 'MANAGE_GROWTH_LEGAL_HOLDS',
    -- Entrega 1A (EntryLink Prospect)
    'VIEW_GROWTH_PROSPECTS', 'VIEW_ALL_GROWTH_PROSPECTS', 'VIEW_GROWTH_CONTACT_DATA',
    'REVIEW_GROWTH_LEGAL_BASIS', 'AUTHORIZE_GROWTH_CONTACT')
 WHERE r.name = 'COMPILANCE_OFFICER_ROL'
ON CONFLICT DO NOTHING;

-- Verificación: debe devolver 3 roles activos y 24 permisos activos (13 de la fase 0 + 8 de 1A + 2 de 1B + 1 de 1C).
-- Los permisos de activación manual (§13) quedan fuera de esta cuenta.
SELECT name, status FROM public.roles WHERE name::text LIKE '%GROWTH%' OR name = 'SALES_ROL';
SELECT count(*) FILTER (WHERE status) AS activos FROM public.permissions WHERE "group" = 'GROWTH';

COMMIT;
```

La lista de permisos del oficial de cumplimiento es la constante
`GROWTH_COMPLIANCE_PERMISSIONS` de `src/modules/growth/shared/growth-access.catalog.ts`.

Los usuarios con sesión abierta ven los permisos nuevos al renovar su token.
Para forzarlo, se cierra su sesión o se usa el mecanismo de `tokenVersion`.

**Seeds:** volver a correr `seed:permissions` con `GROWTH_ENABLED=true` deja
activos los permisos. Con la bandera apagada los vuelve a desactivar. Además,
`seed:roles` reescribe los permisos de los roles existentes según
`roles.data.seed.ts`, que todavía no incluye los de cumplimiento: si se corre
después de activar, hay que repetir el `INSERT` de arriba.

## 5. Primer integrante del equipo

1. Crear el usuario interno desde la administración de usuarios: correo `@alternaqj.com`, sin conjunto.
2. Asignarle `SALES_ROL`, `GROWTH_RESEARCHER_ROL` o `GROWTH_MANAGER_ROL`. Mientras el rol esté inactivo, la asignación se rechaza.
3. `growthAddTeamMember(input: { userId, displayName })`. Se rechaza si el usuario está ligado a un conjunto.

## 6. Fuentes

Ninguna fuente nace activa. Para cada una:

1. `growthReviewDataSourceLegal`: revisión jurídica, con referencia al concepto.
2. Solo para las de pago (`GOOGLE_PLACES`): `growthApproveDataSourceCost`, con presupuesto mensual, tope de consultas y estimado de costo. **Solo SUPER_ADMIN.** Antes se presenta la estimación de costo para aprobarla.
3. `growthSetDataSourceStatus(status: ACTIVE)`. La base rechaza activar si falta cualquiera de los dos pasos anteriores.

## 7. Rotar la llave HMAC

1. Generar la llave nueva (paso 2).
2. `GROWTH_SUPPRESSION_HMAC_KEYS=1:<vieja>,2:<nueva>` y `GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION=2`. Redesplegar.
3. Lo nuevo se escribe con v2. Las exclusiones con v1 siguen bloqueando, y al consultarse reciben su hash v2.
4. `growthSuppressionKeyStatus` muestra en `retirableVersions` cuándo v1 ya se puede quitar. **No se quita antes**: si se retira una llave de la que aún dependen exclusiones, la consulta de exclusiones falla (cerrada) hasta restaurarla.

Si la llave vieja quedó comprometida, se agrega la nueva igual, pero la vieja
no se puede quitar hasta que `retirableVersions` la incluya. Las exclusiones
nunca consultadas siguen dependiendo de ella. La fase 1 agrega un re-hash con
los contactos que la suite conoce en claro.

## 8. Reversión

| Necesidad | Acción |
|---|---|
| Apagar la suite | `GROWTH_ENABLED=false` y redesplegar. Las operaciones desaparecen; los datos quedan. |
| Desactivar roles | `UPDATE public.roles SET status = false WHERE name IN (…)` + `UPDATE public.permissions SET status = false WHERE "group" = 'GROWTH'` |
| Quitar el esquema (solo si está vacío y con aprobación) | `yarn migration:revert` ×3 en orden. **Borra los datos de la suite.** Los valores de enum quedan, porque Postgres no permite quitarlos; sin filas son inocuos. |

## 9. EntryLink Prospect (1A) — antes de capturar

1. **Fuente activa.** Toda alta exige una fuente `ACTIVE`, así que primero se completan la revisión jurídica y la activación de al menos una fuente (paso 6).
2. **Excepción de auto-validación.** `growth.settings.allow_super_admin_self_validation` nace en `true`: mientras el equipo sea una sola persona, SUPER_ADMIN puede validar lo que registró, y cada uso queda como `SELF_VALIDATION_EXCEPTION` en `growth.activity_events`. Al incorporar otros validadores se apaga con `growthUpdateSettings(input: { allowSuperAdminSelfValidation: false })`.
3. **Contacto comercial.** Ninguna persona queda contactable por validarse. Hacen falta tres pasos de cumplimiento: base jurídica documentada (`growthSetPersonLegalBasis`), persona validada y autorización expresa (`growthSetPersonContactStatus`). La vista `growth.v_contactable_person_channels` es el único punto de entrada que tendrá Outreach.

## 10. Deduplicación y scoring (1B)

- La cola BullMQ `growth-prospects` usa el Redis existente y solo se registra con la suite encendida. Se ve en Bull Board.
- Tras activar, conviene lanzar una vez `growthRescoreAll` para calcular el puntaje de todo lo que ya exista.
- Reglas sembradas: las aprobadas (10+ copropiedades +40, 5–9 +30, 2–4 +20, >500 unidades +20, canal verificado +10, interés +20). Umbrales: alta ≥ 50 y media ≥ 25.
- **Desde 1E-C-0 las reglas y los umbrales tienen versiones** (`growth.scoring_versions`):
  - La migración crea la **versión 1, ACTIVE**, con las reglas y los umbrales vigentes en ese momento, sin cambiarlos.
  - Para cambiarlos, `MANAGE_GROWTH_SCORING` crea un **borrador** (`growthCreateScoringDraft`), lo edita (`growthUpdateScoringDraft`) y lo compara con la activa (`growthCompareScoringVersion`, mismo motor, sin guardar nada).
  - `APPROVE_GROWTH_SCORING` (§13) lo **aprueba y activa** (`growthActivateScoringVersion`). No lo aprueba quien lo creó o editó; la excepción es SUPER_ADMIN con `allow_super_admin_self_validation`, y queda en la actividad.
  - Activar retira la versión anterior, copia reglas y umbrales a `scoring_rules` y `settings` (lo que leen las consultas de 1B) y encola el recálculo. Cada puntaje guarda la versión que lo calculó (`prospect_scores.version_id`) y cada cambio queda en `growth.prospect_score_history`, que es append-only.
  - `growthScoringStatus` dice cuántos puntajes faltan por recalcular. El cron `growth-scoring-catchup` (cada 10 minutos, con lock consultivo) pone al día los que se queden por un fallo de Redis o del trabajo.
  - `growthCreateScoringRule`, `growthUpdateScoringRule` y `growthUpdateScoringThresholds` siguen en la API, pero **ya no aplican cambios**: responden `GROWTH_SCORING_REQUIRES_APPROVAL`.
  - Ninguna versión puede quedar activa sin aprobador (CHECK en la base), salvo la versión 1 de la migración.
- El scoring **solo ordena**: nunca autoriza ni bloquea un contacto. La autorización sigue dependiendo de la base jurídica, de los permisos y del estado de cada persona.
- La fusión es siempre manual, con `MERGE_GROWTH_DUPLICATES`. No hay deshacer automático: `growth.merge_log` guarda qué se eligió y qué se trasladó.

## 11. Importaciones (1C)

- Permiso `IMPORT_GROWTH_DATA`: gerente e investigador. El oficial de cumplimiento no lo recibe.
- Plantillas de mapeo: **personales** (solo su dueño las ve y las cambia) y **del equipo** (las usa todo quien importa; solo `MANAGE_GROWTH_IMPORT_TEMPLATES`, ver §13, las crea, comparte, edita o archiva). Guardan solo encabezados y su campo, nunca valores. Un nombre repetido en el mismo alcance es un error, nunca una sobrescritura. Se archivan, no se borran. Las que existían antes de este cambio quedaron como del equipo, con su autor como dueño.
- Cola BullMQ `growth-imports` (Redis existente; validación y confirmación), visible en Bull Board. Solo se registra con la suite encendida.
- Subida: `POST /api/v1/growth/imports` (multipart en memoria; máx. 5 MB, 5.000 filas y 15 millones de caracteres en total). **El archivo original no se guarda** en ninguna parte: no hace falta configurar nada en Cloudflare.
- Cron `growth-import-purge` a las 3:45 (Bogotá): cierra los lotes sin cambios en 7 días y, 30 días después de terminado un lote, borra sus filas crudas. Un lote con retención legal (`entity_type = 'IMPORT_BATCH'`) no se purga.
- Si un lote queda en `COMMITTING` porque Redis falló al encolar, repetir `growthCommitImport` lo vuelve a encolar; el trabajo no duplica filas ya procesadas. Un lock consultivo de Postgres por lote impide que dos trabajos lo confirmen a la vez (réplicas o trabajos dados por atascados).
- Riesgo residual: si el proceso cae justo entre crear un registro y marcar su fila, al reanudar esa fila se crea otra vez (el NIT único lo evita en empresas con NIT). La deduplicación de 1B lo propondrá como duplicado.

## 12. Variables de la suite y errores de configuración

- Con `GROWTH_ENABLED` apagada (o ausente), `GROWTH_SUPPRESSION_HMAC_KEYS` y `GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION` **no se validan y se descartan**: un error de formato en ellas ya no impide arrancar la API (caída del 2026-11-01, por `1=` en lugar de `1:`).
- Con la suite encendida son obligatorias. El formato es `1:<base64 de 32 bytes>` (44 caracteres después de `1:`), sin comillas ni espacios. Para rotar: `1:<llave vieja>,2:<llave nueva>` y versión activa `2`.
- Un error de configuración nombra la variable y el problema, **nunca el valor** (`validateEnv` en `src/core/config/env-validation.ts`). Sentry redacta además cualquier `with value "…"` (`src/core/config/redact.ts`).
- Generar una llave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Nunca pegarla en chats ni tickets.

## 13. Permisos de activación manual

Algunos permisos nacen **inactivos y sin asignar a ningún rol**. No los activa ninguna migración ni seed: el seed los crea con `status = false` y nunca les cambia el estado (`preserveStatus`).

| Permiso | Para qué | Se asigna a |
|---|---|---|
| `MANAGE_GROWTH_IMPORT_TEMPLATES` | Crear, compartir, editar y archivar las plantillas de importación del **equipo** | `GROWTH_MANAGER_ROL` |
| `APPROVE_GROWTH_SCORING` | Aprobar y activar una versión de reglas y umbrales del scoring | `GROWTH_MANAGER_ROL`, u otro rol que se decida, distinto de quien configura |

**Por qué así:** desde la corrección de permisos (`docs/PERMISOS-ESTADO-ACTIVO.md`), un permiso inactivo no autoriza aunque esté asignado a un rol activo o venga en un token viejo. Aun así, como defensa adicional, ninguna migración ni seed los asigna, y el catálogo prueba que no estén en ningún rol. La lista de asignaciones vive en `GROWTH_MANUAL_ROLE_GRANTS` (`growth-access.catalog.ts`).

Activarlos, cuando se decida (en una transacción, uno o los dos):

```sql
BEGIN;
UPDATE public.permissions SET status = true
 WHERE name::text IN ('MANAGE_GROWTH_IMPORT_TEMPLATES', 'APPROVE_GROWTH_SCORING');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
  JOIN public.permissions p
    ON p.name::text IN ('MANAGE_GROWTH_IMPORT_TEMPLATES', 'APPROVE_GROWTH_SCORING')
 WHERE r.name = 'GROWTH_MANAGER_ROL'
ON CONFLICT DO NOTHING;
-- Que quien lo recibe lo tenga sin esperar a que venza su token (15 min):
UPDATE public.users u SET "tokenVersion" = u."tokenVersion" + 1
 WHERE u.id IN (SELECT uhr.user_id FROM public.user_has_roles uhr
                  JOIN public.roles r ON r.id = uhr.role_id
                 WHERE r.name = 'GROWTH_MANAGER_ROL');
COMMIT;
```

El estado lo toma el guard en 30 s como mucho. La versión del token vive 5 min en la caché de Redis, así que el token viejo puede durar hasta ese tiempo.

**Desactivar:** `UPDATE public.permissions SET status = false WHERE name::text = '…'`. El guard lo niega en 30 s como mucho, aunque el permiso siga asignado y el token lo traiga.

**Mientras no se activen:**
- todos siguen usando las plantillas del equipo que ya existían y crean las suyas como personales;
- nadie, salvo SUPER_ADMIN, puede cambiar plantillas del equipo ni activar versiones de scoring. Si el mismo SUPER_ADMIN creó el borrador, solo lo aprueba con la excepción encendida, y queda auditado. El uso de un permiso inactivo por un SUPER_ADMIN queda en el log;
- el scoring sigue funcionando con la versión activa.
