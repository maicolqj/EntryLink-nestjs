/**
 * Normaliza un teléfono colombiano a la forma que usa Meta: solo dígitos con
 * indicativo país, sin `+` (ej. `573001234567`).
 *
 * Es fuente única de verdad a propósito. El webhook de mensajes entrantes
 * compara el `from` que envía Meta contra el teléfono guardado en la BD, y esos
 * dos valores vienen con formatos distintos (`573001234567` vs `3001234567`).
 * Si cada lado normalizara por su cuenta, la comparación fallaría en silencio y
 * el login por WhatsApp entrante nunca confirmaría.
 */
export function normalizeColombianPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-().+]/g, '');

  if (cleaned.startsWith('57') && cleaned.length >= 11) return cleaned;

  return `57${cleaned}`;
}

/** Enmascara el teléfono para logs: nunca se registra completo. */
export function maskPhone(phone: string): string {
  return phone.replace(/\d{6}$/, '******');
}
