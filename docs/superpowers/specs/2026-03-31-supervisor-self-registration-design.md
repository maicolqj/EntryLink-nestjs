# Supervisor Self-Registration & Access Request Redesign

**Fecha:** 2026-03-31
**Estado:** Aprobado
**Módulos afectados:** `supervisor-visits`, `auth`, `users`, `notifications`

---

## Contexto y motivación

Antes de este cambio, el `COMPLEX_ROL` creaba manualmente las cuentas de supervisor mediante `createStaffMember`. El nuevo modelo permite que los supervisores se auto-registren en la plataforma y soliciten acceso a los complejos residenciales donde van a trabajar, sujeto a aprobación del administrador del complejo.

---

## Flujo completo

```
SUPERVISOR                                    ADMIN (COMPLEX_ROL)
──────────────────────────────────────────────────────────────────
1. registerSupervisor(nombre, email,
   contraseña, teléfono, documento)
   → recibe JWT, queda autenticado
   → sin complexId, sin acceso a operaciones

2. supervisorCheckIn(complexId, lat, lng)
   → error: NO_ASSIGNMENT

3. requestComplexAccess(complexId, lat, lng, message?)
   → valida GPS (mismo radio del complejo)
   → crea SupervisorAccessRequest { PENDING }
   → notifica al admin (push + badge campana)

4. "Solicitud enviada, espera aprobación"
                                              5. Recibe push notification:
                                                 "Nueva solicitud de acceso"
                                                 metadata: { requestId,
                                                 supervisorName, requestLat,
                                                 requestLng }

                                              6. Ve badge numérico en panel
                                                 (pendingAccessRequestsCount)

                                              7a. approveAccessRequest(requestId)
                                                  → crea UserComplexAssignment (ACTIVE)
                                                  → notifica supervisor (push + metadata)
                                              O
                                              7b. rejectAccessRequest(requestId, reason?)
                                                  → notifica supervisor (push + metadata)

8. Recibe push notification:
   APROBADO → puede hacer check-in
   RECHAZADO → ve motivo
```

---

## Sección 1: Auto-registro del supervisor

### Nuevo mutation público `registerSupervisor`

- **Ubicación:** `AuthResolver` — sigue el patrón de `loginWithEmail` y `loginWithSystemCode`. Decorador `@Public()`
- **Devuelve:** `AuthResponse` (accessToken + refreshToken + user) — queda autenticado de inmediato

### Input: `RegisterSupervisorInput`

| Campo | Tipo | Validaciones |
|-------|------|--------------|
| `fullName` | String | Requerido |
| `email` | String | Requerido, único en BD |
| `password` | String | Requerido, mínimo 8 caracteres |
| `phone` | String | Requerido |
| `documentNumber` | String | Requerido |

### Lógica del servicio

1. Verificar que el email no esté registrado → error `EMAIL_ALREADY_IN_USE`
2. Hashear contraseña con bcrypt
3. Crear `User` con `SUPERVISOR_ROL`
4. JWT resultante: `complexId = null`, `roles = ['SUPERVISOR_ROL']`
5. El supervisor queda en estado funcional pero sin acceso a ninguna operación de complejo

### Restricción en `createStaffMember`

- Se elimina `SUPERVISOR_ROL` de la lista `STAFF_ROLES` permitidos para `COMPLEX_ROL`
- `COMPLEX_ROL` ya no puede crear supervisores mediante este flujo

---

## Sección 2: Solicitud de acceso con validación GPS

### Cambios en entidad `SupervisorAccessRequest`

Dos nuevas columnas nullable para registrar la posición GPS del supervisor al solicitar:

| Columna BD | Campo entidad | Tipo | Nullable |
|-----------|--------------|------|----------|
| `request_lat` | `requestLat` | decimal(10,8) | Sí |
| `request_lng` | `requestLng` | decimal(11,8) | Sí |

Nullable porque si el complejo no tiene coordenadas configuradas, no se captura GPS.

### Input: `RequestComplexAccessInput` (modificado)

```graphql
input RequestComplexAccessInput {
  complexId: String!
  lat:       Float!        # nuevo — requerido
  lng:       Float!        # nuevo — requerido
  message:   String        # opcional
}
```

### Validaciones en `requestAccess()` (orden de ejecución)

1. Complejo existe → error `NOT_FOUND`
2. ¿Ya tiene asignación ACTIVA para ese complejo? → error `ALREADY_ASSIGNED`
3. ¿Ya tiene solicitud PENDING para ese complejo? → error `REQUEST_ALREADY_PENDING`
4. **Validación GPS:** la lógica Haversine de `assertGpsWithinComplex()` se extrae de `SupervisorVisitService` a una función utilitaria en `shared/utils/gps.utils.ts` para que pueda ser usada por ambos servicios sin crear dependencias circulares
   - Si el complejo tiene `latitude` y `longitude` configurados: el supervisor debe estar dentro del `gpsRadius` (default 200 m)
   - Si el complejo no tiene coordenadas: la validación se omite
