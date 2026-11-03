# Estado activo de los permisos

Un permiso con `public.permissions.status = false` **no autoriza nada**, para nadie salvo SUPER_ADMIN (con traza), aunque esté asignado a un rol activo, aunque haya una excepción GRANT y aunque venga en un token emitido antes de desactivarlo.

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
| `PermissionStatusService` | Lee `SELECT name FROM permissions WHERE status = false` y lo guarda 30 s por proceso, con una sola lectura aunque lleguen muchas peticiones. Si la base falla, sigue con lo último conocido y reintenta al vencer el TTL; si nunca pudo leer, **falla cerrado** |
| `PermissionsService.update/remove/restore` | Si cambia el estado, en la misma transacción sube `tokenVersion` a quien tiene el permiso (por rol o por excepción, y a las cuentas de complejo si lo tiene `COMPLEX_ROL`). Después del commit borra la versión en caché y vence el estado |
| `actorHas` (Growth Suite) | Igual que el guard: el permiso tiene que estar en el token y activo |
| SUPER_ADMIN | Sigue pasando el guard sin tener el permiso asignado. Si la operación exige un permiso inactivo, queda en el log (`SUPER_ADMIN <id> usó <Clase>.<método> con permisos inactivos: [...]`). No salta nada más: sesión, `tokenVersion`, suscripción, separación de funciones y demás guards siguen aplicando |

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

## Pruebas

- `universal-role-permission.guard.spec.ts`, en GraphQL y REST:
  - permiso activo, inactivo y nuevo inactivo;
  - activar y desactivar con un token emitido antes;
  - SUPER_ADMIN con traza;
  - sin permiso, sin usuario u otro rol;
  - sin consulta cuando la operación no exige permisos;
  - falla cerrado;
  - `actorHas`.
- `token.service.permission-status.spec.ts`: emisión con rol activo y permiso activo o inactivo, GRANT y DENY, cuenta del complejo, renovación que recalcula y versión en el token.
- `permission-status.service.spec.ts`: caché de 30 s, una sola lectura, invalidación sin perder datos, fallo con y sin datos previos, versión de usuarios y complejos y borrado de caché después del commit.
- `test/growth/permission-status-db.int-spec.ts` (Postgres real, en la base desechable de la suite): `remove`/`restore` reales con versión, caché y guard; un token viejo rechazado; un cambio por SQL respetado; SUPER_ADMIN; acceso sin autorización.

## Pendiente (fuera de esta corrección)

- **`roles.status` tampoco se mira al emitir.** Un rol inactivo asignado a alguien le da sus permisos (activos). `assignJobRole` impide asignar roles inactivos de Growth, pero no hay una regla general. Cambiarlo puede quitar acceso a cuentas existentes: hay que revisar los datos de producción antes.
- **Cambiar los permisos de un rol (`RolesService.update`) no sube `tokenVersion`.** Quitar un permiso activo de un rol tarda hasta que vence el token (15 min) en verse. Desactivar el permiso sí es inmediato.
- `checkActivePermissionAssignments` sigue siendo un stub. Con esta corrección ya no hace falta para la seguridad, porque un permiso inactivo no autoriza aunque siga asignado, pero el mensaje «no se puede eliminar un permiso asignado» nunca se muestra.
