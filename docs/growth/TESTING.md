# Growth Suite — Pruebas

## Unitarias (corren en CI)

```bash
yarn test src/modules/growth
```

| Spec | Qué asegura |
|---|---|
| `growth-access.catalog.spec.ts` | La migración de datos es copia fiel del catálogo; ningún rol operativo recibe permisos de la suite; nadie tiene `APPROVE_GROWTH_PAID_SOURCES`; roles y permisos nacen inactivos; el bloqueo de roles inactivos no afecta a los roles existentes |
| `growth-authorization.spec.ts` | Matriz rol × operación con el guard **real**: los 9 roles operativos no ejecutan ninguna operación; los roles de la suite solo lo suyo; un DENY por usuario quita el acceso; no existe ninguna operación de borrado o edición de exclusiones, actividad, solicitudes o retenciones |
| `growth-isolation.spec.ts` | Allow-list de imports con rutas resueltas (la suite no importa módulos operativos y nadie la importa); solo `IdentityDirectoryService` consulta `public` y solo tablas de identidad; las 7 entidades están en el esquema `growth` y sin relaciones cruzadas |
| `growth.flag.spec.ts` | Variable ausente = apagada |
| `*.service.spec.ts` | Reglas de exclusión (falla cerrada, re-hash, sin dato en claro), solicitudes (plazos, supresión agrega exclusión, borra contacto), fuentes (activación con revisión y costo, redefinir anula aprobaciones), equipo (rechaza usuarios de conjuntos) |
| `identifier-normalizer`, `growth-hash.service`, `business-days.util` | Normalización, llavero HMAC versionado y rotación, festivos de Colombia |

## Integración con Postgres real (local, no en CI)

Verifica que la **base** impone las reglas: triggers append-only, CHECK de
fuentes, exclusiones y retenciones, FK solo hacia `public.users`, y que las
entidades calzan con las tablas.

**Nunca contra producción ni contra la base de desarrollo.** La spec aborta si
el nombre de la base no contiene `test`.

```bash
# 1. Postgres desechable
docker run -d --name growth-pg-test -e POSTGRES_PASSWORD=<clave-local> \
  -e POSTGRES_DB=growth_test -p 127.0.0.1:55432:5432 postgis/postgis:17-3.5

# 2. Esquema base: las migraciones de main no corren desde una base vacía
#    (la primera supone tablas existentes). Se crea con synchronize desde un
#    checkout de origin/main y se marcan sus migraciones como aplicadas.

# 3. Migraciones de la suite
DB_HOST=127.0.0.1 DB_PORT=55432 DB_USERNAME=postgres PASSDB_POSTGRES=<clave-local> \
  DB_NAME=growth_test yarn migration:run

# 4. Pruebas
GROWTH_IT_DATABASE_URL=postgres://postgres:<clave-local>@127.0.0.1:55432/growth_test \
  yarn test:growth:int
```

Hay dos suites, que comparten la base y el helper de limpieza `test/growth/db-cleanup.ts`:

- `growth-db.int-spec.ts` (fase 0, 23 pruebas);
- `prospects-db.int-spec.ts` (entrega 1A, 22 pruebas):
  - fuente ACTIVE obligatoria y evidencia por campo;
  - NIT único y dígito de verificación;
  - trigger de transiciones de validación;
  - separación de funciones y excepción de SUPER_ADMIN auditada y desactivable;
  - requisitos de VALIDATED (empresa y administrador independiente: PROFESSIONAL o DIRECT con base documentada);
  - bloqueo jurídico en la base (CHECK) y en el servicio;
  - la vista de contactables;
  - lista de exclusión antes de guardar canales (correo y dominio);
  - historial de administración (una vigente) y de vínculos laborales;
  - asignaciones con historial;
  - visibilidad por asignación;
  - dashboard;
  - configuración no borrable.

Reversión: `yarn migration:revert` con las mismas variables (×3 para revertir solo 1A, ×6 para revertir también la fase 0). Tras revertir,
el `pg_dump --schema-only` debe ser igual al de antes de migrar, salvo los
valores de enum agregados, que Postgres no permite quitar.

## Esquema GraphQL con la bandera apagada

Con `GROWTH_ENABLED` ausente o en `false`, el esquema generado al arrancar debe
ser igual al de `main`, salvo 24 valores nuevos de los enums `ValidPermissions`
(21) y `ValidRoles` (3). Se verifica arrancando `dist/main` de los dos checkouts
contra servicios desechables y comparando sus `src/schema.gql` generados.
