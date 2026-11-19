# Estado activo de los permisos

Un permiso con `public.permissions.status = false` **no autoriza nada, a nadie, tampoco a SUPER_ADMIN** (desde 0.43.0; ver `docs/SUPER-ADMIN-POLITICA.md`), aunque esté asignado a un rol activo, aunque haya una excepción GRANT y aunque venga en un token emitido antes de desactivarlo.

## Problema que corrige (2026-11-03)

- **El token tomaba los permisos del rol sin mirar `permissions.status`** (`TokenService.extractPermissions`, y lo mismo en la cuenta del complejo). Asignar un permiso inactivo a un rol activo lo activaba de hecho.
- **El guard solo miraba el token.** `UniversalRolePermissionGuard` comparaba con la lista de permisos del token y nada más. Un permiso desactivado seguía sirviendo hasta que vencía el token (15 min por defecto), y a cada renovación volvía, porque el rol lo seguía teniendo.
- **«Eliminar» un permiso no lo quitaba.** `PermissionsService.remove` pone `status = false`, pero `checkActivePermissionAssignments` es un stub que siempre devuelve 0. Un permiso «eliminado» se seguía entregando sin límite de tiempo a todos los roles que lo tenían.
- **Activar, desactivar o restaurar un permiso no invalidaba tokens.**

## Qué hace ahora

| Pieza | Regla |
|---|---|
| `TokenService` | Al emitir y al renovar, un permiso inactivo no entra: ni por rol, ni por GRANT, ni en la cuenta del complejo. DENY sigue quitando siempre |
| `UniversalRolePermissionGuard` | Si la operación exige permisos, consulta su estado vigente (`PermissionStatusService`). Uno inactivo no cuenta aunque el token lo traiga. Operaciones sin permisos exigidos: sin consulta |
| `PermissionStatusService` | Lee `SELECT name FROM permissions WHERE status = false`; vale 30 s por proceso, con una sola lectura aunque lleguen muchas peticiones. Si la base falla, sigue con lo último **verificado** solo hasta 120 s; después **niega todo con 503** (ver «Antigüedad máxima») |
| `PermissionsService.update/remove/restore` | Si cambia el estado, en la misma transacción sube `tokenVersion` a quien tiene el permiso (por rol o por excepción, y a las cuentas de complejo si lo tiene `COMPLEX_ROL`). Después del commit borra la versión en caché y vence el estado |
| `actorHas` (Growth Suite) | Igual que el guard: el permiso tiene que estar en el token y activo |
| SUPER_ADMIN | Pasa el guard sin tener el permiso asignado, **solo si el permiso está activo**. Con uno inactivo se niega, como a cualquiera. Ver `docs/SUPER-ADMIN-POLITICA.md` |

**Cuándo se ve un cambio:**
- **Desactivar con el servicio:** al momento. El guard deja de aceptarlo y el token viejo muere por la versión; el cliente renueva sin cerrar sesión, con los permisos recalculados.
- **Activar con el servicio:** en la siguiente petición. El token viejo muere por la versión y el renovado ya trae el permiso.
- **Cambiar el estado por SQL** (como en `docs/growth/ACTIVATION.md`): el guard lo respeta en 30 s como mucho. Para que quien lo recibe lo tenga sin esperar a que venza su token (15 min), se sube su versión:

```sql
-- Después de activar el permiso :permiso por SQL, en la misma transacción
UPDATE public.users u SET "tokenVersion" = u."tokenVersion" + 1
 WHERE u.id IN (
   SELECT uhr.user_id FROM public.user_has_roles uhr
     JOIN public.role_permissions rp ON rp.role_id = uhr.role_id
     JOIN public.permissions p ON p.id = rp.permission_id
    WHERE p.name::text = :permiso
   UNION
   SELECT upo.user_id FROM public.user_permission_overrides upo
     JOIN public.permissions p ON p.id = upo.permission_id
    WHERE p.name::text = :permiso);
```

La versión vive 5 minutos en la caché de Redis: sin borrar esa caché, el token viejo puede durar hasta 5 minutos más. Desactivar no lo necesita, porque el guard ya lo niega.

## Antigüedad máxima del estado (base sin responder)

El estado de los permisos nunca autoriza con datos viejos sin límite.

