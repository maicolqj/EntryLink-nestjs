# Growth Suite — Protección de datos personales

> Documento técnico, **no es un concepto jurídico**. Las bases de tratamiento,
> finalidades, plazos y textos aquí descritos requieren validación de un
> abogado con experiencia en la Ley 1581 de 2012 antes de tratar datos de
> personas naturales.

## 1. Bases de tratamiento: lo que NO se asume

El borrador inicial del diseño mencionaba una base `LEGITIMATE_B2B_PUBLIC_ROLE`.
**Se descarta como base general.** La Ley 1581 de 2012 parte de la
autorización previa, expresa e informada del titular (art. 9). Sus
excepciones (art. 10) son taxativas, y una de ellas es el *dato de naturaleza
pública*. El Decreto 1377 de 2013 y la jurisprudencia la delimitan de forma
estricta.

Por eso:

- Que un dato personal **aparezca publicado** en una fuente empresarial (sitio
  web, directorio, red profesional) **no lo convierte** en dato público ni
  autoriza su tratamiento comercial.
- El dato de una **persona jurídica** (razón social, NIT, dirección y teléfono
  corporativos) no es dato personal. El de la **persona natural** que la
  representa o trabaja allí sí lo es.
- La figura de "interés legítimo" del RGPD europeo **no existe** como base en
  la ley colombiana. No se usa por analogía.

### Bases previstas para la fase 1 (pendientes de validación jurídica)

| Valor técnico | Cuándo aplicaría | Estado |
|---|---|---|
| `PRIOR_AUTHORIZATION` | El titular autorizó, y la autorización queda registrada y verificable | requiere diseño de la prueba de autorización |
| `PUBLIC_DATA` | El dato es público según el art. 3 del Decreto 1377 (p. ej. la calidad de comerciante en el registro mercantil) | **validar caso por caso** con asesoría jurídica |
| `CONTRACT` | Relación contractual o precontractual solicitada por el titular | validar |
| `LEGAL_OBLIGATION` | Conservación exigida por ley | validar |
| `PENDING_LEGAL_REVIEW` | Valor por defecto | **bloquea cualquier contacto comercial** |

Implementado en la entrega 1A:

- Toda persona nace con `legal_basis = PENDING_LEGAL_REVIEW` y `contact_status = NOT_AUTHORIZED`, con fuente obligatoria y finalidad registrada (la explícita o la de la fuente).
- **CHECK `ck_growth_people_contact_requires_basis`:** `AUTHORIZED` exige una base distinta de pendiente, una referencia documentada y la revisión registrada, además de que la persona no esté anonimizada ni borrada. Ni la aplicación ni un `UPDATE` directo pueden saltárselo.
- **CHECK `ck_growth_people_legal_trace`:** una base distinta de pendiente exige referencia, revisor y fecha.
- Volver a `PENDING_LEGAL_REVIEW` revoca en la misma operación un contacto autorizado.
- Autorizar exige además que la persona esté VALIDATED. Validar **no** autoriza contacto.
- Outreach (fase 3) solo leerá `growth.v_contactable_person_channels`: canales verificados de personas `AUTHORIZED` con base válida. Además deberá consultar la lista de exclusión antes de cada envío.
- Los correos y teléfonos de personas, y sus evidencias, se enmascaran **en el servidor** para quien no tiene `VIEW_GROWTH_CONTACT_DATA`.
- Antes de guardar un correo, teléfono o sitio se consulta la lista de exclusión (correo y dominio). Si está excluido no se guarda, y el evento no conserva el dato.
- **Fusiones (1B):** si se fusionan dos personas y el sobreviviente tenía contacto `AUTHORIZED`, pasa a `REVOKED` y necesita una nueva autorización. La base jurídica no se combina: queda la del sobreviviente.
- `retention_review_at` = 12 meses desde la última verificación o interacción, calculado por trigger. La anonimización llega con la entrega 1E.

## 2. Finalidad

Cada fuente (`growth.data_sources.processing_purpose`) declara su finalidad.
La finalidad sembrada es un borrador:

> Identificación y contacto comercial B2B de empresas administradoras de
> propiedad horizontal y copropiedades en Colombia. Finalidad pendiente de
> validación jurídica.

Una fuente no se activa sin revisión jurídica aprobada y registrada (la base lo
impone). Cambiar su finalidad o sus términos anula la revisión.

## 3. Minimización

- **Lista de exclusión:** solo el tipo de identificador y su HMAC con una llave
  que no vive en la base. Nunca el correo, el teléfono o el NIT en claro.
- **Solicitudes de titulares:** el titular se identifica por HMAC. El medio de
  respuesta se borra al cerrar la solicitud.
- **Registro de actividad:** los campos personales que cambian se registran
  como `"modificado"`, sin su valor (`safeDiff`).
- **Logs:** la suite no registra datos de prospectos en los logs de la aplicación.

## 4. Lista de exclusión

- Nunca se elimina: lo impiden la aplicación (no hay operación) y la base (trigger).
- Ninguna solicitud del titular la levanta sola. Supresión, revocación y
  oposición resueltas **agregan** una exclusión.
- Levantarla es una operación explícita (`growthLiftSuppression`). Exige el
  permiso `LIFT_GROWTH_SUPPRESSIONS` (solo cumplimiento y SUPER_ADMIN),
  fundamento jurídico y soporte verificable. Queda en el historial, y la base
  impide revertirla o editarla de otra forma.
- Conservar el hash de alguien que pidió no ser contactado es el mínimo
  necesario para cumplir esa petición. **Validar con asesoría jurídica** el
  plazo de conservación de la exclusión.

## 5. Retención (diseño fijado; se implementa en la fase 1)

- Fecha de revisión = la más reciente entre la última verificación y la última
  interacción, **+ 12 meses**.
- Al vencer, el prospecto no convertido pasa a revisión. Si nadie lo justifica,
  se anonimiza: los datos personales se reemplazan, quedan agregados sin
  identificación y la exclusión se conserva si existía.
- Excepción: una **retención legal** vigente (`growth.legal_holds`) impide
  anonimizar. Toda retención tiene fecha de fin, de máximo 10 años (CHECK en
  la base). No existe la retención indefinida.
- Los 12 meses son un plazo de **revisión**, no una autorización para
  conservar indefinidamente.

## 6. Plazos de respuesta al titular

Implementados (pendientes de confirmación jurídica):

| Tipo | Plazo | Prórroga |
|---|---|---|
| Consulta (`ACCESS`) | 10 días hábiles | +5 |
| Reclamo (rectificación, supresión, revocación, oposición) | 15 días hábiles | +8 |

Los días hábiles excluyen fines de semana y festivos de Colombia (Ley 51 de
1983) y se cuentan desde el día hábil siguiente a la recepción, en hora de
Bogotá.

## 7. Pendiente de validación jurídica

1. Bases de tratamiento aplicables a cada tipo de contacto.
2. Si datos del registro mercantil (RUES) de comerciantes personas naturales califican como dato público y para qué finalidad.
3. Texto del aviso de privacidad del primer contacto y mecanismo de exclusión.
4. Plazo de conservación de la lista de exclusión.
5. Plazos de la sección 6.
6. Términos de uso de cada fuente antes de activarla.
