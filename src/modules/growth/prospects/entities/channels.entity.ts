import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GrowthChannelClass, GrowthChannelKind } from '../prospects.enums';

@ObjectType({ isAbstract: true })
abstract class ChannelRecord {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthChannelKind)
  @Column({ type: 'varchar', length: 20 })
  kind: GrowthChannelKind;

  @Field({ nullable: true })
  @Column({
    name: 'social_network',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  socialNetwork?: string | null;

  /** Sin @Field: sale por un resolver (en personas, enmascarado sin permiso). */
  @Column({ type: 'text' })
  value: string;

  @Column({ name: 'value_normalized', type: 'text' })
  valueNormalized: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 60, nullable: true })
  label?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'verified_by_user_id', type: 'uuid', nullable: true })
  verifiedByUserId?: string | null;

  @Field(() => ID)
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => ID)
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}

/** Canal corporativo de una empresa (no es dato personal). */
@ObjectType('GrowthOrganizationChannel')
@Entity({ schema: 'growth', name: 'organization_channels' })
export class OrganizationChannel extends ChannelRecord {
  @Field(() => ID)
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;
}

/** Canal de una persona (dato personal: se enmascara sin permiso). */
@ObjectType('GrowthPersonChannel')
@Entity({ schema: 'growth', name: 'person_channels' })
export class PersonChannel extends ChannelRecord {
  @Field(() => ID)
  @Column({ name: 'person_id', type: 'uuid' })
  personId: string;

  @Field(() => GrowthChannelClass)
  @Column({ name: 'channel_class', type: 'varchar', length: 20 })
  channelClass: GrowthChannelClass;
}
