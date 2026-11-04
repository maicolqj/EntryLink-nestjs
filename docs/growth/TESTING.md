# Growth Suite — Pruebas

## Unitarias (corren en CI)

```bash
yarn test src/modules/growth
```

| Spec | Qué asegura |
|---|---|
| `growth-access.catalog.spec.ts` | La migración de datos es copia fiel del catálogo; ningún rol operativo recibe permisos de la suite; nadie tiene `APPROVE_GROWTH_PAID_SOURCES`; roles y permisos nacen inactivos; el bloqueo de roles inactivos no afecta a los roles existentes |
| `growth-authorization.spec.ts` | Matriz rol × operación con el guard **real** (GraphQL y las dos rutas REST de importaciones): los 9 roles operativos no ejecutan ninguna operación; los roles de la suite solo lo suyo; un DENY por usuario quita el acceso; no existe ninguna operación de borrado o edición de exclusiones, actividad, solicitudes o retenciones |
| `growth-isolation.spec.ts` | Allow-list de imports con rutas resueltas (la suite no importa módulos operativos y nadie la importa); solo `IdentityDirectoryService` consulta `public` y solo tablas de identidad; las 7 entidades están en el esquema `growth` y sin relaciones cruzadas |
| `growth.flag.spec.ts` | Variable ausente = apagada |
| `*.service.spec.ts` | Reglas de exclusión (falla cerrada, re-hash, sin dato en claro), solicitudes (plazos, supresión agrega exclusión, borra contacto), fuentes (activación con revisión y costo, redefinir anula aprobaciones), equipo (rechaza usuarios de conjuntos) |
| `identifier-normalizer`, `growth-hash.service`, `business-days.util` | Normalización, llavero HMAC versionado y rotación, festivos de Colombia |
| `imports/shared/imports-shared.spec.ts` (1C) | Lectura de CSV (`;`, comillas, Windows-1252) y XLSX (solo la primera hoja, fórmulas por su valor guardado, bomba zip, límites de tamaño, filas y columnas); mapeo sugerido y sus errores; normalización por fila sin copiar valores en los errores; neutralización de fórmulas en el informe; enmascarado por valor; huella del mapeo; tope total de texto; redacción de excluidos en cualquier celda |

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

# 2-3. Atajo: recrea la base DESDE CERO (la borra, arma el esquema base y
#      corre las migraciones). Úsalo antes de cada corrida completa. Solo
#      acepta un Postgres local y un nombre que termine en _test.
GROWTH_IT_DATABASE_URL=postgres://postgres:<clave-local>@127.0.0.1:55432/growth_test   yarn test:growth:db

# O, paso a paso:
# 2. Esquema base: las migraciones de main no corren desde una base vacía
#    (la primera supone tablas existentes). El script crea public con
#    synchronize (sin las entidades de growth) y marca como aplicadas las
#    migraciones anteriores a la suite.
GROWTH_IT_DATABASE_URL=postgres://postgres:<clave-local>@127.0.0.1:55432/growth_test   npx ts-node -T test/growth/base-schema.ts

# 3. Migraciones de la suite
DB_HOST=127.0.0.1 DB_PORT=55432 DB_USERNAME=postgres PASSDB_POSTGRES=<clave-local> \
  DB_NAME=growth_test yarn migration:run

# 4. Pruebas
GROWTH_IT_DATABASE_URL=postgres://postgres:<clave-local>@127.0.0.1:55432/growth_test \
  yarn test:growth:int
