import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, Entity } from 'typeorm';
import { GrowthBogotaLocality, GrowthInterestSignal } from '../prospects.enums';
import { ValidatableRecord } from './validatable-record';

/** Empresa administradora de propiedad horizontal (persona jurídica). */
@ObjectType('GrowthOrganization')
@Entity({ schema: 'growth', name: 'organizations' })
export class Organization extends ValidatableRecord {
  @Field()
  @Column({ name: 'legal_name', type: 'varchar', length: 200 })
  legalName: string;

  @Field({ nullable: true })
  @Column({ name: 'trade_name', type: 'varchar', length: 200, nullable: true })
  tradeName?: string | null;

  @Column({ name: 'name_normalized', type: 'varchar', length: 200 })
  nameNormalized: string;

  @Field({ nullable: true, description: 'NIT sin dígito de verificación' })
  @Column({ type: 'varchar', length: 12, nullable: true })
  nit?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'nit_check_digit', type: 'char', length: 1, nullable: true })
  nitCheckDigit?: string | null;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  website?: string | null;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 253, nullable: true })
  domain?: string | null;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  address?: string | null;

  @Column({ name: 'address_normalized', type: 'text', nullable: true })
  addressNormalized?: string | null;

  @Field()
  @Column({ type: 'varchar', length: 60, default: 'BOGOTA' })
  city: string;

  @Field(() => GrowthBogotaLocality, { nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  locality?: GrowthBogotaLocality | null;

  @Field(() => Int, {
    nullable: true,
    description: 'Estimado declarado, no verificado',
  })
  @Column({ name: 'estimated_properties', type: 'int', nullable: true })
  estimatedProperties?: number | null;

  @Field(() => Int, {
    nullable: true,
    description: 'Estimado declarado, no verificado',
  })
  @Column({ name: 'estimated_units', type: 'int', nullable: true })
  estimatedUnits?: number | null;

  @Field(() => GrowthInterestSignal)
  @Column({
    name: 'interest_signal',
    type: 'varchar',
    length: 20,
    default: GrowthInterestSignal.NONE,
  })
  interestSignal: GrowthInterestSignal;
}
