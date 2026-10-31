import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  GrowthDuplicateStatus,
  GrowthPriority,
  GrowthProspectKind,
  GrowthScoreBasis,
  GrowthScoringPredicate,
} from '../prospects.enums';

const numeric = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v == null ? null : Number(v)),
};

/** Par de registros que podrían ser el mismo. Lo decide una persona. */
@ObjectType('GrowthDuplicateCandidate')
@Entity({ schema: 'growth', name: 'duplicate_candidates' })
export class DuplicateCandidate {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthProspectKind)
  @Column({ name: 'entity_type', type: 'varchar', length: 20 })
  entityType: GrowthProspectKind;

  @Field(() => ID)
  @Column({ name: 'left_id', type: 'uuid' })
  leftId: string;

  @Field(() => ID)
  @Column({ name: 'right_id', type: 'uuid' })
  rightId: string;

  @Field(() => [String], {
    description:
      'Señales: NIT, REGISTRATION, EMAIL, PHONE, DOMAIN, ADDRESS, NAME',
  })
  @Column({ name: 'matched_on', type: 'text', array: true })
  matchedOn: string[];

  @Field(() => Float)
  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: numeric })
  score: number;

  @Field(() => GrowthDuplicateStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: GrowthDuplicateStatus.PENDING,
  })
  status: GrowthDuplicateStatus;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @Field({ nullable: true })
  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Bitácora de fusiones (append-only en la base). */
@ObjectType('GrowthMergeLog')
@Entity({ schema: 'growth', name: 'merge_log' })
export class MergeLog {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthProspectKind)
  @Column({ name: 'entity_type', type: 'varchar', length: 20 })
  entityType: GrowthProspectKind;

  @Field(() => ID)
  @Column({ name: 'survivor_id', type: 'uuid' })
  survivorId: string;

  @Field(() => ID)
  @Column({ name: 'merged_id', type: 'uuid' })
  mergedId: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'candidate_id', type: 'uuid', nullable: true })
  candidateId?: string | null;

  @Field(() => GraphQLJSON, { description: 'Campo → lado elegido' })
  @Column({ name: 'field_choices', type: 'jsonb' })
  fieldChoices: Record<string, string>;

  @Field(() => GraphQLJSON, {
    description: 'Relaciones y evidencias trasladadas',
  })
  @Column({ type: 'jsonb' })
  moved: Record<string, number>;

  @Field(() => ID)
  @Column({ name: 'merged_by_user_id', type: 'uuid' })
  mergedByUserId: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@ObjectType('GrowthScoringRule')
@Entity({ schema: 'growth', name: 'scoring_rules' })
export class ScoringRule {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'varchar', length: 40, unique: true })
  key: string;

  @Field()
  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Field(() => GrowthScoringPredicate)
  @Column({ type: 'varchar', length: 30 })
  predicate: GrowthScoringPredicate;

  @Field(() => GraphQLJSON)
  @Column({ type: 'jsonb', default: () => "'{}'" })
  params: Record<string, unknown>;

  @Field(() => Int)
  @Column({ type: 'int' })
  points: number;

  @Field(() => [GrowthProspectKind])
  @Column({ name: 'applies_to', type: 'text', array: true })
  appliesTo: GrowthProspectKind[];

  @Field()
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Field(() => Int)
  @Column({ name: 'sort_order', type: 'int', default: 100 })
  sortOrder: number;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;
}

@ObjectType('GrowthScoreItem')
export class GrowthScoreItem {
  @Field()
  ruleKey: string;

  @Field()
  label: string;

  @Field(() => Int)
  points: number;

  @Field(() => GrowthScoreBasis)
  basis: GrowthScoreBasis;

  @Field({
    nullable: true,
    description: 'Valor evaluado (p. ej. número de copropiedades)',
  })
  value?: string;
}

/** Puntaje vigente de un prospecto. Nunca valida ni autoriza contacto. */
@ObjectType('GrowthProspectScore')
@Entity({ schema: 'growth', name: 'prospect_scores' })
export class ProspectScore {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'person_id', type: 'uuid', nullable: true })
  personId?: string | null;

  @Field(() => Int)
  @Column({ type: 'int' })
  score: number;

  @Field(() => GrowthPriority)
  @Column({ type: 'varchar', length: 10 })
  priority: GrowthPriority;

  @Field(() => [GrowthScoreItem], {
    description: 'Desglose: regla, puntos y base',
  })
  @Column({ type: 'jsonb' })
  breakdown: GrowthScoreItem[];

  @Field({ description: 'true si alguna regla se evaluó con datos estimados' })
  @Column({ name: 'has_estimates', type: 'boolean' })
  hasEstimates: boolean;

  @Field(() => Int)
  @Column({ name: 'rules_version', type: 'int' })
  rulesVersion: number;

  @Field()
  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' })
  computedAt: Date;
}
