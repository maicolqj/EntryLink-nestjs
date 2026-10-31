import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  GrowthDataSubjectRequestStatus,
  GrowthDataSubjectRequestType,
  GrowthIdentifierType,
  GrowthRequestChannel,
} from '../../shared/growth.enums';

/**
 * Solicitud de un titular (consulta, rectificación, supresión, revocación,
 * oposición). El titular se identifica por hash; `subjectContact` es solo el
 * medio de respuesta y se borra al cerrar (`contactRedactedAt`).
 */
@ObjectType('GrowthDataSubjectRequest')
@Entity({ schema: 'growth', name: 'data_subject_requests' })
export class DataSubjectRequest {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthDataSubjectRequestType)
  @Column({ name: 'request_type', type: 'varchar', length: 20 })
  requestType: GrowthDataSubjectRequestType;

  @Field(() => GrowthRequestChannel)
  @Column({ type: 'varchar', length: 20 })
  channel: GrowthRequestChannel;

  @Field(() => GrowthIdentifierType)
  @Column({ name: 'subject_identifier_type', type: 'varchar', length: 20 })
  subjectIdentifierType: GrowthIdentifierType;

  @Column({ name: 'subject_key_version', type: 'smallint' })
  subjectKeyVersion: number;

  @Column({ name: 'subject_identifier_hash', type: 'char', length: 64 })
  subjectIdentifierHash: string;

  @Field({
    nullable: true,
    description: 'Medio de respuesta; se borra al cerrar la solicitud',
  })
  @Column({ name: 'subject_contact', type: 'text', nullable: true })
  subjectContact?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'contact_redacted_at', type: 'timestamptz', nullable: true })
  contactRedactedAt?: Date | null;

  @Field()
  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Field({ description: 'Vencimiento legal (días hábiles en Colombia)' })
  @Column({ name: 'due_at', type: 'timestamptz' })
  dueAt: Date;

  @Field({ nullable: true })
  @Column({ name: 'extended_due_at', type: 'timestamptz', nullable: true })
  extendedDueAt?: Date | null;

  @Field({ nullable: true })
  @Column({ name: 'extension_reason', type: 'text', nullable: true })
  extensionReason?: string | null;

  @Field(() => GrowthDataSubjectRequestStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: GrowthDataSubjectRequestStatus.RECEIVED,
  })
  status: GrowthDataSubjectRequestStatus;

  @Field({ nullable: true })
  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'handled_by_user_id', type: 'uuid', nullable: true })
  handledByUserId?: string | null;

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
}
