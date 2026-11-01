import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Column, Entity } from 'typeorm';
import {
  GrowthContactStatus,
  GrowthInterestSignal,
  GrowthLegalBasis,
} from '../prospects.enums';
import { ValidatableRecord } from './validatable-record';

/**
 * Persona natural (dato personal): administrador independiente, empleado de
 * una empresa o contacto de una copropiedad.
 *
 * Nace con PENDING_LEGAL_REVIEW y contacto NOT_AUTHORIZED. La base impide
 * (CHECK) autorizar contacto sin base jurídica revisada y documentada.
 */
@ObjectType('GrowthPerson')
@Entity({ schema: 'growth', name: 'people' })
export class Person extends ValidatableRecord {
  @Field()
  @Column({ name: 'full_name', type: 'varchar', length: 160 })
  fullName: string;

  @Column({ name: 'name_normalized', type: 'varchar', length: 160 })
  nameNormalized: string;

  @Field()
  @Column({ name: 'is_independent_admin', type: 'boolean', default: false })
  isIndependentAdmin: boolean;

  @Field({ description: 'Finalidad del tratamiento' })
  @Column({ name: 'processing_purpose', type: 'text' })
  processingPurpose: string;

  @Field(() => GrowthLegalBasis)
  @Column({
    name: 'legal_basis',
    type: 'varchar',
    length: 30,
    default: GrowthLegalBasis.PENDING_LEGAL_REVIEW,
  })
  legalBasis: GrowthLegalBasis;

  @Field({
    nullable: true,
    description: 'Concepto o soporte de la base jurídica',
  })
  @Column({ name: 'legal_basis_reference', type: 'text', nullable: true })
  legalBasisReference?: string | null;

  @Field(() => ID, { nullable: true })
  @Column({
    name: 'legal_basis_reviewed_by_user_id',
    type: 'uuid',
    nullable: true,
  })
  legalBasisReviewedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({
    name: 'legal_basis_reviewed_at',
    type: 'timestamptz',
    nullable: true,
  })
  legalBasisReviewedAt?: Date | null;

  @Field(() => GrowthContactStatus)
  @Column({
    name: 'contact_status',
    type: 'varchar',
    length: 20,
    default: GrowthContactStatus.NOT_AUTHORIZED,
  })
  contactStatus: GrowthContactStatus;

  @Field(() => ID, { nullable: true })
  @Column({
    name: 'contact_authorized_by_user_id',
    type: 'uuid',
    nullable: true,
  })
  contactAuthorizedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({
    name: 'contact_authorized_at',
    type: 'timestamptz',
    nullable: true,
  })
  contactAuthorizedAt?: Date | null;

  @Field({ nullable: true })
  @Column({ name: 'contact_status_reason', type: 'text', nullable: true })
  contactStatusReason?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'last_interaction_at', type: 'timestamptz', nullable: true })
  lastInteractionAt?: Date | null;

  @Field({
    description: '12 meses desde la última verificación o interacción',
  })
  @Column({
    name: 'retention_review_at',
    type: 'timestamptz',
    insert: false,
    update: false,
  })
  retentionReviewAt: Date;

  @Field(() => GrowthInterestSignal)
  @Column({
    name: 'interest_signal',
    type: 'varchar',
    length: 20,
    default: GrowthInterestSignal.NONE,
  })
  interestSignal: GrowthInterestSignal;

  @Field({ nullable: true })
  @Column({ name: 'anonymized_at', type: 'timestamptz', nullable: true })
  anonymizedAt?: Date | null;
}
