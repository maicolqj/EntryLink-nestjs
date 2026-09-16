import { registerEnumType } from '@nestjs/graphql';

/**
 * Por dónde quiere que lo contacten quien publica.
 *
 * `IN_APP` es el valor seguro y el que se usa por defecto: el interesado pulsa
 * "me interesa", al publicador le llega un aviso con el nombre y la unidad, y
 * es él quien decide devolver el contacto. El teléfono solo viaja si su dueño
 * lo destapó a propósito (`showPhone`) y el complejo permite ese canal.
 */
export enum MarketplaceContactPreference {
  IN_APP = 'IN_APP',
  PHONE = 'PHONE',
  WHATSAPP = 'WHATSAPP',
}

registerEnumType(MarketplaceContactPreference, {
  name: 'MarketplaceContactPreference',
  description: 'Canal por el que el publicador quiere recibir interesados',
  valuesMap: {
    IN_APP: { description: 'Aviso dentro de la app, sin exponer el teléfono' },
    PHONE: { description: 'Llamada al teléfono del publicador' },
    WHATSAPP: { description: 'WhatsApp al teléfono del publicador' },
  },
});
