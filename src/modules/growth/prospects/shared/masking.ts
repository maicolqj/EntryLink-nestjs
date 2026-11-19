import { GrowthChannelKind } from '../prospects.enums';

/**
 * Enmascaramiento de datos personales para quien no tiene
 * VIEW_GROWTH_CONTACT_DATA. Se aplica en el servidor (resolvers de campo),
 * no en la interfaz.
 */

export function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const prefix = value.startsWith('+57') ? '+57 ' : '';
  return `${prefix}*** *** **${digits.slice(-2)}`;
}

export function maskGeneric(value: string): string {
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function maskChannel(kind: GrowthChannelKind, value: string): string {
  switch (kind) {
    case GrowthChannelKind.EMAIL:
      return maskEmail(value);
    case GrowthChannelKind.PHONE:
      return maskPhone(value);
    default:
      return maskGeneric(value);
  }
}

/** Para evidencias: el tipo de canal se deduce del valor. */
export function maskObservedValue(value: string): string {
  if (value.includes('@')) return maskEmail(value);
  if (/^\+?[\d\s()-]{7,}$/.test(value)) return maskPhone(value);
  return maskGeneric(value);
}
