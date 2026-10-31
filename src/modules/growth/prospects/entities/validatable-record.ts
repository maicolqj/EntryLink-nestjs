import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GrowthValidationStatus } from '../prospects.enums';

/**
 * Columnas comunes de empresas, personas y copropiedades: validación humana
 * y auditoría. Las transiciones de `validationStatus` las vigila un trigger.
 */
@ObjectType({ isAbstract: true })
export abstract class ValidatableRecord {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID, { description: 'Fuente del registro (obligatoria)' })
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Field(() => GrowthValidationStatus)
  @Column({
    name: 'validation_status',
    type: 'varchar',
    length: 20,
    default: GrowthValidationStatus.NEW,
  })
  validationStatus: GrowthValidationStatus;

  @Field(() => ID, { nullable: true, description: 'Quien tomó la validación' })
  @Column({ name: 'validation_taken_by_user_id', type: 'uuid', nullable: true })
  validationTakenByUserId?: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'validated_by_user_id', type: 'uuid', nullable: true })
  validatedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt?: Date | null;

  @Field({ nullable: true })
  @Column({ name: 'validation_note', type: 'text', nullable: true })
  validationNote?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt?: Date | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => ID)
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
