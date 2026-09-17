import { ObjectType, Field } from '@nestjs/graphql';

import { MarketplaceContactPreference } from '../../enums/marketplace-contact-preference.enum';

/**
 * Cómo contactar a quien publicó, resuelto por el servidor.
 *
 * El teléfono NO sale de la entidad: depende del consentimiento de su dueño
 * (`showPhone`) y de si el conjunto permite ese canal
 * (`allowPhoneContact`), y las dos condiciones se evalúan al LEER. Si la
 * administración apaga el canal, los avisos que ya lo mostraban dejan de
 * hacerlo sin tener que tocar ninguna publicación.
 *
 * Que la regla viva en el servidor —y no en la pantalla— es lo que impide que
 * el número viaje igual en la respuesta y alguien lo saque del payload.
 */
@ObjectType({ description: 'Datos de contacto del publicador' })
export class ListingContactResponse {
  @Field(() => String, { description: 'Nombre visible del publicador' })
  displayName: string;

  @Field(() => String, { description: 'Unidad del publicador', nullable: true })
  unitLabel?: string | null;

  @Field(() => MarketplaceContactPreference)
  preference: MarketplaceContactPreference;

  @Field(() => String, {
    description: 'Teléfono. Nulo si no se destapó o el conjunto no lo permite',
    nullable: true,
  })
  phone?: string | null;

  @Field(() => Boolean, {
    description: 'El canal quedó reducido al aviso dentro de la app',
  })
  inAppOnly: boolean;
}
