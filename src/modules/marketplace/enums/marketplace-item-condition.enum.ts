import { registerEnumType } from '@nestjs/graphql';

/** Estado de conservación del artículo. Solo aplica a publicaciones de venta. */
export enum MarketplaceItemCondition {
  NEW = 'NEW',
  LIKE_NEW = 'LIKE_NEW',
  USED = 'USED',
  FOR_PARTS = 'FOR_PARTS',
}

registerEnumType(MarketplaceItemCondition, {
  name: 'MarketplaceItemCondition',
  description: 'Estado de conservación del artículo',
  valuesMap: {
    NEW: { description: 'Nuevo, sin usar' },
    LIKE_NEW: { description: 'Como nuevo' },
    USED: { description: 'Usado, en buen estado' },
    FOR_PARTS: { description: 'Para repuestos o reparar' },
  },
});
