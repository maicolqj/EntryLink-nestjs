# Administradoras desde el RUES (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Script local que baja del RUES las administradoras de PH de Bogotá y escribe CSV listos para `/growth/importaciones`.

**Architecture:** Funciones puras (consultas, transformación, CSV) en un módulo aparte, probadas con `node --test`; un CLI delgado que pagina la API Socrata y escribe un archivo por grupo. No toca la base ni el backend en ejecución.

**Tech Stack:** Node 22 (`fetch`, `node:test`, `node:fs`), ESM `.mjs`, sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-05-growth-rues-administradoras-design.md`

## Global Constraints

- Fuente: `https://www.datos.gov.co/resource/c82u-588k.json`, licencia CC BY-SA 4.0; atribución en el archivo y el README.
- Filtro base: `codigo_camara='04' AND codigo_estado_matricula='01' AND codigo_clase_identificacion='02'`.
- Sin representante legal ni personas naturales en la salida.
- Encabezados exactos: `Razón social`, `NIT`, `Ciudad`, `Observaciones`.
- Máximo 5.000 filas por archivo (tope del importador).
- No raspar páginas; solo la API pública.

## Review Focus

- NIT con dígito de verificación que no cuadra → la fila sale igual (el importador la marca), nunca se inventa el dígito.
- Razón social con `;`, `,` o comillas → CSV citado correctamente.
- Mismo NIT en dos grupos → solo en el grupo de mayor confianza.
- La API devuelve error o una página vacía a mitad → el script falla con mensaje, no escribe archivos parciales.
- Acentos (Ñ, tildes) → UTF-8 con BOM para que Excel los muestre bien.

---

### Task 1: Funciones puras + pruebas

**Files:**
- Create: `scripts/growth/rues-administradoras.lib.mjs`
- Test: `scripts/growth/rues-administradoras.test.mjs`

**Interfaces:**
- Produces:
  - `GROUPS: Array<{ key: 'ciiu-principal-renovadas'|'ciiu-principal-antiguas'|'ciiu-secundaria'|'nombre-ph', label: string, where: string }>` en orden de confianza. `ciiu-principal-renovadas`: CIIU principal 8110 y `ultimo_ano_renovado >= '2025'`; `ciiu-principal-antiguas`: CIIU principal 8110 y renovado antes de 2025 o sin dato; `ciiu-secundaria`: secundaria 8110 y principal distinta; `nombre-ph`: `upper(razon_social) like '%PROPIEDAD HORIZONTAL%'` y ninguna de las dos en 8110.
  - `buildUrl(where: string, offset: number, limit = 1000): string` — `$select` solo de razon_social, nit, digito_verificacion, cod_ciiu_act_econ_pri, cod_ciiu_act_econ_sec, ultimo_ano_renovado; `$order=nit`.
  - `toRow(rec, groupLabel): { 'Razón social', NIT, Ciudad, Observaciones }` — NIT = `nit-digito` si hay dígito, si no `nit`; Ciudad = `Bogotá`; Observaciones = `RUES · CIIU <pri>/<sec> · <grupo> · renovado <año>`.
  - `dedupeAcrossGroups(groups: Array<{ key, rows }>): same` — conserva la primera aparición de cada NIT según el orden de `GROUPS`.
  - `toCsv(rows): string` — BOM, separador `;`, CRLF, celdas citadas si tienen `;`, `"` o salto de línea; primera línea de comentario no: la atribución va en el README (el importador leería la línea como encabezado).

- [ ] **Step 1: Pruebas** — `toRow` con y sin dígito; `toCsv` citando `ADMIN; "LA 80" S.A.S` como `"ADMIN; ""LA 80"" S.A.S"` y empezando con `﻿Razón social;NIT;Ciudad;Observaciones\r\n`; `dedupeAcrossGroups` deja el NIT repetido solo en el primer grupo; `buildUrl` contiene `codigo_camara='04'` y `$offset=2000`.
- [ ] **Step 2:** `node --test scripts/growth/` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementar las cinco exportaciones.
- [ ] **Step 4:** `node --test scripts/growth/` → PASS.
- [ ] **Step 5:** Commit.

### Task 2: CLI + README + ejecución real

**Files:**
- Create: `scripts/growth/rues-administradoras.mjs`, `scripts/growth/README-rues.md`

**Interfaces:**
- Consumes: todo lo de Task 1.
- Uso: `node scripts/growth/rues-administradoras.mjs [carpeta-salida]` (por defecto `./rues-salida`). Escribe `NN-<key>.csv` por grupo y un `resumen.txt` con conteos y fecha de consulta.

- [ ] **Step 1:** CLI: por grupo, pagina de a 1.000 hasta recibir menos de 1.000; respuesta no 200 o JSON inválido → `process.exit(1)` con el mensaje y sin escribir nada; todo se escribe al final. Si un grupo pasa de 5.000 filas, se parte en `-parte-N`.
- [ ] **Step 2:** README: qué es, licencia CC BY-SA 4.0 con atribución «Fuente: RUES – Confecámaras, datos.gov.co», cómo registrar la fuente en `/growth/fuentes` (PUBLIC_REGISTRY), orden de importación sugerido.
- [ ] **Step 3:** Correr contra la API real. Esperado: conteos cercanos a 393 / 274 / 485 / 412 (menos los NIT repetidos); abrir el primer CSV y revisar 5 filas.
- [ ] **Step 4:** Agregar `rues-salida/` al `.gitignore`. Commit, versión patch (`chore(release)`), PR en borrador desde `main`.
