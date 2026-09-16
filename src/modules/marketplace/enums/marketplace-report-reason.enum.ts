import { registerEnumType } from '@nestjs/graphql';

/**
 * Por qué un vecino reporta una publicación.
 *
 * `PROHIBITED_ITEM` es el que importa de verdad: es la vía por la que la
 * administración se entera de préstamos de dinero, rifas o licor antes de que
 * el reglamento le estalle en una asamblea.
 */
export enum MarketplaceReportReason {
  PROHIBITED_ITEM = 'PROHIBITED_ITEM',
  SCAM = 'SCAM',
  OFFENSIVE = 'OFFENSIVE',
  WRONG_CATEGORY = 'WRONG_CATEGORY',
  DUPLICATE = 'DUPLICATE',
  ALREADY_SOLD = 'ALREADY_SOLD',
  OTHER = 'OTHER',
}

registerEnumType(MarketplaceReportReason, {
  name: 'MarketplaceReportReason',
  description: 'Motivo del reporte sobre una publicación',
  valuesMap: {
    PROHIBITED_ITEM: {
      description: 'Artículo o actividad prohibida por el reglamento',
    },
    SCAM: { description: 'Estafa o engaño' },
    OFFENSIVE: { description: 'Contenido ofensivo o inapropiado' },
    WRONG_CATEGORY: { description: 'Categoría equivocada' },
    DUPLICATE: { description: 'Publicación repetida' },
    ALREADY_SOLD: { description: 'Ya se vendió y sigue publicada' },
    OTHER: { description: 'Otro motivo' },
  },
});
