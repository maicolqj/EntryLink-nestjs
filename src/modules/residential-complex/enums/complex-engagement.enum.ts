import { registerEnumType } from '@nestjs/graphql';

/**
 * Cómo se vinculó el conjunto a la plataforma.
 *
 *  - PILOT: prueba piloto. Firma el acuerdo de piloto (que trae las cláusulas
 *    de encargado del tratamiento de datos), recibe la prueba gratis sola al
 *    activarse y puede cargar las unidades que declaró.
 *  - COMMERCIAL: contrato comercial. Firma el Anexo B2B (DPA).
 *
 * Lo decide el SUPER_ADMIN; define qué documento descarga y firma el conjunto.
 */
export enum ComplexEngagement {
  PILOT = 'PILOT',
  COMMERCIAL = 'COMMERCIAL',
}

registerEnumType(ComplexEngagement, {
  name: 'ComplexEngagement',
  description: 'Tipo de vinculación del conjunto: prueba piloto o comercial',
  valuesMap: {
    PILOT: { description: 'Prueba piloto (firma el acuerdo de piloto)' },
    COMMERCIAL: { description: 'Comercial (firma el Anexo B2B / DPA)' },
  },
});

/** Días de prueba del piloto cuando el SUPER_ADMIN no elige otros. */
export const DEFAULT_PILOT_TRIAL_DAYS = 30;

/** Nombre del documento firmado según la vinculación, para avisos y descargas. */
export function signedDocumentLabel(engagement?: ComplexEngagement | null): {
  label: string;
  fileSlug: string;
} {
  return engagement === ComplexEngagement.PILOT
    ? { label: 'acuerdo de prueba piloto', fileSlug: 'acuerdo-piloto-firmado' }
    : { label: 'Anexo B2B (DPA)', fileSlug: 'dpa-firmado' };
}
