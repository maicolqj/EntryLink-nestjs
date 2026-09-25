import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';

import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { MarketplaceListingStatus } from '../../enums/marketplace-listing-status.enum';
import { MarketplaceListingType } from '../../enums/marketplace-listing-type.enum';
import { MarketplaceMessage } from '../../entities/marketplace-message.entity';

/** De qué lado de la conversación está quien consulta. */
export enum ConversationRole {
  OWNER = 'OWNER',
  INTERESTED = 'INTERESTED',
}

registerEnumType(ConversationRole, {
  name: 'ConversationRole',
  description: 'Lado de la conversación de quien consulta',
  valuesMap: {
    OWNER: { description: 'Publicó el aviso' },
    INTERESTED: { description: 'Se interesó en el aviso' },
  },
});

@ObjectType({ description: 'El aviso del que se habla, en corto' })
export class ConversationListingSummary {
  @Field(() => String)
  id: string;

  @Field(() => String)
  title: string;

  @Field(() => MarketplaceListingType)
  type: MarketplaceListingType;

  @Field(() => MarketplaceListingStatus)
  status: MarketplaceListingStatus;

  @Field(() => String, { nullable: true })
  imageUrl?: string | null;

  @Field(() => String, { description: 'Precio ya formateado para mostrar' })
  priceLabel: string;
}

/**
 * El otro vecino. Nombre, foto y unidad —lo mismo que ya muestra la ficha del
 * aviso—; nunca teléfono ni correo. El teléfono solo llega como mensaje
 * `PHONE_SHARED` cuando su dueño decide compartirlo.
 */
@ObjectType({ description: 'El otro participante de la conversación' })
export class ConversationCounterpart {
  @Field(() => String)
  name: string;

  @Field(() => String, { nullable: true })
  profilePicture?: string | null;

  @Field(() => String, { nullable: true })
  unitLabel?: string | null;
}

@ObjectType({ description: 'Conversación vista desde quien consulta' })
export class MarketplaceConversationView {
  @Field(() => String)
  id: string;

  @Field(() => ConversationRole)
  role: ConversationRole;

  @Field(() => ConversationListingSummary)
  listing: ConversationListingSummary;

  @Field(() => ConversationCounterpart)
  counterpart: ConversationCounterpart;

  @Field(() => String, { nullable: true })
  lastMessagePreview?: string | null;

  @Field(() => Date, { nullable: true })
  lastMessageAt?: Date | null;

  @Field(() => Boolean, { description: 'El último mensaje lo escribí yo' })
  lastMessageIsMine: boolean;

  @Field(() => Int, { description: 'Mensajes sin leer de quien consulta' })
  unreadCount: number;

  @Field(() => Date, {
    nullable: true,
    description: 'Hasta cuándo leyó el otro; sirve para el "visto"',
  })
  counterpartLastReadAt?: Date | null;

  @Field(() => Boolean, {
    description:
      'El aviso se cerró, venció o se retiró —o la administración cerró el chat—: se lee pero no se escribe',
  })
  isReadOnly: boolean;

  @Field(() => Boolean, {
    description: 'La administración cerró la conversación por un reporte',
  })
  closedByModeration: boolean;

  @Field(() => Boolean, {
    description: 'Quien consulta tiene un reporte pendiente sobre este chat',
  })
  reportedByMe: boolean;

  @Field(() => Boolean, {
    description: 'No se puede escribir porque alguno bloqueó al otro',
  })
  isBlocked: boolean;

  @Field(() => Boolean, { description: 'Quien consulta bloqueó al otro' })
  blockedByMe: boolean;

  @Field(() => Boolean, {
    description: 'Quien consulta ya compartió su WhatsApp aquí',
  })
  myPhoneShared: boolean;

  @Field(() => Boolean, {
    description: 'El conjunto permite compartir el teléfono',
  })
  canSharePhone: boolean;
}

@ObjectType()
export class PaginatedConversationsResponse {
  @Field(() => [MarketplaceConversationView])
  items: MarketplaceConversationView[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

@ObjectType({
  description: 'Mensajes sin leer, en total y por tablero',
})
export class MarketplaceUnreadSummary {
  @Field(() => Int)
  total: number;

  @Field(() => Int, { description: 'De avisos de clasificados' })
  classifieds: number;

  @Field(() => Int, { description: 'Del directorio de servicios' })
  services: number;
}

@ObjectType({ description: 'Página de mensajes, del más nuevo al más viejo' })
export class MarketplaceMessagesPage {
  @Field(() => [MarketplaceMessage])
  items: MarketplaceMessage[];

  @Field(() => Boolean, { description: 'Hay mensajes más viejos' })
  hasMore: boolean;
}
