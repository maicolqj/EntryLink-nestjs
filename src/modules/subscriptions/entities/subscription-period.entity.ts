import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';
import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { BillingCycle } from '../enums/billing-cycle.enum';
import { SubscriptionPeriodKind } from '../enums/subscription-period-kind.enum';
import { SubscriptionPricingMode } from '../enums/subscription-pricing-mode.enum';
import { SubscriptionTaxLine } from '../dto/responses/subscription-tax-line.response';
import { moneyColumn } from '../../finance/utils/numeric.transformer';
import { SubscriptionTaxKind } from '../enums/subscription-tax-kind.enum';
import { FreePeriodReason } from '../enums/free-period-reason.enum';

/**
 * Los cobros registrados antes de las retenciones guardaron sus impuestos sin
 * `kind`: todos se sumaban, así que se leen como CHARGE.
 */
const taxLinesColumn: ValueTransformer = {
  to: (lines?: SubscriptionTaxLine[] | null) => lines,
  from: (lines?: SubscriptionTaxLine[] | null) =>
    lines?.map((line) => ({
      ...line,
      kind: line.kind ?? SubscriptionTaxKind.CHARGE,
    })) ?? null,
};

/**
 * Un periodo de suscripción del complejo.
 *
 * Es un historial: cada renovación crea una fila y ninguna se borra, así
 * queda el registro de qué se pagó, cuándo y quién lo registró. El valor de un
 * pago se puede corregir (`updatedById`, nota con el motivo). El vencimiento
 * vigente se copia en `residential_complexes.subscription_ends_at` para que el
 * guard y el cron no tengan que recorrer el historial.
 */
@ObjectType({ description: 'Periodo de suscripción de un complejo' })
@Entity({ name: 'subscription_periods' })
@Index(['complexId', 'endsAt'])
export class SubscriptionPeriod {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => SubscriptionPeriodKind)
  @Column({
    type: 'enum',
    enum: SubscriptionPeriodKind,
    enumName: 'subscription_period_kind',
  })
  kind: SubscriptionPeriodKind;

  @Field(() => ComplexPlan)
  @Column({ type: 'varchar', length: 20 })
  plan: ComplexPlan;

  @Field(() => BillingCycle, {
    nullable: true,
    description:
      'Ciclo pagado. Vacío en la prueba gratis y el periodo inicial.',
  })
  @Column({
    type: 'enum',
    enum: BillingCycle,
    enumName: 'subscription_billing_cycle',
    nullable: true,
  })
  cycle?: BillingCycle | null;

  @Field(() => Date)
  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Field(() => Date)
  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Field(() => Float, {
    nullable: true,
    description:
      'Valor pagado (COP): subtotal + impuestos − retenciones del conjunto',
  })
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: moneyColumn,
  })
  amount?: number | null;

  @Field(() => SubscriptionPricingMode, {
    nullable: true,
    description: 'Modalidad con la que se calculó el cobro',
  })
  @Column({ name: 'pricing_mode', type: 'varchar', length: 20, nullable: true })
  pricingMode?: SubscriptionPricingMode | null;

  @Field(() => Int, {
    nullable: true,
    description: 'Unidades cobradas (modalidad por unidad)',
  })
  @Column({ name: 'unit_count', type: 'int', nullable: true })
  unitCount?: number | null;

  @Field(() => Float, { nullable: true, description: 'Valor por unidad' })
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: moneyColumn,
  })
  unitPrice?: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Valor antes de impuestos',
  })
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: moneyColumn,
  })
  subtotal?: number | null;

  @Field(() => Float, { nullable: true, description: 'Total de impuestos' })
  @Column({
    name: 'tax_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: moneyColumn,
  })
  taxAmount?: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Total retenido por el conjunto (retención en la fuente…)',
  })
  @Column({
    name: 'withholding_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: moneyColumn,
  })
  withholdingAmount?: number | null;

  @Field(() => [SubscriptionTaxLine], {
    nullable: true,
    description: 'Impuestos aplicados, con la tarifa vigente al pagar',
  })
  @Column({ type: 'jsonb', nullable: true, transformer: taxLinesColumn })
  taxes?: SubscriptionTaxLine[] | null;

  @Field(() => FreePeriodReason, {
    nullable: true,
    description: 'Motivo de los días gratis (prueba y cortesía)',
  })
  @Column({ name: 'free_reason', type: 'varchar', length: 20, nullable: true })
  freeReason?: FreePeriodReason | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt?: Date | null;

  @Field(() => String, {
    nullable: true,
    description: 'Referencia del pago (número de transferencia, consignación…)',
  })
  @Column({
    name: 'payment_reference',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  paymentReference?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Quién corrigió el pago por última vez',
  })
  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'payment_updated_at', type: 'timestamptz', nullable: true })
  paymentUpdatedAt?: Date | null;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
