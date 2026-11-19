import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GrowthManagerType, GrowthRelationStatus } from '../prospects.enums';

/** Persona ↔ empresa a lo largo del tiempo (sin unicidad: puede volver). */
@ObjectType('GrowthEmployment')
@Entity({ schema: 'growth', name: 'employments' })
export class Employment {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID)
  @Column({ name: 'person_id', type: 'uuid' })
  personId: string;

  @Field(() => ID)
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Field({ nullable: true })
  @Column({ name: 'role_title', type: 'varchar', length: 120, nullable: true })
  roleTitle?: string | null;

  @Field({ nullable: true, description: 'YYYY-MM-DD' })
  @Column({ name: 'started_on', type: 'date', nullable: true })
  startedOn?: string | null;

  @Field({ nullable: true, description: 'YYYY-MM-DD' })
  @Column({ name: 'ended_on', type: 'date', nullable: true })
  endedOn?: string | null;

  @Field(() => GrowthRelationStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: GrowthRelationStatus.UNCONFIRMED,
  })
  status: GrowthRelationStatus;

  @Field(() => ID)
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;
}

/**
 * Quién administra una copropiedad, con historial. La base permite una sola
 * administración CURRENT por copropiedad.
 */
@ObjectType('GrowthPropertyManagement')
@Entity({ schema: 'growth', name: 'property_managements' })
export class PropertyManagement {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID)
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId: string;

  @Field(() => GrowthManagerType)
  @Column({ name: 'manager_type', type: 'varchar', length: 20 })
  managerType: GrowthManagerType;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Administrador independiente',
  })
  @Column({ name: 'person_id', type: 'uuid', nullable: true })
  personId?: string | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Responsable designado por la empresa',
  })
  @Column({ name: 'responsible_person_id', type: 'uuid', nullable: true })
  responsiblePersonId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'started_on', type: 'date', nullable: true })
  startedOn?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'ended_on', type: 'date', nullable: true })
  endedOn?: string | null;

  @Field(() => GrowthRelationStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: GrowthRelationStatus.UNCONFIRMED,
  })
  status: GrowthRelationStatus;

  @Field(() => ID)
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;
}
