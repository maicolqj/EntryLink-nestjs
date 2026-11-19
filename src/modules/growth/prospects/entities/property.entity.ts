import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, Entity } from 'typeorm';
import {
  GrowthBogotaLocality,
  GrowthBuildingKind,
  GrowthInfoStatus,
  GrowthPhType,
} from '../prospects.enums';
import { ValidatableRecord } from './validatable-record';

/** Copropiedad (conjunto, edificio u otra propiedad horizontal). */
@ObjectType('GrowthProperty')
@Entity({ schema: 'growth', name: 'properties' })
export class Property extends ValidatableRecord {
  @Field()
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ name: 'name_normalized', type: 'varchar', length: 200 })
  nameNormalized: string;

  @Field(() => GrowthPhType)
  @Column({
    name: 'ph_type',
    type: 'varchar',
    length: 20,
    default: GrowthPhType.RESIDENCIAL,
  })
  phType: GrowthPhType;

  @Field(() => GrowthBuildingKind)
  @Column({
    name: 'building_kind',
    type: 'varchar',
    length: 30,
    default: GrowthBuildingKind.OTRO,
  })
  buildingKind: GrowthBuildingKind;

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

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 120, nullable: true })
  neighborhood?: string | null;

  @Field(() => Int, {
    nullable: true,
    description: 'Estimado, no verificado salvo evidencia',
  })
  @Column({ name: 'estimated_units', type: 'int', nullable: true })
  estimatedUnits?: number | null;

  @Field({ nullable: true, description: 'Matrícula inmobiliaria' })
  @Column({
    name: 'real_estate_registration',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  realEstateRegistration?: string | null;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 12, nullable: true })
  nit?: string | null;

  @Field(() => GrowthInfoStatus)
  @Column({
    name: 'info_status',
    type: 'varchar',
    length: 20,
    default: GrowthInfoStatus.PARTIAL,
  })
  infoStatus: GrowthInfoStatus;
}
