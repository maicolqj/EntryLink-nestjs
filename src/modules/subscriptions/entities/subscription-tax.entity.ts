import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

import { moneyColumn } from '../../finance/utils/numeric.transformer';
import { SubscriptionTaxKind } from '../enums/subscription-tax-kind.enum';

/**
 * Impuesto de la suscripción, configurado por el SUPER_ADMIN.
 *
 * - Global (`complexId` vacío): aplica a todos los conjuntos, p. ej. IVA 19 %.
 * - Local (`complexId`): solo a ese conjunto, p. ej. la retención en la fuente
 *   que cada uno practica con su propia tarifa (2 %, 4 %, 6 %).
 *
 * Un cobro aplica los globales más los locales del conjunto, todos sobre el
 * subtotal. Cada pago guarda la tarifa vigente en su desglose, así un cambio
 * de tarifa no altera lo ya cobrado.
 */
@ObjectType({ description: 'Impuesto aplicado a la suscripción' })
@Entity({ name: 'subscription_taxes' })
@Index('IDX_subscription_taxes_complex', ['complexId'])
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

  @Field(() => SubscriptionTaxKind)
  @Column({
    type: 'varchar',
    length: 20,
    default: SubscriptionTaxKind.CHARGE,
  })
  kind: SubscriptionTaxKind;

  @Field(() => String, {
    nullable: true,
    description:
      'Conjunto al que aplica. Vacío = global (todos los conjuntos).',
  })
  @Column({ name: 'complex_id', type: 'uuid', nullable: true })
  complexId?: string | null;

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
