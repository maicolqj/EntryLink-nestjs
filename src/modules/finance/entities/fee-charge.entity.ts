import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
  ManyToOne, Index, OneToMany,
} from 'typeorm';
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

import { ChargeStatus }       from '../enums/charge-status.enum';
import { PrelacionConcept }   from '../enums/prelacion-concept.enum';
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

  /**
   * Fecha límite de pronto pago. Solo se establece cuando el cargo se generó con
   * descuento (earlyPaymentAmount). Pasada esta fecha sin pago total, el cron
   * revierte `amount` a `normalAmount`. El front la usa para mostrar
   * "vence pronto pago el …".
   */
  @Field(() => Date, { nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  earlyPaymentDueDate?: Date | null;

  /**
   * Cuenta de ingreso PUC acreditada al causar (heredada del RecurringCharge).
   * Se usa para emitir la nota crédito del descuento por pronto pago.
   */
  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  incomeAccountId?: string | null;

  /** Saldo pendiente = amount - paidAmount */
  @Field(() => Float)
  get balance(): number {
    return Number(this.amount) - Number(this.paidAmount);
  }

  /**
   * Interés de mora acumulado para este cargo (suma del saldo de las filas
   * INTEREST_MORA cuyo `sourceChargeId` apunta a este cargo). No persistido;
   * lo llena el service en las queries de lectura. null si no se cargó.
   */
  @Field(() => Float, { nullable: true })
  moraAmount?: number | null;

  /**
   * Estado derivado en tiempo de lectura: si el cargo sigue con saldo y ya pasó
   * su `dueDate`, se reporta OVERDUE aunque el cron aún no haya transicionado el
   * `status` en BD. No persistido.
   */
  @Field(() => ChargeStatus)
  get effectiveStatus(): ChargeStatus {
    if (
      this.status === ChargeStatus.PAID ||
      this.status === ChargeStatus.CANCELLED ||
      this.status === ChargeStatus.WAIVED
    ) {
      return this.status;
    }
    if (this.dueDate && new Date(this.dueDate) < new Date() && this.balance > 0) {
      return ChargeStatus.OVERDUE;
    }
    return this.status;
  }

  // ─── Descripción ──────────────────────────────────────────────

  @Field()
  @Column()
  description: string;

  // ─── Estado ───────────────────────────────────────────────────

  @Field(() => ChargeStatus)
  @Column({ type: 'enum', enum: ChargeStatus, default: ChargeStatus.PENDING })
  status: ChargeStatus;

  /**
   * Concepto contable para la prelación legal de pagos.
   * Determina el orden en que un abono/anticipo se imputa a los cargos.
   */
  @Field(() => PrelacionConcept)
  @Column({ type: 'enum', enum: PrelacionConcept, default: PrelacionConcept.ORDINARY })
  prelacionConcept: PrelacionConcept;

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

  /**
   * Para filas de mora (prelacionConcept=INTEREST_MORA): id del cargo padre que
   * generó el interés. Habilita el cálculo de `moraAmount` del cargo padre.
   */
  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  sourceChargeId?: string | null;

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
