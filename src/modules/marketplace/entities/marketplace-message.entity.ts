import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { MarketplaceMessageKind } from '../enums/marketplace-message-kind.enum';

/** Un mensaje del chat de un aviso. */
@ObjectType({ description: 'Mensaje del chat entre vecinos por un aviso' })
@Entity({ name: 'marketplace_messages' })
@Index(['conversationId', 'createdAt'])
export class MarketplaceMessage {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Field(() => String)
  @Column({ name: 'sender_user_id', type: 'uuid' })
  senderUserId: string;

  @Field(() => MarketplaceMessageKind)
  @Column({
    type: 'varchar',
    length: 20,
    default: MarketplaceMessageKind.TEXT,
  })
  kind: MarketplaceMessageKind;

  /**
   * El texto. En `PHONE_SHARED` es el número que su dueño decidió compartir con
   * ESTA persona: vive en el mensaje, no en el perfil. En `IMAGE` guarda la
   * llave del archivo en R2 y NUNCA sale al cliente: el servidor la vacía y
   * entrega `imagePath` en su lugar.
   */
  @Field(() => String)
  @Column({ type: 'text' })
  body: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Lo calcula el servidor para quien consulta. */
  @Field(() => Boolean)
  isMine?: boolean;

  /**
   * Ruta del API que sirve la foto (solo en `IMAGE`). Exige el token de un
   * participante —o de la administración si la conversación fue reportada—.
   */
  @Field(() => String, { nullable: true })
  imagePath?: string | null;
}
