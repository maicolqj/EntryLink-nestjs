import { registerEnumType } from '@nestjs/graphql';

/**
 * A qué vitrina pertenece la categoría.
 *
 * `SERVICE` ya existe aunque el directorio de servicios domésticos llegue
 * después: las dos vitrinas comparten tabla, y sembrar el discriminador ahora
 * evita una migración de datos cuando la segunda entre.
 */
export enum MarketplaceCategoryKind {
  CLASSIFIED = 'CLASSIFIED',
  SERVICE = 'SERVICE',
}

registerEnumType(MarketplaceCategoryKind, {
  name: 'MarketplaceCategoryKind',
  description: 'Vitrina a la que pertenece la categoría',
  valuesMap: {
    CLASSIFIED: { description: 'Clasificados y comercio interno' },
    SERVICE: { description: 'Directorio de servicios' },
  },
});