5. Crear `SupervisorAccessRequest` con `requestLat = lat` y `requestLng = lng` (siempre se guardan — las columnas son nullable solo por compatibilidad de migración en filas existentes)

### Notificación al admin tras crear la solicitud

Llamada a `NotificationsService.notify()` inmediatamente después de guardar la solicitud:

```ts
{
  complexId:   request.complexId,
  userIds:     [complex.ownerId],        // COMPLEX_ROL del complejo
  type:        NotificationType.SYSTEM,
  priority:    NotificationPriority.HIGH,
  title:       'Nueva solicitud de acceso',
  body:        `${supervisorName} solicita acceso al complejo`,
  entityId:    request.id,
  entityType:  'SupervisorAccessRequest',
  metadata:    {
    requestId:      request.id,
    supervisorId:   request.supervisorId,
    supervisorName,
    requestLat:     request.requestLat,
    requestLng:     request.requestLng,
  },
}
```

Esto dispara: push notification (FCM/Web Push) + incrementa badge de campana del admin.

---

## Sección 3: Aprobar / Rechazar + Notificaciones al supervisor + Badge counter

### Notificación al supervisor tras aprobar

```ts
{
  complexId:  request.complexId,
  userIds:    [request.supervisorId],
  type:       NotificationType.SYSTEM,
  priority:   NotificationPriority.HIGH,
  title:      'Acceso aprobado',
  body:       `Tu solicitud de acceso a ${complexName} fue aprobada. Ya puedes hacer check-in`,
  entityId:   request.id,
  entityType: 'SupervisorAccessRequest',
  metadata:   { requestId: request.id, complexId: request.complexId, status: 'APPROVED' },
}
```

### Notificación al supervisor tras rechazar

```ts
{
  complexId:  request.complexId,
  userIds:    [request.supervisorId],
  type:       NotificationType.SYSTEM,
  priority:   NotificationPriority.MEDIUM,
  title:      'Solicitud rechazada',
  body:       `Tu solicitud de acceso a ${complexName} fue rechazada. Motivo: ${reason ?? 'Sin motivo'}`,
  entityId:   request.id,
  entityType: 'SupervisorAccessRequest',
  metadata:   { requestId: request.id, complexId: request.complexId, status: 'REJECTED', reason },
}
```

### Nueva query: `pendingAccessRequestsCount`

```graphql
# Roles: COMPLEX_ROL, SUPER_ADMIN_ROL
query PendingAccessRequestsCount($complexId: String!) {
  pendingAccessRequestsCount(complexId: $complexId)   # → Int
}
```

- `COUNT(*)` en `supervisor_access_requests` donde `complexId = $complexId` AND `status = 'PENDING'`
- El frontend usa este valor para el badge numérico en la sección "Supervisores" del panel
- Es independiente del badge de campana (notificaciones no leídas)

---

## Resumen de cambios por archivo

| Archivo | Cambio |
|---------|--------|
| `auth/auth.resolver.ts` | Nuevo mutation `registerSupervisor` (`@Public`) |
| `auth/services/auth.service.ts` | Nuevo método `registerSupervisor()` |
| `auth/dto/inputs/register-supervisor.input.ts` | Nuevo DTO |
| `supervisor-visits/entities/supervisor-access-request.entity.ts` | Columnas `requestLat`, `requestLng` |
| `supervisor-visits/dto/inputs/request-complex-access.input.ts` | Agregar `lat`, `lng` |
| `supervisor-visits/services/supervisor-access-request.service.ts` | GPS validation + notify admin + notify supervisor |
| `supervisor-visits/resolvers/supervisor-visit.resolver.ts` | Nueva query `pendingAccessRequestsCount` |
| `users/dto/inputs/create-staff-member.input.ts` | Remover `SUPERVISOR_ROL` de `STAFF_ROLES` |
| `shared/utils/gps.utils.ts` | Extraer `assertGpsWithinComplex()` y `calculateHaversineDistance()` como utilidades compartidas |
| `supervisor-visits/services/supervisor-visit.service.ts` | Usar la utilidad compartida en lugar de los métodos privados actuales |
| **Migración TypeORM** | Columnas `request_lat`, `request_lng` en `supervisor_access_requests` |

---

## Consideraciones de seguridad

- `registerSupervisor` es público pero crea cuentas sin acceso operacional — sin riesgo de escalada de privilegios
- La validación GPS en `requestComplexAccess` reutiliza la lógica Haversine ya auditada en `checkIn`
- Las notificaciones al supervisor usan el `complexId` de la solicitud como contexto, aunque el supervisor aún no tenga asignación activa a ese complejo
