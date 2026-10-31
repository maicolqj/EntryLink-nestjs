import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  GrowthLegalReviewStatus,
  GrowthSourceKind,
  GrowthSourceStatus,
} from '../../shared/growth.enums';

const numeric = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v == null ? null : Number(v)),
};

/**
 * Fuente de información comercial con su finalidad y sus condiciones de uso.
 * La base impide (CHECK) que quede ACTIVE sin revisión jurídica aprobada, y
 * que una de pago quede ACTIVE sin presupuesto, tope y aprobación de costo.
 */
@ObjectType('GrowthDataSource')
@Entity({ schema: 'growth', name: 'data_sources' })
export class GrowthDataSource {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'varchar', length: 40, unique: true })
  code: string;

  @Field()
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Field(() => GrowthSourceKind)
  @Column({ type: 'varchar', length: 30 })
  kind: GrowthSourceKind;

  @Field({ nullable: true })
  @Column({ name: 'base_url', type: 'text', nullable: true })
  baseUrl?: string | null;

  @Field({ description: 'Qué permite la fuente y bajo qué condiciones' })
  @Column({ name: 'terms_summary', type: 'text' })
  termsSummary: string;

  @Field({
    description: 'Finalidad del tratamiento declarada para esta fuente',
  })
  @Column({ name: 'processing_purpose', type: 'text' })
  processingPurpose: string;

  @Field()
  @Column({ name: 'allows_automation', type: 'boolean', default: false })
  allowsAutomation: boolean;

  @Field(() => GrowthLegalReviewStatus)
  @Column({
    name: 'legal_review_status',
    type: 'varchar',
    length: 20,
    default: GrowthLegalReviewStatus.PENDING,
  })
  legalReviewStatus: GrowthLegalReviewStatus;

  @Field({
    nullable: true,
    description: 'Concepto jurídico o documento que respalda la revisión',
  })
  @Column({ name: 'legal_review_reference', type: 'text', nullable: true })
  legalReviewReference?: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'legal_reviewed_by_user_id', type: 'uuid', nullable: true })
  legalReviewedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'legal_reviewed_at', type: 'timestamptz', nullable: true })
  legalReviewedAt?: Date | null;

  @Field()
  @Column({ name: 'requires_cost_approval', type: 'boolean', default: false })
  requiresCostApproval: boolean;

  @Field(() => Float, { nullable: true })
  @Column({
    name: 'monthly_budget_cop',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numeric,
  })
  monthlyBudgetCop?: number | null;

  @Field(() => Int, { nullable: true })
  @Column({ name: 'monthly_request_cap', type: 'int', nullable: true })
  monthlyRequestCap?: number | null;

  @Field({ nullable: true })
  @Column({ name: 'cost_estimate_notes', type: 'text', nullable: true })
  costEstimateNotes?: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'cost_approved_by_user_id', type: 'uuid', nullable: true })
  costApprovedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'cost_approved_at', type: 'timestamptz', nullable: true })
  costApprovedAt?: Date | null;

  @Field(() => GrowthSourceStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: GrowthSourceStatus.PENDING_APPROVAL,
  })
  status: GrowthSourceStatus;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
