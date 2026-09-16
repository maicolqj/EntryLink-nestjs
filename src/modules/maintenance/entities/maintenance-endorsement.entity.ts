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

import { MaintenanceTicket } from './maintenance-ticket.entity';

/**
 * "A mí también me pasa".
 *
 * Cuando el ascensor se daña, treinta vecinos abren treinta tickets del mismo
 * ascensor y el tablero deja de servir. La adhesión les da a los demás algo
 * que hacer con su reporte: en vez de otro ticket, un voto en el que ya
 * existe. Sirve dos veces —limpia el tablero y prioriza sin que nadie
 * discuta—, porque un daño que afecta a treinta unidades no se atiende igual
 * que uno que vio una sola persona.
 *
 * El índice único es el que sostiene la promesa: una adhesión por persona.
 */
@ObjectType({ description: 'Adhesión de un vecino a un ticket existente' })
@Entity({ name: 'maintenance_endorsements' })
@Index(['ticketId', 'userId'], { unique: true })
export class MaintenanceEndorsement {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Field(() => String)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => MaintenanceTicket, { nullable: true })
  @ManyToOne(() => MaintenanceTicket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: MaintenanceTicket;
}
