import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

import { moneyColumn } from '../../finance/utils/numeric.transformer';

/**
 * Impuesto que se suma al valor de la suscripción (IVA y los demás que el
 * SUPER_ADMIN configure). Se aplica sobre el subtotal de todos los conjuntos;
 * cada pago guarda la tarifa vigente en su desglose, así un cambio de tarifa
 * no altera lo ya cobrado.
 */
@ObjectType({ description: 'Impuesto aplicado a la suscripción' })
@Entity({ name: 'subscription_taxes' })
export class SubscriptionTax {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Field(() => Float, { description: 'Tarifa en porcentaje (19 = 19 %)' })
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: moneyColumn,
  })
  rate: number;

  @Field(() => Boolean)
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Field(() => Int)
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
