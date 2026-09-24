import { registerEnumType } from '@nestjs/graphql';

/**
 * Qué parte del público de un aviso se consulta.
 *
 * Solo la administración lo ve: al autor le llegan los contadores y el aviso
 * de cada "me interesa", pero nunca la lista de quién guardó su aviso.
 */
export enum MarketplaceAudienceKind {
  FAVORITES = 'FAVORITES',
  INTERESTED = 'INTERESTED',
}

registerEnumType(MarketplaceAudienceKind, {
  name: 'MarketplaceAudienceKind',
  description: 'Público de una publicación que se consulta',
  valuesMap: {
    FAVORITES: { description: 'Quienes tocaron el corazón (me gusta)' },
    INTERESTED: { description: 'Quienes tocaron el botón me interesa' },
  },
});
