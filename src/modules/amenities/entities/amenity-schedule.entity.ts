import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { Amenity } from './amenity.entity';

/**
 * Franja de apertura semanal recurrente de una zona común: "los sábados de
 * 08:00 a 22:00". Es la programación que define el administrador y sobre la
 * cual el motor de disponibilidad genera las franjas reservables.
 *
 * Un mismo día puede tener varias filas (mañana y tarde con cierre al mediodía).
 * Las horas se guardan como `time` sin zona: son horas de pared del complejo,
 * que opera en America/Bogota.
 */
@ObjectType({ description: 'Horario semanal de apertura de una zona común' })
@Entity({ name: 'amenity_schedules' })
@Index(['amenityId', 'dayOfWeek'])
export class AmenitySchedule {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ name: 'amenity_id', type: 'uuid' })
  amenityId: string;

  @Field(() => Amenity, { nullable: true })
  @ManyToOne(() => Amenity, (amenity) => amenity.schedules, {
    eager: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'amenity_id' })
  amenity?: Amenity;

  @Field()
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  /** 0 = domingo … 6 = sábado (mismo criterio que Date.getDay()) */
  @Field(() => Int, { description: '0=domingo, 1=lunes … 6=sábado' })
  @Column({ name: 'day_of_week', type: 'int' })
  dayOfWeek: number;

  @Field(() => String, { description: 'Hora de apertura en formato HH:mm' })
  @Column({ name: 'open_time', type: 'time' })
  openTime: string;

  @Field(() => String, { description: 'Hora de cierre en formato HH:mm' })
  @Column({ name: 'close_time', type: 'time' })
  closeTime: string;

  @Field(() => Boolean)
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
