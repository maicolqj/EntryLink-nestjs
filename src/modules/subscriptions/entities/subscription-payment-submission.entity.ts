import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Field, Float, ID, ObjectType } from '@nestjs/graphql';

import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { BillingCycle } from '../enums/billing-cycle.enum';
import { SubscriptionPaymentStatus } from '../enums/subscription-payment-status.enum';
import { moneyColumn } from '../../finance/utils/numeric.transformer';

/**
 * Soporte de pago que envía el conjunto para renovar su suscripción.
 *
 * El conjunto paga con el QR de la plataforma, declara el valor y adjunta el
 * comprobante. Si el valor declarado no cubre su cotización, el envío se
 * rechaza en el acto con lo que falta. Si la cubre, queda PENDING hasta que el
 * SUPER_ADMIN compare el comprobante con la cuenta y lo apruebe: aprobar
 * registra el periodo pagado (`periodId`) con el flujo normal de renovación.
 *
 * El comprobante no tiene URL pública: se guarda la llave de R2 y lo entrega
 * el backend al conjunto dueño y al personal de la plataforma.
 */
@ObjectType({ description: 'Soporte de pago enviado por el conjunto' })
@Entity('subscription_payment_submissions')
@Index(['complexId', 'createdAt'])
@Index(['status', 'createdAt'])
export class SubscriptionPaymentSubmission {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  // ── Qué se está pagando (snapshot de la cotización al enviar) ──

  @Field(() => ComplexPlan)
  @Column({ type: 'varchar', length: 20 })
  plan: ComplexPlan;

  @Field(() => BillingCycle)
  @Column({ type: 'varchar', length: 10 })
  cycle: BillingCycle;

  @Field(() => Float, { description: 'Lo que debía pagar según su cotización' })
  @Column({
    name: 'amount_due',
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: moneyColumn,
  })
  amountDue: number;

  // ── Lo que declara el conjunto ─────────────────────────────────

  @Field(() => Float, {
    description: 'Valor que el conjunto dice haber pagado',
  })
  @Column({
    name: 'amount_paid',
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: moneyColumn,
  })
  amountPaid: number;

  @Field(() => Date)
  @Column({ name: 'paid_at', type: 'timestamptz' })
  paidAt: Date;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 120, nullable: true })
  reference?: string | null;

  /** Llave en R2. Sin campo GraphQL: el archivo no es público. */
  @Column({ name: 'receipt_key', type: 'varchar', length: 500 })
  receiptKey: string;

  @Field(() => String)
  @Column({ name: 'receipt_name', type: 'varchar', length: 255 })
  receiptName: string;

  @Field(() => String)
  @Column({ name: 'receipt_mime_type', type: 'varchar', length: 100 })
  receiptMimeType: string;

  // ── Revisión ───────────────────────────────────────────────────

  @Field(() => SubscriptionPaymentStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: SubscriptionPaymentStatus.PENDING,
  })
  status: SubscriptionPaymentStatus;

  @Field(() => String, { nullable: true, description: 'Motivo del rechazo' })
  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  @Field(() => String, {
    nullable: true,
    description: 'Periodo pagado que se creó al aprobar',
  })
  @Column({ name: 'period_id', type: 'uuid', nullable: true })
  periodId?: string | null;

  /** NULL cuando lo envió la cuenta del complejo (su sub no es un usuario). */
  @Field(() => String, { nullable: true })
  @Column({ name: 'submitted_by_user_id', type: 'uuid', nullable: true })
  submittedByUserId?: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
