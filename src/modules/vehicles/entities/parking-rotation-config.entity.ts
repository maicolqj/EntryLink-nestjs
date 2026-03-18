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
import { ObjectType, Field, Int } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { RotationIntervalUnit } from '../enums/rotation-interval-unit.enum';
import { User } from '../../users/entities/user.entity';

/**
 * Configuración de rotación de parqueaderos por complejo.
 *
 * Cada tipo de vehículo tiene su propio número de cupos y su propia
 * cola de rotación independiente. Los tipos no configurados no rotan.
 *
 * Ejemplo de slotsByType:
 *   { "CAR": 20, "MOTORCYCLE": 13, "TRUCK": 2 }
 *
 * Ejemplo de grandCycleByType (ciclo global por tipo):
 *   { "CAR": 1, "MOTORCYCLE": 2 }
 */
@ObjectType({ description: 'Configuración de rotación de parqueaderos del complejo' })
@Entity({ name: 'parking_rotation_configs' })
@Index(['complexId'], { unique: true })
export class ParkingRotationConfig {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String, { description: 'ID del complejo al que pertenece la configuración' })
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ==================== INTERVALO DE ROTACIÓN ====================

  @Field(() => Int, {
    description: 'Valor numérico del intervalo (ej: 3 si es "cada 3 meses")',
  })
  @Column({ name: 'rotation_interval_value', type: 'int' })
  rotationIntervalValue: number;

  @Field(() => RotationIntervalUnit, {
    description: 'Unidad de tiempo del intervalo (DAYS | WEEKS | MONTHS)',
  })
  @Column({
    name: 'rotation_interval_unit',
    type: 'enum',
    enum: RotationIntervalUnit,
    default: RotationIntervalUnit.MONTHS,
  })
  rotationIntervalUnit: RotationIntervalUnit;

  // ==================== CUPOS POR TIPO ====================

  /**
   * Cupos disponibles de parqueadero por tipo de vehículo.
   * Solo los tipos declarados aquí participan en la rotación.
   *
   * @example { "CAR": 20, "MOTORCYCLE": 13, "TRUCK": 2 }
   */
  @Field(() => GraphQLJSON, {
    description:
      'Mapa de cupos disponibles por tipo de vehículo. ' +
      'Ej: { "CAR": 20, "MOTORCYCLE": 13 }. ' +
      'Solo los tipos listados participan en la rotación.',
  })
  @Column({ name: 'slots_by_type', type: 'jsonb', default: {} })
  slotsByType: Record<string, number>;

  // ==================== ESTADO ====================

  @Field(() => Boolean, { description: 'Si la rotación automática está habilitada' })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Field(() => Date, {
    description: 'Última vez que se ejecutó la rotación',
    nullable: true,
  })
  @Column({ name: 'last_executed_at', type: 'timestamptz', nullable: true })
  lastExecutedAt?: Date;

  @Field(() => Date, {
    description: 'Próxima ejecución programada de la rotación',
    nullable: true,
  })
  @Column({ name: 'next_execution_at', type: 'timestamptz', nullable: true })
  nextExecutionAt?: Date;

  // ==================== CICLO GLOBAL POR TIPO ====================

  /**
   * Número del gran ciclo actual por tipo.
   * Se incrementa cuando todos los vehículos de ese tipo han rotado una vez.
   *
   * @example { "CAR": 2, "MOTORCYCLE": 1 }
   */
  @Field(() => GraphQLJSON, {
    description:
      'Número del gran ciclo actual por tipo de vehículo. ' +
      'Se incrementa cuando todos los vehículos de ese tipo han rotado al menos una vez.',
  })
  @Column({ name: 'grand_cycle_by_type', type: 'jsonb', default: {} })
  grandCycleByType: Record<string, number>;

  // ==================== AUDITORÍA ====================

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: User;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedByUser?: User;
}
