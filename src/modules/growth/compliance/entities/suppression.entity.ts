import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  GrowthIdentifierType,
  GrowthSuppressionReason,
  GrowthSuppressionScope,
  GrowthSuppressionStatus,
} from '../../shared/growth.enums';

/**
 * Exclusión comercial. Guarda el dato mínimo: el tipo de identificador y,
 * aparte (`suppression_hashes`), su hash con llave. Nunca el valor en claro.
 *
 * No se borra (trigger). El único cambio posible es levantarla
 * (ACTIVE → LIFTED) con soporte jurídico explícito, y el trigger impide tocar
 * cualquier otro campo. Ninguna solicitud del titular la levanta sola.
 */
@ObjectType('GrowthSuppression')
@Entity({ schema: 'growth', name: 'suppressions' })
export class Suppression {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthIdentifierType)
  @Column({ name: 'identifier_type', type: 'varchar', length: 20 })
  identifierType: GrowthIdentifierType;

  @Field(() => GrowthSuppressionScope)
  @Column({
    type: 'varchar',
    length: 20,
    default: GrowthSuppressionScope.ALL_CHANNELS,
  })
  scope: GrowthSuppressionScope;

  @Field(() => GrowthSuppressionReason)
  @Column({ type: 'varchar', length: 30 })
  reason: GrowthSuppressionReason;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'source_request_id', type: 'uuid', nullable: true })
  sourceRequestId?: string | null;

  @Field(() => GrowthSuppressionStatus)
  @Column({
    type: 'varchar',
    length: 10,
    default: GrowthSuppressionStatus.ACTIVE,
  })
  status: GrowthSuppressionStatus;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'lifted_at', type: 'timestamptz', nullable: true })
  liftedAt?: Date | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'lifted_by_user_id', type: 'uuid', nullable: true })
  liftedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'lift_legal_basis', type: 'text', nullable: true })
  liftLegalBasis?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'lift_evidence_reference', type: 'text', nullable: true })
  liftEvidenceReference?: string | null;
}
