import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import {
  ComplexDocumentAudience,
  ComplexDocumentCategory,
} from '../enums/complex-info.enums';

/**
 * Un documento del conjunto para "Mi Conjunto": manual de convivencia,
 * reglamento, actas, estados financieros…
 *
 * Tiene dos formas de contenido y puede tener las dos:
 * - `contentHtml`: el texto de un Word, convertido y sanitizado, para leer en
 *   la app sin descargar nada.
 * - un PDF, guardado en R2 SIN URL pública (`fileKey` nunca sale del
 *   servidor). Actas y estados financieros no pueden quedar al alcance de
 *   cualquiera con el enlace; el backend valida quién pide y lo sirve él.
 *
 * `version` sube cada vez que cambia el contenido: el acuse de lectura es por
 * versión, así que un manual reformado vuelve a pedir la confirmación.
 */
@ObjectType({ description: 'Documento del conjunto (Mi Conjunto)' })
@Entity('complex_documents')
@Index(['complexId', 'isPublished'])
export class ComplexDocument {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => ComplexDocumentCategory)
  @Column({
    type: 'enum',
    enum: ComplexDocumentCategory,
    enumName: 'complex_document_category',
  })
  category: ComplexDocumentCategory;

  @Field()
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Texto del documento (HTML sanitizado desde un .docx)',
  })
  @Column({ name: 'content_html', type: 'text', nullable: true })
  contentHtml?: string | null;

  /** Llave del PDF en R2. Sin @Field: la llave nunca sale del servidor. */
  @Column({ name: 'file_key', type: 'text', nullable: true })
  fileKey?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Nombre del PDF adjunto; null = sin PDF',
  })
  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName?: string | null;

  @Field(() => Int, { nullable: true, description: 'Tamaño del PDF en bytes' })
  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize?: number | null;

  @Field(() => ComplexDocumentAudience)
  @Column({
    type: 'enum',
    enum: ComplexDocumentAudience,
    enumName: 'complex_document_audience',
    default: ComplexDocumentAudience.ALL_RESIDENTS,
  })
  audience: ComplexDocumentAudience;

  @Field({ description: 'Visible para los residentes' })
  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished: boolean;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @Field({ description: 'Destacado arriba en la app' })
  @Column({ name: 'is_pinned', type: 'boolean', default: false })
  isPinned: boolean;

  @Field({ description: 'Pide al residente confirmar que lo leyó' })
  @Column({
    name: 'requires_acknowledgement',
    type: 'boolean',
    default: false,
  })
  requiresAcknowledgement: boolean;

  @Field(() => String, {
    nullable: true,
    description:
      'Vigente desde (YYYY-MM-DD). Ej: fecha de aprobación en asamblea',
  })
  @Column({ name: 'effective_date', type: 'date', nullable: true })
  effectiveDate?: string | null;

  @Field(() => Int, { description: 'Sube cada vez que cambia el contenido' })
  @Column({ type: 'int', default: 1 })
  version: number;

  @Field(() => Date, {
    description: 'Último cambio del contenido (texto o PDF)',
  })
  @Column({
    name: 'content_updated_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  contentUpdatedAt: Date;

  /** Usuario (o cuenta del complejo) que lo creó. Sin FK: puede ser un complexId. */
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById?: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt?: Date | null;

  @BeforeInsert()
  @BeforeUpdate()
  normalize() {
    if (this.title) this.title = this.title.trim().replace(/\s+/g, ' ');
    if (this.description !== undefined && this.description !== null) {
      this.description = this.description.trim() || null;
    }
  }
}
