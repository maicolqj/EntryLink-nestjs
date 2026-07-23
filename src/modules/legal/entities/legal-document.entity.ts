import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';
import { LegalAudience } from '../enums/legal-audience.enum';

/**
 * Documento legal (Términos, Política de Privacidad, DPA, etc.).
 * - `contentHtml`: vista web, generada de un .docx subido por el SUPER_ADMIN.
 * - `downloadFileUrl`: PDF descargable (ej. DPA a firmar), subido aparte.
 * - `audience`: PUBLIC (/legal) o COMPLEX (solo complejos registrados).
 */
@ObjectType({ description: 'Documento legal público del sistema' })
@Entity({ name: 'legal_documents' })
@Index(['slug'], { unique: true })
export class LegalDocument {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String, { description: 'Identificador de URL: /legal/<slug>' })
  @Column({ type: 'varchar', length: 120, unique: true })
  slug: string;

  @Field(() => String, { description: 'Título del documento' })
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Field(() => String, { description: 'Descripción corta para el índice', nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Field(() => String, { description: 'Contenido HTML sanitizado', nullable: true })
  @Column({ name: 'content_html', type: 'text', nullable: true })
  contentHtml?: string;

  @Field(() => Boolean, { description: 'Si está publicado (visible/activo)' })
  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished: boolean;

  @Field(() => LegalAudience, { description: 'Audiencia: PUBLIC (/legal) o COMPLEX (solo complejos registrados)' })
  @Column({ type: 'enum', enum: LegalAudience, default: LegalAudience.PUBLIC })
  audience: LegalAudience;

  @Field(() => Boolean, { description: 'Si ofrece un archivo descargable (PDF)' })
  @Column({ name: 'is_downloadable', type: 'boolean', default: false })
  isDownloadable: boolean;

  @Field(() => String, { description: 'URL del PDF descargable (R2)', nullable: true })
  @Column({ name: 'download_file_url', type: 'text', nullable: true })
  downloadFileUrl?: string;

  @Field(() => String, { description: 'Nombre del archivo descargable', nullable: true })
  @Column({ name: 'download_file_name', type: 'varchar', length: 255, nullable: true })
  downloadFileName?: string;

  /** Key de R2 para poder eliminar/reemplazar el archivo. Sin @Field = oculto en GraphQL. */
  @Column({ name: 'download_file_public_id', type: 'text', nullable: true })
  downloadFilePublicId?: string;

  @Field(() => Int, { description: 'Versión, incrementa en cada actualización de contenido' })
  @Column({ type: 'int', default: 1 })
  version: number;

  @Field(() => String, { description: 'ID del usuario que actualizó por última vez', nullable: true })
  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById?: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
