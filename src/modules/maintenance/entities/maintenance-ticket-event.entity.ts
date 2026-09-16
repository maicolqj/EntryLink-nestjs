import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { MaintenanceEventType } from '../enums/maintenance-event-type.enum';
import { MaintenanceTicketStatus } from '../enums/maintenance-ticket-status.enum';
import { MaintenanceTicket } from './maintenance-ticket.entity';
import { textArrayTransformer } from '../utils/text-array.transformer';
import { User } from '../../users/entities/user.entity';

/**
 * Un renglón de la bitácora del ticket. Solo crece: no se edita ni se borra.
 *
 * Es lo que convierte el ticket en algo rastreable y no en un estado suelto.
 * "En reparación" no le dice nada a nadie; "el técnico de ascensores llegó a
 * las 3:10 y falta la tarjeta electrónica, llega el jueves" sí. Y cuando el
 * consejo pregunte por qué el ascensor estuvo doce días parado, la respuesta
 * está aquí y con fechas de servidor, no en la memoria del administrador.
 *
 * `isInternal` separa la conversación de la administración con el proveedor de
 * lo que ve quien reportó. Sin esa marca, o se pierde la nota interna o el
 * residente termina leyendo la negociación del precio.
 */
@ObjectType({ description: 'Anotación en la bitácora de un ticket' })
@Entity({ name: 'maintenance_ticket_events' })
@Index(['ticketId', 'createdAt'])
@Index(['complexId', 'type'])
export class MaintenanceTicketEvent {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Field(() => MaintenanceEventType)
  @Column({ type: 'varchar', length: 30 })
  type: MaintenanceEventType;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Field(() => MaintenanceTicketStatus, { nullable: true })
  @Column({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus?: MaintenanceTicketStatus | null;

  @Field(() => MaintenanceTicketStatus, { nullable: true })
  @Column({ name: 'to_status', type: 'varchar', length: 20, nullable: true })
  toStatus?: MaintenanceTicketStatus | null;

  @Field(() => [String], {
    description: 'Fotos de avance (R2)',
    nullable: true,
  })
  @Column({
    name: 'image_urls',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  imageUrls: string[];

  @Field(() => [String], { nullable: true })
  @Column({
    name: 'image_hashes',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  imageHashes: string[];

  /** Nota que solo ve la administración: costos, quejas del proveedor, criterio. */
  @Field(() => Boolean)
  @Column({ name: 'is_internal', type: 'boolean', default: false })
  isInternal: boolean;

  // ─── Quién lo anotó ───────────────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'author_role', type: 'varchar', length: 50, nullable: true })
  authorRole?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'author_name', type: 'varchar', length: 200, nullable: true })
  authorName?: string | null;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  /** Hora del servidor. No hay `updatedAt`: la bitácora no se corrige. */
  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => MaintenanceTicket, { nullable: true })
  @ManyToOne(() => MaintenanceTicket, (ticket) => ticket.events, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: MaintenanceTicket;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_user_id' })
  author?: User;
}
