import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  GrowthChannelClass,
  GrowthEvidenceReliability,
} from '../../prospects/prospects.enums';
import {
  GrowthImportDecision,
  GrowthImportField,
  GrowthImportFileKind,
  GrowthImportRowResult,
  GrowthImportStatus,
  GrowthImportTarget,
  GrowthImportTemplateScope,
} from '../imports.enums';

/** Una columna del archivo (por posición) asignada a un campo. */
@ObjectType('GrowthImportColumnMapping')
export class ImportColumnMapping {
  @Field(() => Int, { description: 'Posición de la columna (desde 0)' })
  column: number;

  @Field(() => GrowthImportField)
  field: GrowthImportField;
}

/** Problema de una fila. Nunca lleva el valor: solo campo y código. */
@ObjectType('GrowthImportIssue')
export class ImportIssue {
  @Field({ nullable: true })
  field?: string;

  @Field({
    description:
      'REQUIRED, INVALID_NIT, NIT_CHECK_DIGIT, INVALID_EMAIL, INVALID_PHONE, INVALID_WEBSITE, INVALID_LOCALITY, INVALID_NUMBER, INVALID_BOOLEAN, INVALID_OPTION, TOO_LONG, TOO_SHORT, SUPPRESSED, DUPLICATE_IN_FILE, MATCHES_EXISTING',
  })
  code: string;
}

/** Coincidencia exacta con un registro que ya existe o con otra fila. */
@ObjectType('GrowthImportDuplicateHint')
export class ImportDuplicateHint {
  @Field(() => [String], {
    description: 'NIT, REGISTRATION, EMAIL, PHONE, DOMAIN, ADDRESS',
  })
  matchedOn: string[];

  @Field(() => [ID])
  existingIds: string[];

  @Field(() => Int, {
    nullable: true,
    description: 'Fila anterior del mismo archivo',
  })
  sameFileRow?: number | null;
}

@ObjectType('GrowthImportBatch')
@Entity({ schema: 'growth', name: 'import_batches' })
export class ImportBatch {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthImportTarget)
  @Column({ type: 'varchar', length: 20 })
  target: GrowthImportTarget;

  @Field(() => ID)
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Field({ nullable: true })
  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl?: string | null;

  @Field()
  @Column({ name: 'consulted_at', type: 'timestamptz' })
  consultedAt: Date;

  @Field(() => GrowthEvidenceReliability)
  @Column({ type: 'varchar', length: 10 })
  reliability: GrowthEvidenceReliability;

  @Field({ nullable: true })
  @Column({ name: 'source_notes', type: 'text', nullable: true })
  sourceNotes?: string | null;

  @Field()
  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Field(() => GrowthImportFileKind)
  @Column({ name: 'file_kind', type: 'varchar', length: 10 })
  fileKind: GrowthImportFileKind;

  @Field(() => Int)
  @Column({ name: 'file_size', type: 'int' })
  fileSize: number;

  @Field()
  @Column({ name: 'file_sha256', type: 'char', length: 64 })
  fileSha256: string;

  @Field(() => [String])
  @Column({ type: 'text', array: true })
  headers: string[];

  @Field(() => [ImportColumnMapping], { nullable: true })
  @Column({ name: 'column_mapping', type: 'jsonb', nullable: true })
  columnMapping?: ImportColumnMapping[] | null;

  @Field(() => GrowthChannelClass, { nullable: true })
  @Column({
    name: 'person_channel_class',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  personChannelClass?: GrowthChannelClass | null;

  @Field(() => GrowthImportStatus)
  @Column({ type: 'varchar', length: 20, default: GrowthImportStatus.UPLOADED })
  status: GrowthImportStatus;

  @Field({ nullable: true })
  @Column({ name: 'status_reason', type: 'text', nullable: true })
  statusReason?: string | null;

  @Field(() => Int)
  @Column({ name: 'total_rows', type: 'int' })
  totalRows: number;

  @Field(() => Int)
  @Column({ name: 'valid_rows', type: 'int', default: 0 })
  validRows: number;

  @Field(() => Int)
  @Column({ name: 'error_rows', type: 'int', default: 0 })
  errorRows: number;

  @Field(() => Int)
  @Column({ name: 'duplicate_rows', type: 'int', default: 0 })
  duplicateRows: number;

  @Field(() => Int, {
    description: 'Correos o teléfonos excluidos que no se guardarán',
  })
  @Column({ name: 'suppressed_values', type: 'int', default: 0 })
  suppressedValues: number;

  @Field(() => Int)
  @Column({ name: 'created_rows', type: 'int', default: 0 })
  createdRows: number;

  @Field(() => Int)
  @Column({ name: 'linked_rows', type: 'int', default: 0 })
  linkedRows: number;

  @Field(() => Int)
  @Column({ name: 'skipped_rows', type: 'int', default: 0 })
  skippedRows: number;

  @Field(() => Int)
  @Column({ name: 'failed_rows', type: 'int', default: 0 })
  failedRows: number;

  @Field(() => ID)
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'committed_by_user_id', type: 'uuid', nullable: true })
  committedByUserId?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt?: Date | null;

  @Field({ nullable: true })
  @Column({ name: 'committed_at', type: 'timestamptz', nullable: true })
  committedAt?: Date | null;

  @Field({ nullable: true })
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;

  @Field({
    nullable: true,
    description:
      'Filas crudas eliminadas (30 días tras terminar). El archivo original nunca se guarda.',
  })
  @Column({ name: 'purged_at', type: 'timestamptz', nullable: true })
  purgedAt?: Date | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@ObjectType('GrowthImportRow')
