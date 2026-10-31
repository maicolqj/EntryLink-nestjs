# EntryLink Growth Suite

Suite comercial interna de Alterna QJ: prospectos, equipo comercial, fuentes y
cumplimiento de protección de datos. **No es parte de la operación de los
conjuntos** y no toca datos de residentes.

- Se carga solo con `GROWTH_ENABLED=true` (`growth.loader.ts`, import dinámico).
- Tablas en el esquema PostgreSQL `growth`.
- Activación: `docs/growth/ACTIVATION.md`. Protección de datos:
  `docs/growth/DATA-PROTECTION.md`. Pruebas: `docs/growth/TESTING.md`.

## Reglas de aislamiento (verificadas por `growth-isolation.spec.ts`)

1. Desde aquí solo se importa `modules/shared/**` y los enums de
   `modules/roles` y `modules/permissions`. Nada de residentes, conjuntos,
   finanzas, notificaciones…
2. Fuera de la suite solo se importa `shared/growth-access.catalog` (seeds y
   el bloqueo de roles inactivos). `app.module.ts` importa únicamente
   `growth.loader`.
3. El único acceso a `public` es `shared/identity-directory.service.ts`, y solo
   a la identidad (`users`, `user_has_roles`, `roles`,
   `user_complex_assignments`). Es el puerto a reemplazar si la suite se
   extrae a un servicio aparte.
4. La única FK que sale del esquema apunta a `public.users(id)`.
5. Ningún input usa un campo llamado `complexId`: `ComplexModuleGuard` lo
   interpretaría como un conjunto.

## EntryLink Prospect (`prospects/`, entrega 1A)

- Empresas, personas y copropiedades con canales, vínculos laborales e historial de administración, evidencias por campo, asignaciones con historial y validación humana.
- `ProspectGuardsService` concentra:
  - fuente ACTIVE obligatoria;
  - visibilidad (sin `VIEW_ALL_GROWTH_PROSPECTS` solo lo propio o asignado; lo ajeno responde NOT_FOUND);
  - separación de funciones con la excepción de SUPER_ADMIN, auditada y desactivable.
- `LegalBasisService` es el único que cambia la base jurídica y la autorización de contacto. La base lo respalda con CHECK.
- Los datos personales (canales y evidencias de personas) se enmascaran en los resolvers de campo, no en la interfaz.

## Integridad

- Toda escritura registra su evento en `growth.activity_events` dentro de la
  misma transacción (`ActivityLogService.record(manager, …)`).
- `activity_events` y `suppression_hashes`: append-only (trigger).
  `suppressions`: no se borra; solo ACTIVE → LIFTED con soporte (trigger).
- `changes` del registro de actividad: usar `safeDiff`. Los campos personales
  quedan como `"modificado"`.

## Agregar un dominio (fase 1 en adelante)

1. Carpeta propia (`prospects/`, `crm/`…) con `entities/`, `dto/`,
   `services/`, `resolvers/`.
2. Entidades con `@Entity({ schema: 'growth', … })` y `@ObjectType('Growth…')`.
3. Migración con CHECK (no enums nativos) y FK solo dentro de `growth`, o a
   `public.users`.
4. Nuevos tipos de entidad: `GrowthEntityType` + el CHECK de
   `activity_events.entity_type` y `legal_holds.entity_type` + el mapa
   `HOLDABLE` de `LegalHoldsService`.
5. Permisos nuevos: `ValidPermissions` + `growth-access.catalog.ts` + una
   migración de enum (fuera de transacción) y otra de datos (inactivos).
6. Operaciones con `@Auth({ permissions: [...] })` y nombre `growth…`. La
   matriz de `growth-authorization.spec.ts` debe listar la operación nueva.
