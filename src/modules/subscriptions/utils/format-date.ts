/** Fecha legible en hora de Colombia: "15 de octubre de 2026". */
export function formatBogotaDate(date: Date): string {
  return date.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