| Situación | Qué pasa |
|---|---|
| Lectura correcta | Se usa lo leído durante 30 s (TTL). Un temporizador lo relee cada 30 s aunque no haya peticiones, y también al arrancar |
| Permiso desactivado con la app andando | Con `PermissionsService`: se relee al momento en ese proceso y los tokens de quien lo tiene mueren en todas las réplicas (la versión vive en Redis). Por SQL: cada réplica lo ve al vencer su TTL (≤ 30 s) |
| TTL vencido y la base falla, o no responde en 5 s | Se sigue con el **último estado verificado**, sin rejuvenecerlo, y se reintenta cada 5 s, no en cada petición. Una consulta colgada cuenta como fallo a los 5 s |
| Más de 30 s sin base, pero menos de 120 s | Sigue autorizando con lo verificado (es lo último confirmado) y queda un error en el log en cada reintento |
| **Más de 120 s sin una lectura exitosa, o nunca leído** | **Toda operación con permisos se niega con 503 `PERMISSION_STATUS_UNAVAILABLE`, también para SUPER_ADMIN.** `actorHas` trata cualquier permiso como no disponible. Las operaciones sin permisos exigidos no dependen de este estado |
| La base vuelve | La siguiente lectura (≤ 5 s) restablece el estado y se vuelve a autorizar |
| Varias réplicas | Cada proceso tiene su propio registro, su TTL y su antigüedad máxima. Ninguna puede pasar de 120 s con datos viejos |

Constantes: `PERMISSION_STATUS_TTL_MS` (30 s), `PERMISSION_STATUS_RETRY_MS` (5 s), `PERMISSION_STATUS_QUERY_TIMEOUT_MS` (5 s) y `PERMISSION_STATUS_MAX_STALE_MS` (120 s).

En la práctica, con la base caída más de 2 minutos la API tampoco puede atender nada que lea datos. El 503 deja claro el motivo y Sentry lo registra como 5xx.

Pruebas: los 7 escenarios están en `permission-status.service.spec.ts` (tiempo controlado, base colgada con temporizadores falsos y dos instancias aisladas del módulo). El 503 en el guard, también para SUPER_ADMIN, está en `universal-role-permission.guard.spec.ts`.

En pruebas, `test/setup/permission-status.ts` (setupFiles de jest) declara un estado verificado sin levantar el servicio. `trustPermissionStatusForTests` se niega a correr con `NODE_ENV=production`.

## Excepción de SUPER_ADMIN

Reemplazada por la política de `docs/SUPER-ADMIN-POLITICA.md`, que incluye la matriz completa. En resumen: SUPER_ADMIN ya no pasa con permisos inactivos, ni en el guard ni en `actorHas`. Conserva el paso ordinario con permisos activos y los pasos explícitos de `SubscriptionGuard` y `ComplexModuleGuard`, que se justifican en esa matriz. La única excepción es la separación de funciones de Growth, explícita y auditada en `growth.activity_events`.

## Pruebas

- `universal-role-permission.guard.spec.ts`, en GraphQL y REST:
  - permiso activo, inactivo y nuevo inactivo;
  - activar y desactivar con un token emitido antes;
  - SUPER_ADMIN: pasa con permisos activos y no con uno inactivo;
  - sin permiso, sin usuario u otro rol;
  - sin consulta cuando la operación no exige permisos;
  - falla cerrado;
  - `actorHas`.
- `token.service.permission-status.spec.ts`: emisión con rol activo y permiso activo o inactivo, GRANT y DENY, cuenta del complejo, renovación que recalcula y versión en el token.
- `permission-status.service.spec.ts`: los 7 escenarios de «Antigüedad máxima» (lectura correcta, desactivar en caliente, TTL vencido con la base caída, más de 30 s, 120 s y 5 min con 503, recuperación y varias réplicas), consulta colgada cortada a los 5 s, una sola lectura, lectura al arrancar y cada 30 s, versión de usuarios y complejos y borrado de caché después del commit.
- `universal-role-permission.guard.spec.ts`: 503 con el estado no verificable, también para SUPER_ADMIN.
- `test/growth/permission-status-db.int-spec.ts` (Postgres real, en la base desechable de la suite): `remove`/`restore` reales con versión, caché y guard; un token viejo rechazado; un cambio por SQL respetado; SUPER_ADMIN; acceso sin autorización.

## Pendiente (fuera de esta corrección)

- **`roles.status` tampoco se mira al emitir.** Un rol inactivo asignado a alguien le da sus permisos (activos). `assignJobRole` impide asignar roles inactivos de Growth, pero no hay una regla general. Cambiarlo puede quitar acceso a cuentas existentes: hay que revisar los datos de producción antes.
- **Cambiar los permisos de un rol (`RolesService.update`) no sube `tokenVersion`.** Quitar un permiso activo de un rol tarda hasta que vence el token (15 min) en verse. Desactivar el permiso sí es inmediato.
- `checkActivePermissionAssignments` sigue siendo un stub. Con esta corrección ya no hace falta para la seguridad, porque un permiso inactivo no autoriza aunque siga asignado, pero el mensaje «no se puede eliminar un permiso asignado» nunca se muestra.
