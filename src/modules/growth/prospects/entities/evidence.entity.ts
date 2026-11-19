import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GrowthEntityType } from '../../shared/growth.enums';
import {
  GrowthEvidenceReliability,
  GrowthEvidenceStatus,
} from '../prospects.enums';

/**
 * Evidencia de un dato: fuente, URL, fecha de consulta, confiabilidad y
 * verificación. No se borra (trigger): se marca OBSOLETE.
 */
@ObjectType('GrowthEvidence')
@Entity({ schema: 'growth', name: 'evidences' })
export class Evidence {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthEntityType)
  @Column({ name: 'entity_type', type: 'varchar', length: 40 })
  entityType: GrowthEntityType;

  @Field(() => ID)
  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Field()
  @Column({ type: 'varchar', length: 60 })
  field: string;

  /** Sale por resolver: se enmascara en datos de personas sin permiso. */
  @Column({ name: 'observed_value', type: 'text', nullable: true })
  observedValue?: string | null;

  @Field(() => ID)
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  url?: string | null;

  @Field()
  @Column({ name: 'consulted_at', type: 'timestamptz' })
  consultedAt: Date;

  @Field(() => GrowthEvidenceReliability)
  @Column({
    type: 'varchar',
    length: 10,
    default: GrowthEvidenceReliability.MEDIUM,
  })
  reliability: GrowthEvidenceReliability;

  @Field(() => GrowthEvidenceStatus)
  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 20,
    default: GrowthEvidenceStatus.UNVERIFIED,
  })
  verificationStatus: GrowthEvidenceStatus;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'verified_by_user_id', type: 'uuid', nullable: true })
  verifiedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Field(() => ID)
  @Column({ name: 'captured_by_user_id', type: 'uuid' })
  capturedByUserId: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
