import { registerEnumType } from '@nestjs/graphql';

/**
 * Si la administración revisa antes de publicar.
 *
 * Nace en `PREVIA` a propósito: el conjunto que enciende el módulo por primera
 * vez no sabe qué va a publicar su gente, y aflojar después es un clic. Al
 * revés —descubrir en abierto lo que no debió publicarse— cuesta una asamblea.
 */
export enum MarketplaceModerationMode {
  AUTO = 'AUTO',
  PREVIA = 'PREVIA',
}

registerEnumType(MarketplaceModerationMode, {
  name: 'MarketplaceModerationMode',
  description: 'Política de moderación de publicaciones',
  valuesMap: {
    AUTO: {
      description: 'Se publica de inmediato; se modera si alguien reporta',
    },
    PREVIA: { description: 'La administración aprueba antes de publicar' },
  },
});
