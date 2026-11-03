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

UPDATE public.permissions SET status = true WHERE "group" = 'GROWTH';

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
- Reglas sembradas: las aprobadas (10+ copropiedades +40, 5–9 +30, 2–4 +20, >500 unidades +20, canal verificado +10, interés +20). Umbrales: alta ≥ 50 y media ≥ 25. Ambos se configuran con `MANAGE_GROWTH_SCORING`.
- La fusión es siempre manual, con `MERGE_GROWTH_DUPLICATES`. No hay deshacer automático: `growth.merge_log` guarda qué se eligió y qué se trasladó.

## 11. Importaciones (1C)

- Permiso `IMPORT_GROWTH_DATA`: gerente e investigador. El oficial de cumplimiento no lo recibe.
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
