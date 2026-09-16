import { registerEnumType } from '@nestjs/graphql';

/**
 * Qué se publica. No es una etiqueta decorativa: decide qué campos exige el
 * formulario (un producto tiene estado de conservación, un servicio no) y qué
 * pestaña del tablero lo recoge.
 */
export enum MarketplaceListingType {
  PRODUCT = 'PRODUCT',
  SERVICE = 'SERVICE',
  RENTAL = 'RENTAL',
  GIVEAWAY = 'GIVEAWAY',
  WANTED = 'WANTED',
}

registerEnumType(MarketplaceListingType, {
  name: 'MarketplaceListingType',
  description: 'Naturaleza de la publicación del clasificado',
  valuesMap: {
    PRODUCT: { description: 'Venta de un artículo' },
    SERVICE: { description: 'Servicio ofrecido por un vecino' },
    RENTAL: { description: 'Arriendo o préstamo temporal' },
    GIVEAWAY: { description: 'Se regala o se dona' },
    WANTED: {
      description:
        'Busco / necesito. El complejo puede apagarlo desde los ajustes',
    },
  },
});
