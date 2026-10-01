import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Field, Float, ID, ObjectType } from '@nestjs/graphql';

import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { moneyColumn } from '../../finance/utils/numeric.transformer';

/**
 * Precio de un plan. Lo edita el SUPER_ADMIN desde la web: con los precios en
 * el código, cada ajuste exigiría desplegar.
 *
 * El anual es opcional: si no se fija, vale 10 mensualidades (12 meses por el
 * precio de 10).
 */
@ObjectType({ description: 'Precio de un plan de suscripción' })
@Entity({ name: 'subscription_plan_prices' })
export class SubscriptionPlanPrice {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ComplexPlan)
  @Column({ type: 'varchar', length: 20, unique: true })
  plan: ComplexPlan;

  @Field(() => Float, { description: 'Precio mensual (COP)' })
  @Column({
    name: 'monthly_price',
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: moneyColumn,
  })
  monthlyPrice: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Precio anual fijado a mano. Vacío = 10 mensualidades.',
  })
  @Column({
    name: 'annual_price',
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: moneyColumn,
  })
  annualPrice?: number | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
