# Registro de actividad de la Growth Suite

## Qué es un evento

Cada fila de `growth.activity_events` es una **operación completada**. El
servicio (`ActivityLogService.record`) escribe el evento dentro de la misma
transacción del cambio:

- si el cambio se confirma, su evento también;
- si el cambio falla o se rechaza (permiso, validación, conflicto, error de
  base), se revierte la transacción y **no queda evento**.

La tabla es append-only: un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE`.
`changes` no lleva datos personales en claro (`safeDiff`).

## Consulta (`growthActivity`)

| Filtro | Efecto |
|---|---|
| `actorUserId` | Solo con VIEW_GROWTH_ACTIVITY; sin él siempre se ve solo la propia |
| `entityType`, `entityId` | Historial de un registro |
| `actions` | Cualquiera de la lista (máx. 20, `MAYÚSCULAS_Y_GUIONES`) |
| `from` / `to` | Periodo: `from` incluido, `to` excluido; `from < to` |

Orden: del más reciente al más antiguo. Paginación estándar (máx. 100 por
página). Índices: `(actor_user_id, created_at)`, `(entity_type, entity_id,
created_at)`, `(action, created_at)` y `(created_at)`.

## Plantillas de importación

| Acción | Cuándo | `changes` |
|---|---|---|
| `IMPORT_TEMPLATE_CREATED` | Se crea una plantilla (también al mapear con `saveAsTemplate`) | `target`, `scope`, `columns` |
| `IMPORT_TEMPLATE_UPDATED` | Se renombra o cambia su mapeo | `target`, `scope`, `renamed?`, `columns?` |
| `IMPORT_TEMPLATE_SHARED` | Una personal pasa al equipo | `target`, `scope` |
| `IMPORT_TEMPLATE_ARCHIVED` | Se archiva | `target`, `scope` |

Ni los encabezados, ni el nombre, ni el motivo del archivado van a la actividad: pueden nombrar personas.

## Versiones del scoring (1E-C-0)

| Acción | Cuándo | `changes` |
|---|---|---|
| `SCORING_DRAFT_CREATED` | Se crea un borrador | `number`, `basedOn` |
| `SCORING_DRAFT_UPDATED` | Se editan reglas, umbrales o notas | `number`, `rules`, `thresholds` |
| `SCORING_DRAFT_DISCARDED` | Se descarta un borrador | `number` |
| `SCORING_VERSION_ACTIVATED` | Se aprueba y activa | `number`, `previous`, `thresholds`, `rules` |
| `SCORING_VERSION_RETIRED` | La versión anterior queda retirada | `number`, `replacedBy` |
| `SCORING_SELF_APPROVAL_EXCEPTION` | Un SUPER_ADMIN aprobó un borrador en el que participó, con la excepción encendida | `number` |

El motivo de un descarte no va a la actividad (queda en la versión, `retired_reason`).

## Limitación conocida: intentos fallidos

Hoy **no se registran los intentos rechazados o fallidos** (por ejemplo, una
fusión sin permiso o una validación que no pasa la lista de chequeo). Es una
decisión explícita de 1E-0: el registro responde "qué cambió y quién lo
cambió", no "qué se intentó".

Evolución futura de la auditoría (no implementada; requiere aprobación):

- tabla aparte (p. ej. `growth.denied_attempts`), también append-only, escrita
  **fuera** de la transacción del cambio para que sobreviva al rollback;
- sin datos personales ni valores enviados: operación, actor, código de error
  y entidad objetivo;
- política de retención propia, y alertas por repetición (posible abuso).
