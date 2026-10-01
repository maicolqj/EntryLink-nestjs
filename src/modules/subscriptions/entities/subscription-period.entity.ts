import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Field, Float, ID, ObjectType } from '@nestjs/graphql';

import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { BillingCycle } from '../enums/billing-cycle.enum';
import { SubscriptionPeriodKind } from '../enums/subscription-period-kind.enum';
import { moneyColumn } from '../../finance/utils/numeric.transformer';

/**
 * Un periodo de suscripción del complejo.
 *
 * Es un historial: cada renovación crea una fila y ninguna se sobreescribe, así
 * queda el registro de qué se pagó, cuándo y quién lo registró. El vencimiento
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

  @Field(() => Float, { nullable: true, description: 'Valor pagado (COP)' })
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: moneyColumn,
  })
  amount?: number | null;

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

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
