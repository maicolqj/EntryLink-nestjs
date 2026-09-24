import { registerEnumType } from '@nestjs/graphql';

/**
 * Qué es un mensaje del chat.
 *
 * `PHONE_SHARED` es aparte del texto normal para que la app lo pinte con el
 * botón de WhatsApp y llamar: es la única forma en que un número viaja entre
 * vecinos, y siempre porque su dueño lo decidió.
 */
export enum MarketplaceMessageKind {
  TEXT = 'TEXT',
  PHONE_SHARED = 'PHONE_SHARED',
}

registerEnumType(MarketplaceMessageKind, {
  name: 'MarketplaceMessageKind',
  description: 'Tipo de mensaje del chat de clasificados',
  valuesMap: {
    TEXT: { description: 'Mensaje de texto' },
    PHONE_SHARED: {
      description: 'Su autor compartió su WhatsApp con esta persona',
    },
  },
});