@Entity({ schema: 'growth', name: 'import_rows' })
export class ImportRow {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID)
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Field(() => Int, { description: 'Fila del archivo (1 = encabezados)' })
  @Column({ name: 'row_number', type: 'int' })
  rowNumber: number;

  /** Valores crudos por columna. Sale por un resolver de campo (enmascarado). */
  @Column({ type: 'jsonb', nullable: true })
  raw?: string[] | null;

  /** Valores normalizados por campo. Nunca sale por GraphQL. */
  @Column({ type: 'jsonb', nullable: true })
  mapped?: Record<string, unknown> | null;

  @Field(() => [ImportIssue])
  @Column({ type: 'jsonb', default: () => `'[]'` })
  errors: ImportIssue[];

  @Field(() => [ImportIssue])
  @Column({ type: 'jsonb', default: () => `'[]'` })
  warnings: ImportIssue[];

  @Field(() => ImportDuplicateHint, { nullable: true })
  @Column({ name: 'duplicate_hint', type: 'jsonb', nullable: true })
  duplicateHint?: ImportDuplicateHint | null;

  @Field(() => GrowthImportDecision, { nullable: true })
  @Column({
    name: 'suggested_decision',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  suggestedDecision?: GrowthImportDecision | null;

  @Field(() => GrowthImportDecision, { nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  decision?: GrowthImportDecision | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId?: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'link_entity_id', type: 'uuid', nullable: true })
  linkEntityId?: string | null;

  @Field(() => GrowthImportRowResult, { nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  result?: GrowthImportRowResult | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'result_entity_id', type: 'uuid', nullable: true })
  resultEntityId?: string | null;

  @Field({ nullable: true, description: 'Código del error al confirmar' })
  @Column({ name: 'result_error', type: 'varchar', length: 60, nullable: true })
  resultError?: string | null;

  @Field({ nullable: true })
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date | null;
}

/** Mapeo guardado: por nombre de encabezado, no por posición. */
@ObjectType('GrowthImportHeaderMapping')
export class ImportHeaderMapping {
  @Field()
  header: string;

  @Field(() => GrowthImportField)
  field: GrowthImportField;
}

@ObjectType('GrowthImportTemplate')
@Entity({ schema: 'growth', name: 'import_mapping_templates' })
export class ImportMappingTemplate {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => GrowthImportTarget)
  @Column({ type: 'varchar', length: 20 })
  target: GrowthImportTarget;

  @Field()
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Field(() => [ImportHeaderMapping], {
    description: 'Solo encabezados y su campo: nunca valores del archivo',
  })
  @Column({ name: 'column_mapping', type: 'jsonb' })
  columnMapping: ImportHeaderMapping[];

  @Field(() => GrowthImportTemplateScope)
  @Column({ type: 'varchar', length: 10 })
  scope: GrowthImportTemplateScope;

  @Field(() => ID, {
    description: 'Dueño: en PERSONAL, quien la usa; en TEAM, su autor',
  })
  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @Field(() => ID)
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @Field({ nullable: true })
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ name: 'archived_by_user_id', type: 'uuid', nullable: true })
  archivedByUserId: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
