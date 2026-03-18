import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

import { PaymentMethod }      from '../enums/payment-method.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Unit }               from '../../residential-complex/entities/unit.entity';
import { FeeCharge }          from './fee-charge.entity';
import { User }               from '../../users/entities/user.entity';

/**
 * Pago registrado contra un cargo específico.
 *
 * Un cargo puede tener múltiples pagos (pagos parciales).
 * `isReversed` marca el pago como anulado sin eliminarlo (auditoría).
 */
@ObjectType()
@Entity('payments')
@Index(['complexId', 'chargeId'])
@Index(['complexId', 'unitId'])
@Index(['complexId', 'paidAt'])
export class Payment {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Cargo asociado ───────────────────────────────────────────

  @Field()
  @Column()
  chargeId: string;

  // ─── Monto ────────────────────────────────────────────────────

  @Field(() => Float)
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  // ─── Método y referencia ──────────────────────────────────────

  @Field(() => PaymentMethod)
  @Column({ type: 'enum', enum: PaymentMethod })
  method: PaymentMethod;

  /** Referencia bancaria / comprobante */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  reference?: string;

  /** URL de la imagen del comprobante */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  receiptUrl?: string;

  // ─── Fecha de pago (puede diferir de la fecha de registro) ────

  @Field()
  @Column({ type: 'timestamptz' })
  paidAt: Date;

  // ─── Notas ────────────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ─── Anulación ────────────────────────────────────────────────

  @Field()
  @Column({ default: false })
  isReversed: boolean;

  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  reversalReason?: string;

  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  reversedByUserId?: string;

  @Field(() => Date, { nullable: true })
  @Column({ nullable: true })
  reversedAt?: Date;

  // ─── Multi-tenant ─────────────────────────────────────────────

  @Field()
  @Column()
  complexId: string;

  @Field()
  @Column()
  unitId: string;

  @Field()
  @Column()
  registeredByUserId: string;

  // ─── Relaciones ───────────────────────────────────────────────

  @Field(() => ResidentialComplex)
  @ManyToOne(() => ResidentialComplex, { eager: false })
  complex: ResidentialComplex;

  @Field(() => Unit)
  @ManyToOne(() => Unit, { eager: false })
  unit: Unit;

  @Field(() => FeeCharge)
  @ManyToOne(() => FeeCharge, { eager: false })
  charge: FeeCharge;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { eager: false, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'registeredByUserId' })
  registeredBy?: User;

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
