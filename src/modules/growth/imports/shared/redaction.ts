/** Lo que queda en una celda en lugar de un correo o teléfono excluido. */
export const REDACTED = '[excluido]';

export function containsRedacted(value: string | undefined): boolean {
  return !!value && value.includes(REDACTED);
}
