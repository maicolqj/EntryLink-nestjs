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

import { Amenity } from './amenity.entity';

/**
 * Bloqueo puntual de una zona común: mantenimiento, fumigación, evento de la
 * administración o festivo en que no se presta el servicio.
 *
 * Se resta del horario semanal en el motor de disponibilidad. Al crearse
 * cancela las reservas activas que caigan dentro del rango — un bloqueo que
 * conviva con reservas vigentes sería una promesa que el complejo no puede
 * cumplir.
 */
@ObjectType({
  description: 'Bloqueo puntual de una zona común (mantenimiento, evento)',
})
@Entity({ name: 'amenity_blackouts' })
@Index(['amenityId', 'startAt'])
@Index(['complexId', 'startAt'])
export class AmenityBlackout {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ name: 'amenity_id', type: 'uuid' })
  amenityId: string;

  @Field(() => Amenity, { nullable: true })
  @ManyToOne(() => Amenity, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'amenity_id' })
  amenity?: Amenity;

  @Field()
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field()
  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Field()
  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Field(() => String, { description: 'Motivo visible para el residente' })
  @Column({ type: 'varchar', length: 200 })
  reason: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
