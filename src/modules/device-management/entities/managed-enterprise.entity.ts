import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * La "empresa" de Android Management API que agrupa los equipos de portería.
 *
 * Es una sola para toda la plataforma (Alternaqj la administra; los conjuntos
 * se distinguen por el `complexId` que lleva cada QR de inscripción). La tabla
 * tiene a lo sumo una fila.
 */
@Entity({ name: 'managed_enterprises' })
export class ManagedEnterprise {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre del recurso en Google: `enterprises/LC0xxxxx`. */
  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200, nullable: true })
  displayName?: string | null;

  /** Huella de la política aplicada; si el código la cambia, se reaplica al arrancar. */
  @Column({ name: 'policy_hash', type: 'varchar', length: 64, nullable: true })
  policyHash?: string | null;

  @Column({ name: 'policy_applied_at', type: 'timestamptz', nullable: true })
  policyAppliedAt?: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
