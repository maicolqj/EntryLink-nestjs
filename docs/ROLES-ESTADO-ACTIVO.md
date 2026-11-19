# Un rol inactivo no concede nada

Complementa `docs/PERMISOS-ESTADO-ACTIVO.md` (permisos inactivos).

## Modelo

- `roles.status` (boolean). `user_has_roles` une usuario y rol, sin estado propio. `role_permissions` une rol y permiso.
- `user_permission_overrides`: excepciones GRANT/DENY por usuario, sobre los roles.
- La cuenta de un complejo (`entityType = complex`, `sub` = id del complejo) no es un usuario: su token sale de `COMPLEX_ROL`.

## Antes de este cambio

| Momento | ¿Miraba `roles.status`? | Efecto |
|---|---|---|
| Emisión y renovación del token (`scopedUserRoles`) | No | El nombre del rol inactivo iba en `roles` y sus permisos activos en `permissions` |
| Cuenta del complejo | No | `COMPLEX_ROL` siempre, activo o no |
| Guard (`requiredRoles`) | No | Una operación que exigía ese rol pasaba |
| Asignar (`assignJobRole`, `createAdminUser`) | Solo los roles de Growth | Los demás roles inactivos se podían asignar |
| Inactivar (`RolesService.remove`) | — | **Siempre fallaba**: cargaba la relación `UserRoles`, que no existe (`EntityPropertyNotFoundError`). Un rol solo quedaba inactivo por SQL o por el seed |
| Usuarios «activos» al inactivar | — | `user.status && role.status`: cualquier estado de texto (también `suspended`) contaba como activo |

## Ahora

| Momento | Regla |
|---|---|
| Emisión y renovación | Un rol inactivo no entra: ni su nombre ni sus permisos. Si otro rol activo da el mismo permiso, el permiso se conserva |
| Cuenta del complejo | Con `COMPLEX_ROL` inactivo (solo posible por SQL), sale sin rol ni permisos |
| Excepciones | DENY quita siempre. GRANT agrega solo su permiso, si está activo, y no reactiva el rol |
| Guard (GraphQL, REST y WebSocket) | Un rol inactivo no cuenta, aunque venga en un token viejo. El estado sale de la misma lectura que el de los permisos (`PermissionStatusService`: 30 s por proceso, falla cerrado a los 120 s). Con `SUPER_ADMIN_ROL` inactivo no hay paso de administrador |
| Inactivar o reactivar con `RolesService` | Sube `tokenVersion` a quien tiene el rol (y a las cuentas de complejo si es `COMPLEX_ROL`), en la misma transacción. Después del commit borra la versión en caché y pide releer el estado. El token siguiente sale sin el rol, o con él |
| Usuarios activos al inactivar | Solo cuenta `status = 'active'` |
| Roles que no se inactivan | `SUPER_ADMIN_ROL`, `RESIDENT_ROL` y `COMPLEX_ROL` |
| Asignar | Ningún rol inactivo se asigna |

**Cambio por SQL:** el guard lo ve en 30 s como mucho. Los permisos que ese rol puso en un token ya emitido duran hasta que el access token vence (15 min) o se renueva, salvo que se suba `tokenVersion` a sus usuarios (ver el SQL de activación de §13 en `docs/growth/ACTIVATION.md`).

## Cuentas afectadas al desplegar (solo lectura, no se ha corrido en producción)

```sql
BEGIN READ ONLY;

-- 1. Roles inactivos con usuarios asignados, y cuántos están activos.
SELECT r.name::text AS rol,
       count(uhr.user_id)                                   AS asignados,
       count(uhr.user_id) FILTER (WHERE u.status = 'active') AS activos,
       (SELECT count(*) FROM public.role_permissions rp
          JOIN public.permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = r.id AND p.status)               AS permisos_activos_que_entregaba
  FROM public.roles r
  JOIN public.user_has_roles uhr ON uhr.role_id = r.id
  LEFT JOIN public.users u ON u.id = uhr.user_id AND u.deleted_at IS NULL
 WHERE r.status = false
 GROUP BY r.id, r.name
 ORDER BY activos DESC;

-- 2. Usuarios activos que se quedan SIN ningún rol activo (pierden todo).
SELECT count(*) AS usuarios_sin_rol_activo
  FROM public.users u
 WHERE u.status = 'active' AND u.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM public.user_has_roles uhr
                 JOIN public.roles r ON r.id = uhr.role_id
                WHERE uhr.user_id = u.id AND r.status = false)
   AND NOT EXISTS (SELECT 1 FROM public.user_has_roles uhr
                     JOIN public.roles r ON r.id = uhr.role_id
                    WHERE uhr.user_id = u.id AND r.status = true);

-- 3. Permisos que se pierden: los que solo llegaban por un rol inactivo.
SELECT p.name::text AS permiso, count(DISTINCT u.id) AS usuarios
  FROM public.users u
  JOIN public.user_has_roles uhr ON uhr.user_id = u.id
  JOIN public.roles r ON r.id = uhr.role_id AND r.status = false
  JOIN public.role_permissions rp ON rp.role_id = r.id
  JOIN public.permissions p ON p.id = rp.permission_id AND p.status
 WHERE u.status = 'active' AND u.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.user_has_roles uhr2
       JOIN public.roles r2 ON r2.id = uhr2.role_id AND r2.status
       JOIN public.role_permissions rp2 ON rp2.role_id = r2.id
      WHERE uhr2.user_id = u.id AND rp2.permission_id = p.id)
   AND NOT EXISTS (
     SELECT 1 FROM public.user_permission_overrides o
      WHERE o.user_id = u.id AND o.permission_id = p.id AND o.effect = 'GRANT')
 GROUP BY p.name ORDER BY usuarios DESC;

-- 4. Cuentas de complejo: estado de COMPLEX_ROL (debe ser true).
SELECT name::text, status FROM public.roles
 WHERE name::text IN ('COMPLEX_ROL', 'SUPER_ADMIN_ROL', 'RESIDENT_ROL');

ROLLBACK;
```

Qué hacer con el resultado, **antes de desplegar**:
- Consulta 4 con algún `false`: detener. Activar el rol primero, con autorización.
- Consultas 1 a 3 con filas: decidir, rol por rol, entre activarlo (si se usa) o aceptar que esas personas lo pierdan.

## Pruebas

- Unitarias:
  - `token.service.permission-status.spec.ts` («roles inactivos»): emisión, permiso compartido con otro rol activo, GRANT y DENY, renovación y reactivación, `COMPLEX_ROL` inactivo;
  - `universal-role-permission.guard.spec.ts` («roles inactivos»): GraphQL y REST, reactivar, `SUPER_ADMIN_ROL` inactivo, un rol inactivo junto a otro activo;
  - `roles-status.spec.ts`: relación corregida, roles base, usuarios activos y suspendidos, `tokenVersion` dentro de la transacción y caché después del commit, reactivar;
  - `users-growth-roles.spec.ts`: no se asigna ningún rol inactivo.
- Integración con Postgres real (`test/growth/role-status-db.int-spec.ts`): `RolesService.remove/restore` de verdad, usuarios activos y suspendidos, versión del token, guard con token viejo y cambio por SQL.
