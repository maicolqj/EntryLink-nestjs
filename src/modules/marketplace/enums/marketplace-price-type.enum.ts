import { registerEnumType } from '@nestjs/graphql';

/**
 * Cómo se expresa el precio.
 *
 * Existe porque "sin precio" y "gratis" no son lo mismo, y confundirlos en la
 * tarjeta es la primera queja que llega: `ON_REQUEST` invita a preguntar,
 * `FREE` dice que no se cobra nada.
 */
export enum MarketplacePriceType {
  FIXED = 'FIXED',
  NEGOTIABLE = 'NEGOTIABLE',
  FREE = 'FREE',
  EXCHANGE = 'EXCHANGE',
  ON_REQUEST = 'ON_REQUEST',
}

registerEnumType(MarketplacePriceType, {
  name: 'MarketplacePriceType',
  description: 'Forma en que se expresa el precio',
  valuesMap: {
    FIXED: { description: 'Precio fijo' },
    NEGOTIABLE: { description: 'Precio negociable' },
    FREE: { description: 'Gratis' },
    EXCHANGE: { description: 'Permuta o intercambio' },
    ON_REQUEST: { description: 'A convenir: se pregunta al publicador' },
  },
});
