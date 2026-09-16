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

import { MaintenanceCategory } from '../enums/maintenance-category.enum';
import { MaintenancePriority } from '../enums/maintenance-priority.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Cuánto se compromete la administración a demorarse, por oficio y urgencia.
 *
 * Dos plazos y no uno: `responseHours` es hasta asignar responsable —lo que el
 * residente percibe como "me están atendiendo"— y `resolutionHours` hasta
 * dejarlo reparado. Un solo plazo obliga a elegir entre avisar tarde o dar por
 * incumplido lo que todavía va bien.
 *
 * Si un complejo no configura nada, manda la tabla por defecto del servicio.
 * Un módulo que exija configurarse antes de servir no lo usa nadie.
 */
@ObjectType({ description: 'Plazo de atención comprometido por categoría' })
@Entity({ name: 'maintenance_sla_configs' })
@Index(['complexId', 'category', 'priority'], { unique: true })
export class MaintenanceSlaConfig {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => MaintenanceCategory)
  @Column({ type: 'varchar', length: 30 })
  category: MaintenanceCategory;

  @Field(() => MaintenancePriority)
  @Column({ type: 'varchar', length: 20 })
  priority: MaintenancePriority;

  @Field(() => Int, { description: 'Horas para asignar responsable' })
  @Column({ name: 'response_hours', type: 'int' })
  responseHours: number;

  @Field(() => Int, { description: 'Horas para dejarlo reparado' })
  @Column({ name: 'resolution_hours', type: 'int' })
  resolutionHours: number;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;
}
