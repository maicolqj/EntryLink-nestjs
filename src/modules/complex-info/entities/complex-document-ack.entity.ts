import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { ComplexDocument } from './complex-document.entity';

/**
 * "Leí y acepto" de un residente sobre UNA versión de un documento.
 *
 * Es la prueba de que el manual le llegó: si el documento cambia, la versión
 * sube y el acuse anterior deja de contar para la nueva. Nunca se edita ni se
 * borra —queda como historial.
 */
@Entity('complex_document_acks')
@Index(['documentId', 'version', 'userId'], { unique: true })
export class ComplexDocumentAck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Unidad desde la que confirmó: el informe cuenta unidades, no personas. */
  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @CreateDateColumn({ name: 'acknowledged_at', type: 'timestamptz' })
  acknowledgedAt: Date;

  @ManyToOne(() => ComplexDocument, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document?: ComplexDocument;
}
