# Sesiones de cuentas no activas (suspendidas, baneadas, inactivas)

## Regla

Una cuenta de usuario solo opera con `users.status = 'active'`, la misma condición que exige cada canal de inicio de sesión (clave, WhatsApp, OTP, dispositivo vinculado, aprobación por push). La sesión ya abierta sigue la misma regla, por todas las vías:

| Vía | Dónde | Qué pasa con una cuenta no activa |
|---|---|---|
| GraphQL y REST | `JwtAccessStrategy` → `AccessTokenValidatorService` | 401 `SESSION_TERMINATED` (la app y la web vuelven al login) |
| Renovación | `TokenService.rotateRefreshToken` | 401 `SESSION_TERMINATED`, sin tokens nuevos, y se revoca la familia (`user_not_active`) |
| Socket.IO | handshake en `SocketGateway` → mismo validador | conexión rechazada |
| Login | `AuthService` y los servicios de cada canal | ya estaba: `USER_SUSPENDED` |

Antes de este cambio, `suspendUser` solo cambiaba el estado: el usuario suspendido seguía operando y renovando su sesión hasta que vencía el refresh token (hasta 180 días). El socket, además, solo miraba la sesión: no comprobaba la versión del token.

## Qué hace `suspendUser`

1. Una sola escritura: `status = suspended`, `suspension_reason` y `tokenVersion + 1`. Desde ahí, ningún access token anterior coincide con la versión.
2. Cierra todas sus sesiones (`terminateAllUserSessions`), revoca los refresh tokens que queden (`invalidateUserSessions`, motivo `user_suspended`) y borra la versión cacheada.
3. Desconecta sus sockets en todas las instancias (`SocketService.disconnectUser`, sala `user:<id>` con el adaptador de Redis).
4. Auditoría (`audit_logs`, acción `SUSPEND`): estado anterior, motivo, `sessionsClosed` y `sessionsCutComplete`.

El paso 2 no lanza: si Redis falla, la suspensión ya está guardada y `sessionsCutComplete = false` queda en la auditoría. En ese caso la versión vieja puede seguir en la caché hasta 5 minutos; al vencer, la base dice «suspendido».

## Reactivar

`reactivateUser` vuelve a `active` y sube **otra vez** `tokenVersion`. Ningún token anterior a la suspensión ni emitido durante ella vuelve a servir: hace falta un login nuevo. Queda auditado (`ACTIVATE`).

## Costo por petición

Igual que antes: la versión del token se lee de Redis (5 min de caché) y la sesión también. La base solo se consulta cuando la versión no está en caché, y en esa misma lectura se mira el estado. No se agrega ninguna consulta por petición.

## Otros cambios de estado

Pasar a `inactive` cuando a alguien se le quitan todas sus asignaciones (`removeStaffMember`) no sube la versión del token: su sesión deja de servir al renovar o, como mucho, a los 5 minutos (cuando vence la versión cacheada). Lo mismo con cualquier cambio de estado hecho por SQL.

## Cuentas afectadas al desplegar (solo lectura, no se ha corrido en producción)

Quienes hoy tienen sesión viva con una cuenta no activa la pierden al desplegar:

```sql
BEGIN READ ONLY;

-- 1. Cuentas no activas con refresh tokens vigentes, por estado.
SELECT u.status, count(DISTINCT u.id) AS usuarios,
       count(rt.id) AS refresh_tokens_vigentes
  FROM public.users u
  JOIN public.refresh_tokens rt ON rt."userId" = u.id
 WHERE u.status <> 'active'
   AND rt."isRevoked" = false AND rt."expiresAt" > now()
 GROUP BY u.status;

-- 2. Cuentas no activas con sesiones marcadas activas (sin datos personales).
SELECT u.status, count(DISTINCT u.id) AS usuarios, count(s.id) AS sesiones
  FROM public.users u
  JOIN public.user_sessions s ON s."userId" = u.id
 WHERE u.status <> 'active' AND s.status = 'active'
 GROUP BY u.status;

-- 3. Suspendidos con actividad posterior a la suspensión (evidencia de uso).
SELECT count(DISTINCT u.id) AS suspendidos_con_uso_posterior
  FROM public.users u
  JOIN public.user_sessions s ON s."userId" = u.id
  JOIN public.audit_logs a
    ON a.entity_id = u.id::text AND a.action = 'SUSPEND'
 WHERE u.status = 'suspended'
   AND s."lastActivityAt" > a.created_at;

ROLLBACK;
```

Columnas de `audit_logs` confirmadas contra la entidad (`entity_id`, `action`, `created_at`).

## Pruebas

- `src/modules/auth/suspended-user-access.spec.ts`: activo; suspendido con token vigente (con y sin la versión en caché); varias sesiones; socket; reactivado con token anterior; reactivado con sesión nueva; suspensión con sesión en uso; fallo de Redis al cortar; los demás estados no activos.
- `src/modules/auth/services/token.service.spec.ts` («renovación de una cuenta que ya no está activa»): cada estado no activo y `deletedAt` no renuevan y revocan la familia; activo renueva.

Las cuentas de complejo (`entityType = complex`) siguen su propia regla: un complejo suspendido conserva la sesión para ver la pantalla de suspensión (`SubscriptionGuard` bloquea lo demás).
