import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { ChargeEmissionStatus } from '../enums/charge-emission-status.enum';
import { FeeConfigBillingMode } from '../enums/fee-config-billing-mode.enum';
import { ChargeRule }          from '../dto/inputs/charge-rule.input';
import { ResidentialComplex }  from '../../residential-complex/entities/residential-complex.entity';
import { ChargeCategory }      from './charge-category.entity';

/**
 * Emisión de un cargo en un período (ej. "Cuota de Administración 2025-03").
 *
 * Capa de orquestación sobre el motor canónico de cargos: agrupa N reglas de
 * cálculo (`rules`, embebidas como jsonb) que, al confirmarse, generan los
 * `UnitCharge` (FeeCharge) de cada unidad dentro de una transacción.
 *
 * Ciclo de vida: DRAFT → (preview sin persistir) → CONFIRMED | CANCELLED.
 * Único (complexId, conceptName, period) evita emitir dos veces el mismo
 * concepto en el mismo período.
 */
@ObjectType()
@Entity('charge_emissions')
@Index(['complexId', 'status'])
@Index(['complexId', 'period'])
@Index(['complexId', 'conceptName', 'period'], { unique: true })
export class ChargeEmission {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Identificación ───────────────────────────────────────────

  /** Nombre del concepto emitido (ej. "Cuota de Administración"). */
  @Field()
  @Column({ type: 'varchar', length: 200 })
  conceptName: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Período de facturación YYYY-MM. */
  @Field()
  @Column({ type: 'varchar', length: 7 })
  period: string;

  @Field(() => ChargeEmissionStatus)
  @Column({ type: 'enum', enum: ChargeEmissionStatus, default: ChargeEmissionStatus.DRAFT })
  status: ChargeEmissionStatus;

  @Field(() => Date)
  @Column({ type: 'timestamptz' })
  dueDate: Date;

  /** ADVANCE: vence en el mismo período. ARREARS: vence en el siguiente. */
  @Field(() => FeeConfigBillingMode)
  @Column({ type: 'enum', enum: FeeConfigBillingMode, default: FeeConfigBillingMode.ADVANCE })
  billingMode: FeeConfigBillingMode;

  // ─── Reglas de cálculo (embebidas) ────────────────────────────

  @Field(() => [ChargeRule])
  @Column({ type: 'jsonb', default: [] })
  rules: ChargeRule[];

  // ─── Resultado de la confirmación ─────────────────────────────

  /** Nº de UnitCharge persistidos al confirmar. */
  @Field(() => Int)
  @Column({ type: 'int', default: 0 })
  generatedCount: number;

  @Field(() => Date, { nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  cancellationReason?: string | null;

  // ─── Multi-tenant / categoría / auditoría ─────────────────────

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  categoryId?: string | null;

  @Field()
  @Column({ type: 'uuid' })
  createdByUserId: string;

  // ─── Relaciones ───────────────────────────────────────────────

  @ManyToOne(() => ResidentialComplex, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complexId' })
  complex: ResidentialComplex;

  @Field(() => ChargeCategory, { nullable: true })
  @ManyToOne(() => ChargeCategory, { eager: false, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category?: ChargeCategory | null;

  // ─── Timestamps ───────────────────────────────────────────────

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
