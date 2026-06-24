import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { InterestType } from '../enums/interest-type.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Configuración contable global por copropiedad (parámetros legales PH).
 * Complementa a ComplexFinanceConfig (mora/automatización ya existente):
 * a futuro conviene fusionarlas en una sola tabla de configuración.
 */
@ObjectType()
@Entity('tenant_financial_configs')
@Index(['complexId'], { unique: true })
export class TenantFinancialConfig {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  // ─── Mora ─────────────────────────────────────────────────────

  /** Tasa de mora en porcentaje (ej. 2.0 = 2%). */
  @Field(() => Float)
  @Column({ type: 'numeric', precision: 6, scale: 3, default: 0 })
  lateInterestRate: number;

  @Field(() => InterestType)
  @Column({ type: 'enum', enum: InterestType, default: InterestType.NOMINAL_MONTHLY })
  lateInterestType: InterestType;

  /** Día de corte: desde él se causa mora sobre saldos vencidos. */
  @Field(() => Int)
  @Column({ type: 'int', default: 1 })
  moraCutoffDay: number;

  // ─── Pronto pago ──────────────────────────────────────────────

  @Field(() => Float)
  @Column({ type: 'numeric', precision: 6, scale: 3, default: 0 })
  earlyPaymentDiscountPct: number;

  /** Día límite del mes para acceder al descuento de pronto pago. */
  @Field(() => Int)
  @Column({ type: 'int', default: 0 })
  earlyPaymentLimitDay: number;

  // ─── Fondo de imprevistos (Ley 675 art. 35: mínimo 1%) ────────

  @Field(() => Float)
  @Column({ type: 'numeric', precision: 6, scale: 3, default: 1.0 })
  contingencyFundPct: number;

  // ─── Auditoría / relación ─────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  updatedByUserId?: string | null;

  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'complexId' })
  complex: ResidentialComplex;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
