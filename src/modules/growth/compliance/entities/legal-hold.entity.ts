import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GrowthEntityType } from '../../shared/growth.enums';

/**
 * Retención legal: impide anonimizar o eliminar una entidad mientras exista
 * una obligación que justifique conservarla. Siempre tiene fecha de fin (a lo
 * sumo 10 años, CHECK en la base): no existe la retención indefinida.
 */
@ObjectType('GrowthLegalHold')
@Entity({ schema: 'growth', name: 'legal_holds' })
export class LegalHold {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthEntityType)
  @Column({ name: 'entity_type', type: 'varchar', length: 40 })
  entityType: GrowthEntityType;

  @Field(() => ID)
  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Field({ description: 'Norma u obligación que justifica conservar' })
  @Column({ name: 'legal_basis', type: 'text' })
  legalBasis: string;

  @Field({ description: 'Fecha (YYYY-MM-DD) hasta la que se conserva' })
  @Column({ name: 'hold_until', type: 'date' })
  holdUntil: string;

  @Field({ nullable: true })
  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt?: Date | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'released_by_user_id', type: 'uuid', nullable: true })
  releasedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'release_reason', type: 'text', nullable: true })
  releaseReason?: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => ID)
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;
}
