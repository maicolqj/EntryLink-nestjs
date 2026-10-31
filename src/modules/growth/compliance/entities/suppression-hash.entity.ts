import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GrowthIdentifierType } from '../../shared/growth.enums';

/**
 * Hash de una exclusión con una versión de la llave HMAC. Rotar la llave
 * agrega filas; nada se reescribe (trigger append-only). Sin ObjectType: un
 * hash nunca sale por GraphQL.
 */
@Entity({ schema: 'growth', name: 'suppression_hashes' })
export class SuppressionHash {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'suppression_id', type: 'uuid' })
  suppressionId: string;

  @Column({ name: 'identifier_type', type: 'varchar', length: 20 })
  identifierType: GrowthIdentifierType;

  @Column({ name: 'key_version', type: 'smallint' })
  keyVersion: number;

  @Column({ name: 'identifier_hash', type: 'char', length: 64 })
  identifierHash: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
