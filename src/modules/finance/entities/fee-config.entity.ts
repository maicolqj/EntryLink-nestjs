import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { FeeFrequency }       from '../enums/fee-frequency.enum';
import { ChargeType }         from '../enums/charge-type.enum';
import { ChargeCategory }     from './charge-category.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Unit }               from '../../residential-complex/entities/unit.entity';
import { UnitType }           from '../../residential-complex/enums/unit-type.enum';

/**
 * Configuración de cuota para un complejo.
 *
 * Jerarquía de aplicación (de más específica a más general):
 *  1. unitId fijo        → cuota específica para esa unidad
 *  2. unitType fijo      → cuota para todas las unidades de ese tipo
 *  3. Ninguno de los dos → cuota general para todo el complejo
 */
@ObjectType()
@Entity('fee_configs')
@Index(['complexId', 'isActive'])
export class FeeConfig {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Identificación ───────────────────────────────────────────

  @Field()
  @Column()
  name: string;

  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  description?: string;

  // ─── Monto y frecuencia ───────────────────────────────────────

  @Field(() => Float)
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  /**
   * Monto con descuento de pronto pago (opcional).
   * Si se define y la unidad está al día, el cargo se genera con este monto.
   * El cron diario revierte al monto normal si no se pagó antes del vencimiento.
   */
  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  earlyPaymentAmount?: number | null;

  @Field(() => FeeFrequency)
  @Column({ type: 'enum', enum: FeeFrequency, default: FeeFrequency.MONTHLY })
  frequency: FeeFrequency;

  /** Día del mes en que vence el pago (ej. 5 → vence el día 5 de cada período) */
  @Field()
  @Column({ default: 5 })
  dueDayOfMonth: number;

  // ─── Tipo de cargo ────────────────────────────────────────────

  @Field(() => ChargeType)
  @Column({ type: 'enum', enum: ChargeType, default: ChargeType.MONTHLY })
  chargeType: ChargeType;

  /**
   * Solo aplica cuando chargeType = 'LIMITED'.
   * Número total de cuotas a generar (ej: 12 meses).
   */
  @Field(() => Int, { nullable: true })
  @Column({ type: 'int', nullable: true })
  installments?: number | null;

  /**
   * Contador interno: cuántas cuotas ya se generaron para este config.
   * Cuando installmentsPaid >= installments, el config se desactiva automáticamente.
   */
  @Field(() => Int)
  @Column({ type: 'int', default: 0 })
  installmentsPaid: number;

  // ─── Alcance ──────────────────────────────────────────────────

  /** Si se especifica, esta cuota aplica solo a esa unidad */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  unitId?: string;

  /** Si se especifica, aplica a todas las unidades de este tipo en el complejo */
  @Field(() => UnitType, { nullable: true })
  @Column({ type: 'enum', enum: UnitType, nullable: true })
  unitType?: UnitType;

  // ─── Estado ───────────────────────────────────────────────────

  @Field()
  @Column({ default: true })
  isActive: boolean;

  // ─── Multi-tenant ─────────────────────────────────────────────

  @Field()
  @Column()
  complexId: string;

  @Field()
  @Column()
  createdByUserId: string;

  // ─── Categoría ───────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  categoryId?: string;

  // ─── Relaciones ───────────────────────────────────────────────

  @Field(() => ResidentialComplex)
  @ManyToOne(() => ResidentialComplex, { eager: false })
  complex: ResidentialComplex;

  @Field(() => Unit, { nullable: true })
  @ManyToOne(() => Unit, { eager: false, nullable: true })
  unit?: Unit;

  @Field(() => ChargeCategory, { nullable: true })
  @ManyToOne(() => ChargeCategory, { nullable: true, onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'categoryId' })
  category?: ChargeCategory;

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
