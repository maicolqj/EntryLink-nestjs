import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Unit }               from '../../residential-complex/entities/unit.entity';
import { FeeCharge }          from './fee-charge.entity';

export type WalletEntryType = 'CREDIT' | 'DEBIT' | 'ADJUSTMENT';

/**
 * Saldo a favor / anticipo de una unidad.
 *
 * CREDIT     = dinero entrante (anticipo, pago en exceso, crédito manual)
 * DEBIT      = aplicación de saldo a un cargo (dinero "gastado" del wallet)
 * ADJUSTMENT = corrección manual (positiva o negativa)
 *
 * Nunca se modifica un registro existente; los errores se corrigen con
 * una nueva entrada de tipo ADJUSTMENT.
 */
@ObjectType()
@Entity('wallet_entries')
@Index(['unitId', 'complexId'])
@Index(['complexId', 'createdAt'])
export class WalletEntry {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'varchar', length: 12 })
  type: WalletEntryType;

  /** Siempre positivo. El tipo (CREDIT/DEBIT) indica la dirección. */
  @Field(() => Float)
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  @Field()
  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Field()
  @Column({ type: 'uuid' })
  unitId: string;

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  /**
   * Referencia al FeeCharge afectado cuando type = 'DEBIT'.
   * Para trazabilidad: "este crédito se aplicó a este cargo en esta fecha".
   */
  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  chargeId: string | null;

  // ─── Relaciones ───────────────────────────────────────────────

  @ManyToOne(() => Unit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unitId' })
  unit: Unit;

  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complexId' })
  complex: ResidentialComplex;

  @Field(() => FeeCharge, { nullable: true })
  @ManyToOne(() => FeeCharge, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'chargeId' })
  charge: FeeCharge | null;

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}
