import {
  Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index,
} from 'typeorm';

import { AccountingDocumentType } from '../enums/accounting-document-type.enum';

/**
 * Consecutivo legal por copropiedad y tipo de documento.
 * Se lee con lock pesimista (FOR UPDATE) al emitir cada comprobante para
 * serializar la numeración y evitar huecos o duplicados bajo concurrencia.
 *
 * No es ObjectType: es infraestructura interna, no se expone por GraphQL.
 */
@Entity('document_sequences')
@Index(['complexId', 'documentType'], { unique: true })
export class DocumentSequence {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  complexId: string;

  @Column({ type: 'enum', enum: AccountingDocumentType })
  documentType: AccountingDocumentType;

  @Column({ type: 'int', default: 0 })
  lastNumber: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
