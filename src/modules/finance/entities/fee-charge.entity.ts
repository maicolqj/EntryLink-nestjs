import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
  ManyToOne, Index, OneToMany,
} from 'typeorm';
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

import { ChargeStatus }       from '../enums/charge-status.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Unit }               from '../../residential-complex/entities/unit.entity';
import { FeeConfig }          from './fee-config.entity';

/**
 * Cargo generado para una unidad en un período de facturación.
 *
 * `period` tiene el formato `YYYY-MM` (ej. "2025-03").
 * Índice único en (complexId, unitId, feeConfigId, period) para
 * evitar duplicados al regenerar cargos.
 */
@ObjectType()
@Entity('fee_charges')
@Index(['complexId', 'status'])
@Index(['complexId', 'period'])
@Index(['unitId', 'status'])
@Index(['complexId', 'unitId', 'feeConfigId', 'period'], { unique: true })
export class FeeCharge {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Período y vencimiento ────────────────────────────────────

  /** Período de facturación en formato YYYY-MM (ej. "2025-03") */
  @Field()
  @Column({ length: 7 })
  period: string;

  @Field(() => Date, { nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  dueDate: Date | null;

  // ─── Monto ────────────────────────────────────────────────────

  @Field(() => Float)
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  /** Monto total ya pagado (suma de pagos asociados) */
  @Field(() => Float)
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  paidAmount: number;

  /**
   * Monto normal antes del descuento de pronto pago.
   * Solo se establece cuando el cargo fue generado con earlyPaymentAmount < amount.
   * El cron diario revierte `amount` a este valor si el cargo no fue pagado antes del vencimiento.
   */
  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  normalAmount?: number | null;

  /** Saldo pendiente = amount - paidAmount */
  @Field(() => Float)
  get balance(): number {
    return Number(this.amount) - Number(this.paidAmount);
  }

  // ─── Descripción ──────────────────────────────────────────────

  @Field()
  @Column()
  description: string;

  // ─── Estado ───────────────────────────────────────────────────

  @Field(() => ChargeStatus)
  @Column({ type: 'enum', enum: ChargeStatus, default: ChargeStatus.PENDING })
  status: ChargeStatus;

  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  cancellationReason?: string;

  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  cancelledByUserId?: string;

  @Field(() => Date, { nullable: true })
  @Column({ nullable: true })
  cancelledAt?: Date;

  // ─── Multi-tenant ─────────────────────────────────────────────

  @Field()
  @Column()
  complexId: string;

  @Field()
  @Column()
  unitId: string;

  /** Null para cargos directos (sin FeeConfig asociada) */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  feeConfigId?: string;

  // ─── Relaciones ───────────────────────────────────────────────

  @Field(() => ResidentialComplex)
  @ManyToOne(() => ResidentialComplex, { eager: false })
  complex: ResidentialComplex;

  @Field(() => Unit)
  @ManyToOne(() => Unit, { eager: false })
  unit: Unit;

  @Field(() => FeeConfig, { nullable: true })
  @ManyToOne(() => FeeConfig, { eager: false, nullable: true })
  feeConfig?: FeeConfig;

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @DeleteDateColumn()
  deletedAt?: Date;
}
