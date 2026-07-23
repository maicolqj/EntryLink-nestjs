import { registerEnumType } from '@nestjs/graphql';

/**
 * Audiencia de un documento legal:
 *  - PUBLIC: visible en /legal público (Términos, Privacidad).
 *  - COMPLEX: solo visible/descargable para complejos ya registrados
 *             (autenticados como COMPLEX_ROL). Ej: Anexo B2B / DPA a firmar.
 */
export enum LegalAudience {
  PUBLIC = 'PUBLIC',
  COMPLEX = 'COMPLEX',
}

registerEnumType(LegalAudience, {
  name: 'LegalAudience',
  description: 'Audiencia de un documento legal (público o solo complejos registrados)',
});
