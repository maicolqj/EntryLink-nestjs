import { registerEnumType } from '@nestjs/graphql';

/**
 * Dónde está la publicación dentro de su ciclo de vida.
 *
 * `PENDING_REVIEW` solo existe cuando el complejo modera antes de publicar; con
 * moderación automática la publicación nace en `PUBLISHED`. `PAUSED` es el
 * estado al que caen las publicaciones reportadas: ocultarlas no es borrarlas,
 * y quien las escribió tiene derecho a que vuelvan si el reporte no procede.
 */
export enum MarketplaceListingStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  PUBLISHED = 'PUBLISHED',
  REJECTED = 'REJECTED',
  PAUSED = 'PAUSED',
  SOLD = 'SOLD',
  EXPIRED = 'EXPIRED',
  REMOVED = 'REMOVED',
}

registerEnumType(MarketplaceListingStatus, {
  name: 'MarketplaceListingStatus',
  description: 'Estado de la publicación',
  valuesMap: {
    DRAFT: { description: 'Borrador: solo la ve quien la escribió' },
    PENDING_REVIEW: {
      description: 'Esperando aprobación de la administración',
    },
    PUBLISHED: { description: 'Visible para el conjunto' },
    REJECTED: { description: 'La administración la rechazó, con motivo' },
    PAUSED: {
      description: 'Oculta temporalmente (por el dueño o por reportes)',
    },
    SOLD: { description: 'Ya se vendió o se entregó' },
    EXPIRED: { description: 'Venció la vigencia y nadie la renovó' },
    REMOVED: { description: 'Retirada definitivamente' },
  },
});
