import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType({ description: 'Datos para que el residente inicie sesión enviando un mensaje de WhatsApp' })
export class WhatsAppLoginChallengeResponse {
  // Este id es el secreto real del flujo: no debe mostrarse en pantalla ni
  // compartirse. Guardarlo en memoria del cliente hasta canjearlo.
  @Field(() => ID, { description: 'Identificador del intento. Requerido para consultar estado y canjear' })
  challengeId: string;

  @Field(() => String, { description: 'Código que viaja en el mensaje. Público: solo identifica el intento' })
  nonce: string;

  @Field(() => String, { description: 'Link wa.me con el mensaje prellenado. Abrirlo en el mismo dispositivo' })
  whatsappUrl: string;

  @Field(() => String, { description: 'Texto exacto que debe enviarse, por si el link no abre' })
  messageText: string;

  @Field(() => Date, { description: 'Vencimiento del intento' })
  expiresAt: Date;

  @Field(() => String, { description: 'Advertencia a mostrar al usuario antes de que envíe el mensaje' })
  warning: string;
}
