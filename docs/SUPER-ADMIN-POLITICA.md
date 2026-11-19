# Política de SUPER_ADMIN

**Regla:** SUPER_ADMIN conserva sus privilegios administrativos ordinarios (pasar `@Auth` sin tener el rol o el permiso exigido, y operar sobre cualquier conjunto) **solo cuando las condiciones de seguridad se cumplen**. No hay paso implícito sobre lo que está apagado. Lo excepcional va por un mecanismo aparte, explícito y auditado de forma estructurada.

Complementa `docs/PERMISOS-ESTADO-ACTIVO.md`, `docs/ROLES-ESTADO-ACTIVO.md` y `docs/SESIONES-CUENTAS-NO-ACTIVAS.md`.

## Matriz de autorización

| # | Verificación | Dónde | Antes | Ahora | Riesgo que cubre | Impacto en lo existente | Pruebas |
|---|---|---|---|---|---|---|---|
| 1 | Roles y permisos exigidos por `@Auth`, con todos los permisos **activos** | `UniversalRolePermissionGuard` | Pasa sin tenerlos | **Igual**: pasa sin tenerlos | — (privilegio ordinario) | Ninguno | guard spec «8», int `permission-status-db` «8» |
| 2 | `@Auth` con algún permiso exigido **inactivo** | ídem | Pasa, con un `WARN` en el log | **Se niega**, como a cualquiera | Ejecutar lo que se apagó a propósito; rastro solo en texto | Hasta activarlos, SUPER_ADMIN no administra plantillas del equipo (`MANAGE_GROWTH_IMPORT_TEMPLATES`) ni activa versiones de scoring (`APPROVE_GROWTH_SCORING`). El scoring sigue con la versión activa. Cualquier otro permiso inactivo en producción (consulta 1 del inventario) deja de estar disponible también para SUPER_ADMIN | guard spec «8», int «8» |
| 3 | Verificación de permiso dentro de los servicios de Growth | `actorHas` | Pasa siempre | Solo si el permiso está **activo** (y `SUPER_ADMIN_ROL` activo) | Igual que el 2, por la vía de servicio (`VIEW_ALL`, datos de contacto, plantillas del equipo…) | Igual que el 2 | guard spec «actorHas» (2 casos) |
| 4 | `SUPER_ADMIN_ROL` inactivo | guard, `actorHas`, token | Paso completo | **Sin paso** (no puede quedar inactivo por la API; solo por SQL) | Un rol apagado que siguiera dando todo | Ninguno: `RolesService` no deja inactivarlo | guard spec «roles inactivos», `roles-status.spec` |
| 5 | `GROWTH_ENABLED` apagada | `growth.loader.ts` (import dinámico) | El módulo no existe: nadie entra | **Igual**. No hay excepción posible | — | Ninguno | `growth.flag` spec, esquema con y sin la bandera |
| 6 | Sesión, versión del token y cuenta activa | `AccessTokenValidatorService` (HTTP y socket) y renovación | No había excepción | **Igual**, y ahora un SUPER_ADMIN suspendido pierde la sesión como cualquiera | — | Ninguno | `suspended-user-access.spec` |
| 7 | Estado de permisos no verificable (> 120 s) | guard | 503, también SUPER_ADMIN | **Igual** | — | Ninguno | guard spec «503» |
| 8 | Restricciones de la base (CHECK, append-only, `PENDING_LEGAL_REVIEW`, lista de exclusión, únicos) | Postgres | No hay excepción | **Igual** | — | Ninguno | suites de integración de Growth |
| 9 | Separación de funciones de Growth (validar lo que registró, aprobar el scoring que propuso) | `assertSegregation`, `approvalDecision` | Excepción con `allow_super_admin_self_validation` | **Igual**: es el único mecanismo de excepción, explícito y auditado de forma estructurada (`growth.activity_events`, append-only) | Una sola persona en el equipo | Ninguno | int `prospects-db` y `scoring-versions-db` |
| 10 | Bloqueo por suscripción vencida o suspensión manual | `SubscriptionGuard` | No aplica a SUPER_ADMIN («rol de plataforma») | **Sin cambio** (ver abajo) | — | Quitarlo rompería la renovación | `subscription.guard.spec` |
| 11 | Módulos apagados del conjunto | `ComplexModuleGuard` | No aplica a SUPER_ADMIN | **Sin cambio** (ver abajo) | — | Quitarlo lo dejaría sin poder reencender un módulo | `complex-module.guard.spec` |
| 12 | Excepciones por usuario (GRANT/DENY) | `UserPermissionOverridesService` | No se le asignan a SUPER_ADMIN | **Igual** | — | Ninguno | `user-permission-overrides.service.spec` |
| 13 | Operar sobre cualquier conjunto (tenencia) | servicios (`isSuperAdmin`) | Permitido | **Igual**: privilegio administrativo ordinario | — | Ninguno | specs de cada módulo |

