import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { PanicDeliveryChannel } from '../enums/panic-delivery-channel.enum';

/**
 * Un intento de entrega de una alerta, por destino y canal.
 *
 * Es la única forma de saber si una alerta llegó de verdad. `sentAt` dice que la
 * mandamos; `deliveredAt` que el dispositivo confirmó haberla mostrado. La
 * diferencia entre ambos, cruzada con push_subscriptions, da la tasa real de
 * entrega por marca de dispositivo — el dato que decide si vale la pena seguir
 * invirtiendo en el cliente o si el problema hay que resolverlo escalando.
 *
 * También es lo que consulta el escalamiento para decidir si un nivel debe
 * dispararse o si ya alguien recibió la alerta.
 */
@ObjectType()
@Entity('panic_alert_deliveries')
@Index(['panicAlertId'])
@Index(['panicAlertId', 'channel'])
export class PanicAlertDelivery {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ name: 'panic_alert_id' })
  panicAlertId: string;

  /** Destinatario. NULL en canales sin destinatario individual (SOCKET). */
  @Field(() => String, { nullable: true })
  @Column({ name: 'user_id', nullable: true })
  userId?: string;

  /** push_subscriptions.id usado, cuando el canal es FCM. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'device_token_id', nullable: true })
  deviceTokenId?: string;

  @Field(() => PanicDeliveryChannel)
  @Column({ type: 'enum', enum: PanicDeliveryChannel })
  channel: PanicDeliveryChannel;

  /** 0 = envío inicial; 1..3 = nivel de escalamiento que lo originó. */
  @Field(() => Int)
  @Column({ name: 'escalation_level', type: 'int', default: 0 })
  escalationLevel: number;

  @Field()
  @CreateDateColumn({ name: 'sent_at' })
  sentAt: Date;

  /** Confirmado por el dispositivo al mostrar la alerta. */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt?: Date;

  /** Motivo del fallo, o por qué se saltó un canal no disponible. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string;
}
