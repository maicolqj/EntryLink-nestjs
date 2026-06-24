import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, VersionColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { Unit } from '../../residential-complex/entities/unit.entity';
import { moneyColumn } from '../utils/numeric.transformer';

/**
 * Saldo materializado de la unidad. Una fila por (complexId, unitId).
 *
 *  currentBalance > 0  → DEUDA (el residente debe)
 *  currentBalance = 0  → AL DÍA
 *  currentBalance < 0  → SALDO A FAVOR / ANTICIPO (pasivo 2805)
 *
 * `prepaidBalance` rastrea solo el anticipo disponible (siempre >= 0) para
 * aplicar a facturas futuras. Es derivable del saldo negativo pero se
 * materializa para consultas rápidas y para la aplicación con prelación.
 */
@ObjectType()
@Entity('property_account_status')
@Index(['complexId', 'unitId'], { unique: true })
export class PropertyAccountStatus {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  @Field()
  @Column({ type: 'uuid' })
  unitId: string;

  @ManyToOne(() => Unit, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'unitId' })
  unit: Unit;

  /** Saldo neto firmado. Positivo = deuda, negativo = saldo a favor. */
  @Field(() => Float)
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: moneyColumn })
  currentBalance: number;

  /** Anticipo disponible para aplicar (>= 0). */
  @Field(() => Float)
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: moneyColumn })
  prepaidBalance: number;

  /** Concurrencia optimista: protege contra carreras al actualizar saldo. */
  @Field(() => Int)
  @VersionColumn()
  version: number;

  @Field(() => Date, { nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastMovementAt?: Date;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