### Por qué no cambian el 10 y el 11

- **Suscripción.** El bloqueo solo aplica a los roles de la administración del conjunto (`COMPLEX_ROL`, `ACCOUNTANT_ROL`), porque la deuda es entre la administración y la plataforma. SUPER_ADMIN no es el deudor: es quien aprueba el pago y quien levanta la suspensión manual. El guard solo conoce el conjunto del token, no el de la operación. Quitarle el paso solo afectaría al SUPER_ADMIN que además es contador de un conjunto suspendido, y lo dejaría sin poder aprobar el pago que lo desbloquea. No hay forma de saltarse un bloqueo de seguridad por esta vía: el guard ya falla abierto ante errores de Redis o de la base, y eso no depende del rol.
- **Módulos.** El interruptor de módulos es configuración comercial, no un bloqueo de seguridad, y quien lo mueve es SUPER_ADMIN. Bloquearlo con su propio interruptor lo dejaría sin poder volver a encenderlo.

Los dos pasos son explícitos en el código y aparecen en esta matriz. Si se quiere trazabilidad, el siguiente paso es registrar su uso en `audit_logs` (ver abajo).

## Auditoría de excepciones

| Excepción | Dónde queda | Cómo se consulta |
|---|---|---|
| Auto-validación de un prospecto | `growth.activity_events`, acción `SELF_VALIDATION_EXCEPTION` (append-only, con actor, entidad y fecha) | `growthActivity(filter: { actions: [SELF_VALIDATION_EXCEPTION] })`, o `SELECT … FROM growth.activity_events WHERE action = 'SELF_VALIDATION_EXCEPTION'` |
| Auto-aprobación de una versión de scoring | ídem, `SCORING_SELF_APPROVAL_EXCEPTION` | ídem |
| ~~Uso de un permiso inactivo por SUPER_ADMIN~~ | Ya no existe: se niega | — |

Ningún paso de SUPER_ADMIN depende ya de un mensaje de texto en el log.

## Operaciones excepcionales de recuperación (diseño; no implementado)

Cuando haga falta algo que la regla impide (por ejemplo, una acción urgente que exige un permiso todavía inactivo), no se agrega un paso implícito. El camino es:

1. **Activar el permiso**, con `PermissionsService.update` o con el SQL de §13 de `docs/growth/ACTIVATION.md`. Ese SQL ya sube `tokenVersion`. El cambio queda en la base (`permissions.updated_at`) y en el despliegue.
2. Si se necesita un mecanismo de urgencia aparte («break-glass»), se propone:
   - una mutación `platformBreakGlass(permission, reason, minutes ≤ 60)`, solo para SUPER_ADMIN, que exige un segundo factor (la contraseña otra vez);
   - activa el permiso **solo para quien la pide**, con un GRANT temporal en `user_permission_overrides` que vence solo;
   - deja una fila en `audit_logs`, acción `BREAK_GLASS`, con actor, permiso, motivo, IP, sesión y vencimiento, y avisa por correo a los demás SUPER_ADMIN;
   - un cron retira el GRANT al vencer y sube `tokenVersion`.

   Requiere aprobación: agrega un valor al enum de auditoría y una operación nueva al contrato GraphQL.

## Antes de desplegar (requiere autorización)

Correr la consulta 1 de `INTEGRACION-GROWTH/01-inventario-permisos.sql` (permisos inactivos) en producción. Lo que salga deja de estar disponible también para SUPER_ADMIN. Esperado: `MANAGE_GROWTH_IMPORT_TEMPLATES` y `APPROVE_GROWTH_SCORING`. Para cada uno: activarlo (§13) o aceptar que nadie lo use hasta decidirlo.
