import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';

import { User }               from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { MessageChannel }     from '../enums/message-channel.enum';
import { MessageType }        from '../enums/message-type.enum';

@ObjectType({ description: 'Mensaje enviado a residentes del complejo' })
@Entity({ name: 'sent_messages' })
@Index(['complexId', 'sentAt'])
@Index(['complexId', 'unitId'])
@Index(['sentByUserId'])
export class SentMessage {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== CLASIFICACIÓN ====================

  @Field(() => MessageChannel)
  @Column({ type: 'varchar', length: 20 })
  channel: MessageChannel;

  @Field(() => MessageType)
  @Column({ name: 'message_type', type: 'varchar', length: 30 })
  messageType: MessageType;

  @Field(() => String)
  @Column({ type: 'text' })
  body: string;

  // ==================== DESTINATARIOS ====================

  @Field(() => Int)
  @Column({ name: 'recipient_count', type: 'int' })
  recipientCount: number;

  @Field(() => [String])
  @Column({ name: 'recipient_phones', type: 'text', array: true })
  recipientPhones: string[];

  // ==================== FKs (MULTI-TENANT) ====================

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String)
  @Column({ name: 'sent_by_user_id', type: 'uuid' })
  sentByUserId: string;

  @Field(() => String)
  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Field(() => String, { description: 'Número de unidad desnormalizado para queries rápidas' })
  @Column({ name: 'unit_number', type: 'varchar', length: 50 })
  unitNumber: string;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @Column({ name: 'sent_at', type: 'timestamptz', default: () => 'NOW()' })
  sentAt: Date;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { nullable: true, description: 'Usuario que envió el mensaje' })
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sent_by_user_id' })
  sentBy?: User;
}
