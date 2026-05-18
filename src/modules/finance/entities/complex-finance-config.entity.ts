import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Configuración financiera de un complejo residencial.
 * Una sola fila por complejo (complexId único).
 *
 * Controla:
 *  - Parámetros de mora (tasa, días de gracia)
 *  - Automatización de crons (generación de cargos y aplicación de mora)
 */
@ObjectType()
@Entity('complex_finance_configs')
@Index(['complexId'], { unique: true })
export class ComplexFinanceConfig {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Identificación ───────────────────────────────────────────

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  // ─── Parámetros de mora ───────────────────────────────────────

  /**
   * Tasa mensual de mora en porcentaje.
   * Ej: 2.0 = 2% mensual sobre el saldo vencido.
   */
  @Field(() => Float)
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 2.0 })
  moraRate: number;

  /**
   * Días de gracia tras el vencimiento antes de calcular mora.
   * Ej: 5 → se empieza a cobrar mora al día 6 después del vencimiento.
   */
  @Field(() => Int)
  @Column({ type: 'int', default: 5 })
  moraGraceDays: number;

  // ─── Automatización ───────────────────────────────────────────

  /**
   * Si true, el cron de las 00:10 AM aplicará mora automáticamente
   * a los cargos vencidos de este complejo.
   */
  @Field()
  @Column({ default: false })
  autoApplyMora: boolean;

  /**
   * Si true, el cron de las 00:05 AM generará cargos automáticamente
   * cuando llegue el día de vencimiento configurado en cada FeeConfig.
   */
  @Field()
  @Column({ default: false })
  autoGenerateCharges: boolean;

  // ─── Relación ─────────────────────────────────────────────────

  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'complexId' })
  complex: ResidentialComplex;

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
