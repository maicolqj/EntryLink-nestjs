# Administradoras de PH desde el RUES

Genera archivos CSV con las administradoras de propiedad horizontal de Bogotá para importarlas en Growth (`/growth/importaciones` → Organizaciones).

```bash
node scripts/growth/rues-administradoras.mjs            # escribe en ./rues-salida
node scripts/growth/rues-administradoras.mjs C:/ruta    # otra carpeta
node --test scripts/growth/rues-administradoras.test.mjs
```

Corre en el PC. Solo lee la API pública de datos.gov.co: no toca la base ni la API de la plataforma.

## Fuente y licencia

**RUES – Confecámaras**, publicado en datos.gov.co (dataset `c82u-588k`), licencia **CC BY-SA 4.0**. Se permite el uso comercial con atribución: «Fuente: RUES – Confecámaras, datos.gov.co». Si se publica una obra derivada de los datos, va con la misma licencia.

Filtro: Cámara de Comercio de Bogotá, matrícula **activa**, **persona jurídica** (NIT). Quedan fuera las personas naturales y el representante legal, porque son datos personales (Ley 1581). El representante se consulta en el RUES cuando haga falta.

El RUES **no trae** dirección, teléfono ni correo. Esos datos se buscan aparte y se guardan con su evidencia.

## Archivos

| Archivo | Qué trae | Confianza |
|---|---|---|
| `01-ciiu-principal-renovadas.csv` | Actividad principal 8110 (administración de PH), renovada en 2025 o después | Alta |
| `02-ciiu-principal-antiguas.csv` | Actividad principal 8110, renovación anterior | Media: puede estar inactiva |
| `03-ciiu-secundaria.csv` | 8110 como actividad secundaria | Media |
| `04-nombre-ph.csv` | «PROPIEDAD HORIZONTAL» en el nombre, con otra actividad | Baja: revisar |

Un NIT aparece solo en el primer archivo que lo trae. `resumen.txt` tiene los conteos y la fecha de la consulta.

Columnas: `Razón social`, `NIT` (con dígito de verificación), `Ciudad` y `Observaciones`. El importador reconoce las tres primeras solo. `Observaciones` lleva el CIIU, el grupo y el año de renovación, para leerlo en Excel; el importador no tiene campo de notas para organizaciones, así que en el mapeo queda sin usar.

## Antes de importar

1. En `/growth/fuentes`, registra la fuente «RUES – Confecámaras (datos abiertos)», tipo `PUBLIC_REGISTRY`, URL `https://www.datos.gov.co/d/c82u-588k`. Haz la revisión jurídica (licencia CC BY-SA 4.0, datos de personas jurídicas) y actívala.
2. Importa `01` primero, valida unas cuantas y sigue con los demás. El importador marca los duplicados por NIT contra lo que ya existe.
