# Growth: administradoras desde el RUES (A) y ayudas de contacto (C) — diseño corto

**Fecha:** 2026-11-05 · **Estado:** propuesta, espera aprobación

## Intención

El dueño de la plataforma opera Growth solo y quiere llenar la suite con **administradoras de propiedad horizontal de Bogotá** sin pagar fuentes. Una administradora maneja varios conjuntos: es el cliente de mayor valor. Él valida cada registro.

## Fuente

RUES de Confecámaras en datos.gov.co, dataset `c82u-588k` (API Socrata, CC BY-SA 4.0, uso comercial permitido con atribución). Trae razón social, NIT, CIIU, estado y último año renovado. **No trae** dirección, teléfono ni correo.

Volumen en la Cámara de Bogotá (`codigo_camara='04'`), matrícula activa, personas jurídicas (consulta del 2026-11-05):

| Grupo | Filas |
|---|---|
| CIIU principal 8110 (administración de PH) | 667 (393 renovaron en 2025 o después) |
| CIIU secundaria 8110 | 485 |
| Razón social con «PROPIEDAD HORIZONTAL» y otro CIIU | 412 |

Descartadas: la capa de conjuntos de Gobierno Bogotá (licencia CC BY-NC, no comercial; queda para cuando haya concepto jurídico) y el RUA (consulta individual, sin descarga).

## Objetivos

- **A:** un archivo listo para `/growth/importaciones` con las administradoras, sin cambiar el backend.
- **C:** desde la ficha de una organización, enlaces que abren la búsqueda del contacto con el NIT o la razón social ya puestos.

## No objetivos

- Raspar sitios (RUES web, RUA, Google): ni A ni C leen páginas de terceros.
- Importar al representante legal como persona: es dato personal (Ley 1581). Se ve en el RUES desde el enlace de C.
- Conector automático en el backend (opción B): solo si A muestra que la lista sirve.
- Fuentes de pago.

## A — Exportación a CSV

- Script `scripts/growth/rues-administradoras.mjs` en el backend. Node, sin dependencias nuevas. Corre en el PC: no toca la base ni producción.
- Consulta Socrata paginada (1.000 por página), con los tres grupos de arriba, sin duplicados por NIT.
- Columnas con los nombres que el importador reconoce solo: `Razón social`, `NIT` (con dígito de verificación), `Ciudad` = Bogotá, más una columna `Observaciones` con el CIIU, el grupo y el último año renovado, que el mapeo deja sin usar.
- Un archivo por grupo, para importar primero el más confiable (CIIU principal 8110 renovado en 2025 o después) y medir.
- Encabezado del archivo y README con la atribución que exige CC BY-SA.
- Fuente en Growth: «RUES – Confecámaras (datos abiertos)», `PUBLIC_REGISTRY`, que el usuario registra y activa en `/growth/fuentes` con su revisión jurídica.
- Cuántos son, siempre menos que el tope de 5.000 filas por lote.

## C — Ayudas para conseguir el contacto (web)

- En la ficha de la organización (`/growth`), un bloque «Buscar contacto» con enlaces que abren en pestaña nueva:
  - RUES con el NIT;
  - RUA de Gobierno Bogotá (la página de consulta; el NIT se copia con un botón, porque no acepta parámetros en la URL);
  - Google con la razón social + «Bogotá» + «propiedad horizontal»;
  - LinkedIn (empresas) con la razón social.
- Botón «copiar NIT».
- Solo frontend; el teléfono o correo que encuentre se guarda con los formularios que ya existen, con su evidencia.
- La forma exacta de cada URL se verifica al construir; si alguna no acepta parámetros, el enlace va a la página de búsqueda.

## Orden

A (script + archivos) → el usuario importa el primer lote y valida unos cuantos → C (PR de la web).

## Decisiones del asistente (revisables)

- El grupo «nombre con PROPIEDAD HORIZONTAL» va en archivo aparte: es el más ruidoso.
- Se filtra a persona jurídica (`codigo_clase_identificacion='02'`, NIT); las 47 personas naturales con CIIU 8110 quedan fuera por ser datos personales.
