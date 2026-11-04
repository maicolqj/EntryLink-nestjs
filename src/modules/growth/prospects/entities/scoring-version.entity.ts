import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  GrowthPriority,
  GrowthProspectKind,
  GrowthScoringPredicate,
  GrowthScoringVersionOrigin,
  GrowthScoringVersionStatus,
} from '../prospects.enums';
import { GrowthScoreItem } from './dedupe-scoring.entity';

/** Una regla dentro de una versión: lo que usa el motor, nada más. */
@ObjectType('GrowthScoringVersionRule')
export class ScoringVersionRule {
  @Field()
  key: string;

  @Field()
  label: string;

  @Field(() => GrowthScoringPredicate)
  predicate: GrowthScoringPredicate;

  @Field(() => GraphQLJSON)
  params: Record<string, unknown>;

  @Field(() => Int)
  points: number;

  @Field(() => [GrowthProspectKind])
  appliesTo: GrowthProspectKind[];

  @Field()
  active: boolean;

  @Field(() => Int)
  sortOrder: number;
}

@ObjectType('GrowthScoringVersionThresholds')
export class ScoringVersionThresholds {
  @Field(() => Int, { description: 'Desde este puntaje la prioridad es Alta' })
  high: number;

  @Field(() => Int, { description: 'Desde este puntaje la prioridad es Media' })
  medium: number;
}

/**
 * Versión de reglas y umbrales del scoring. Se edita solo en DRAFT; para
 * volverse ACTIVE necesita aprobación de alguien que no la propuso ni la
 * editó (salvo la excepción de SUPER_ADMIN, auditada). Fuera de DRAFT es
 * inmutable y nunca se borra (lo impide la base).
 */
@ObjectType('GrowthScoringVersion')
@Entity({ schema: 'growth', name: 'scoring_versions' })
export class ScoringVersion {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => Int)
  @Column({ type: 'int' })
  number: number;

  @Field(() => GrowthScoringVersionStatus)
  @Column({ type: 'varchar', length: 10 })
  status: GrowthScoringVersionStatus;

  @Field(() => GrowthScoringVersionOrigin)
  @Column({ type: 'varchar', length: 10 })
  origin: GrowthScoringVersionOrigin;

  @Field(() => [ScoringVersionRule])
  @Column({ type: 'jsonb' })
  rules: ScoringVersionRule[];

  @Field(() => ScoringVersionThresholds)
  @Column({ type: 'jsonb' })
  thresholds: ScoringVersionThresholds;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'based_on_version_id', type: 'uuid', nullable: true })
  basedOnVersionId: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Field(() => [ID], {
    description:
      'Quienes propusieron o editaron el borrador: ninguno lo aprueba',
  })
  @Column({ name: 'contributor_user_ids', type: 'uuid', array: true })
  contributorUserIds: string[];

  @Field(() => ID, { nullable: true })
  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Field({ nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Field({
    description:
      'true si la aprobó quien la propuso, por la excepción de SUPER_ADMIN (auditada)',
  })
  @Column({ name: 'self_approval_exception', type: 'boolean', default: false })
  selfApprovalException: boolean;

  @Field({ nullable: true })
  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Field({ nullable: true })
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt: Date | null;

  @Field({ nullable: true })
  @Column({
    name: 'retired_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  retiredReason: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}

/**
 * Cada puntaje distinto que tuvo un prospecto, con la versión que lo
 * produjo. Append-only: la base rechaza UPDATE, DELETE y TRUNCATE.
 */
@ObjectType('GrowthProspectScoreHistoryEntry')
@Entity({ schema: 'growth', name: 'prospect_score_history' })
export class ProspectScoreHistory {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'person_id', type: 'uuid', nullable: true })
  personId: string | null;

  @Field(() => Int)
  @Column({ type: 'int' })
  score: number;

  @Field(() => GrowthPriority)
  @Column({ type: 'varchar', length: 10 })
  priority: GrowthPriority;

  @Field(() => [GrowthScoreItem])
  @Column({ type: 'jsonb' })
  breakdown: GrowthScoreItem[];

  @Field()
  @Column({ name: 'has_estimates', type: 'boolean' })
  hasEstimates: boolean;

  @Field(() => ID)
  @Column({ name: 'version_id', type: 'uuid' })
  versionId: string;

  @Field(() => Int)
  @Column({ name: 'rules_version', type: 'int' })
  rulesVersion: number;

  @Field()
  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' })
  computedAt: Date;
}
