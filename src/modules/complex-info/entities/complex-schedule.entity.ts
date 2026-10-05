import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { ComplexScheduleCategory } from '../enums/complex-info.enums';

/**
 * Una franja de un día de la semana. Las horas son de pared del conjunto
 * (America/Bogota). Si `closeTime` es menor que `openTime`, la franja cruza la
 * medianoche ("10:00 p. m. – 6:00 a. m."); 00:00–23:59 es todo el día.
 */
@ObjectType({ description: 'Franja de un día en un horario del conjunto' })
export class ComplexScheduleSlot {
  @Field(() => Int, { description: '0=domingo, 1=lunes … 6=sábado' })
  dayOfWeek: number;

  @Field({ description: 'Hora de apertura HH:mm' })
  openTime: string;

  @Field({ description: 'Hora de cierre HH:mm' })
  closeTime: string;
}

/**
 * Un horario del conjunto: la atención de la administración, el shut de
 * basuras, la recolección de reciclaje, el gimnasio… Varias franjas por día
 * (mañana y tarde) y una nota para lo que no cabe en la semana ("festivos
 * cerrado").
 */
@ObjectType({ description: 'Horario del conjunto (atención, basuras, etc.)' })
@Entity('complex_schedules')
@Index(['complexId'])
export class ComplexSchedule {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => ComplexScheduleCategory)
  @Column({
    type: 'enum',
    enum: ComplexScheduleCategory,
    enumName: 'complex_schedule_category',
  })
  category: ComplexScheduleCategory;

  @Field({ description: 'Nombre. Ej: "Atención de la administración"' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Field(() => [ComplexScheduleSlot])
  @Column({ type: 'jsonb', default: () => "'[]'" })
  slots: ComplexScheduleSlot[];

  @Field(() => String, {
    nullable: true,
    description: 'Ej: "Festivos cerrado", "Bolsas bien cerradas"',
  })
  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Field(() => Int, { description: 'Orden en la lista' })
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Field({ description: 'Visible para los residentes' })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt?: Date | null;

  @BeforeInsert()
  @BeforeUpdate()
  normalize() {
    if (this.name) this.name = this.name.trim().replace(/\s+/g, ' ');
    if (this.note !== undefined && this.note !== null) {
      this.note = this.note.trim() || null;
    }
  }
}