```

**Una base para la suite y otra para probar a mano.** `growth-db` verifica el estado que dejan las migraciones (por ejemplo, roles y permisos de la suite inactivos). Si la misma base se usa para probar la web a mano, con permisos activados y datos sembrados, esa prueba falla con un mensaje que lo explica, y la confirmación de 500 filas se vuelve más lenta. En una base recién preparada tarda unos 40 ms por fila; en una base reutilizada, 110 a 130 ms. Para el navegador se usa otra base en el mismo contenedor, `growth_e2e_test`: se prepara con el mismo `yarn test:growth:db` (cambiando el nombre en la URL) y luego `seed permissions/roles/users`, el SQL de `ACTIVATION.md` §4, el usuario sembrado en `active` y una fuente aprobada. La API local la usa con `DB_NAME=growth_e2e_test`.

**Determinismo de `imports-db`:**
- la cola se sustituye por una captura y los trabajos se ejecutan en el mismo hilo, así que no hay workers que terminar;
- cada suite limpia el esquema `growth` al empezar (`db-cleanup.ts`) y usa contenido único;
- la confirmación de 500 filas tiene su propio presupuesto (300 ms por fila) e imprime lo medido;
- las pruebas que necesitan un lote confirmado usan un lote propio y pequeño, así que una falla en la de 500 no arrastra a las demás.

Resultado de referencia (2026-11-03, base recién preparada): 93/93 en dos corridas seguidas, con la confirmación de 500 filas en 19,6 a 20,9 s.

Hay cuatro suites, que comparten la base y el helper de limpieza `test/growth/db-cleanup.ts`:

- `growth-db.int-spec.ts` (fase 0, 23 pruebas);
- `imports-db.int-spec.ts` (entrega 1C, 24 pruebas). La cola se sustituye por una captura y los trabajos se ejecutan con el mismo procesador:
  - lote de 500 empresas con 40 filas con errores, NIT existentes (vincular), NIT repetidos en el archivo y correos excluidos;
  - la base rechaza `CREATE` en filas con errores, retroceder un lote terminado y borrarlo;
  - confirmación: todo nace `NEW` con evidencia de la fuente, el vínculo no cambia el registro y repetir no duplica;
  - el informe neutraliza fórmulas; la actividad no lleva datos;
  - archivo repetido, fuente inactiva, fecha futura, archivo binario o vacío;
  - mapeo nuevo contra trabajo viejo, cancelación durante la validación y `FAILED` tras reintentos;
  - personas (clase de canal obligatoria, base pendiente) y XLSX de copropiedades;
  - visibilidad por autor y enmascarado;
  - plantillas personales y del equipo: solo su dueño ve y cambia una personal (ni con permiso de gestión); un nombre repetido es error y no sobrescribe (también lo impide un índice único); `saveAsTemplate` crea una personal aparte aunque el equipo tenga una con el mismo nombre; solo la gestión crea, comparte, edita y archiva las del equipo; archivar las saca de la lista sin borrarlas y libera el nombre; un correo o teléfono como encabezado se rechaza y la actividad no lleva encabezados;
  - purga a 30 días, con retención legal y lote purgado inmutable;
  - ajustes de la revisión:
    - un dato excluido, mapeado o dentro de un texto, no aparece en ninguna columna de texto del esquema ni en el informe;
    - una exclusión agregada después de subir se redacta al validar;
    - dos confirmaciones simultáneas no duplican y la reanudación no reprocesa;
    - un XLSX amplificado se rechaza antes de guardar;
    - los lotes abandonados se cierran a los 7 días y luego se purgan;
    - la purga se aplica a COMMITTED, FAILED y CANCELLED, también con retención liberada o vencida.
- `dedupe-scoring-db.int-spec.ts` (entrega 1B, 14 pruebas):
  - señales de duplicado (correo, nombre, matrícula, dominio);
  - homónimos sin contexto común no se proponen;
  - un par descartado no se reabre;
  - fusión con elección por campo, traslado de relaciones y evidencias, absorbido como DUPLICATE y `merge_log` append-only;
  - la base no deja marcar DUPLICATE sin fusión ni modificar un fusionado;
  - administración vigente en ambas copropiedades;
  - revocación del contacto al fusionar personas;
  - scoring con base verificada o estimada;
  - umbrales y versión;
  - parámetros validados y predicado cerrado en la base;
  - recálculo desde la cola;
  - dashboard con prioridades.
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

Reversión: `yarn migration:revert` con las mismas variables (×3 por entrega: 1C, 1B, 1A y la fase 0). Tras revertir,
el `pg_dump --schema-only` debe ser igual al de antes de migrar, salvo los
valores de enum agregados, que Postgres no permite quitar.

## Esquema GraphQL con la bandera apagada

Con `GROWTH_ENABLED` ausente o en `false`, el esquema generado al arrancar debe
ser igual al de `main`, salvo 27 valores nuevos de los enums `ValidPermissions`
(24) y `ValidRoles` (3). Se verifica arrancando `dist/main` contra servicios
desechables y comparando el `src/schema.gql` generado con el de `main`, ambos
ordenados con `lexicographicSortSchema` (el orden de los tipos cambia entre
arranques). Con 1C la única diferencia es `IMPORT_GROWTH_DATA`.
