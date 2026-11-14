import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * En qué portería está cada vigilante ahora. Una fila por vigilante: elegir
 * otra la reemplaza. La elige él en EntryLink al empezar el turno.
 */
@Entity({ name: 'security_post_guards' })
@Index('IDX_security_post_guards_post', ['securityPostId'])
export class SecurityPostGuard {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Column({ name: 'security_post_id', type: 'uuid' })
  securityPostId: string;

  @Column({ name: 'selected_at', type: 'timestamptz' })
  selectedAt: Date;
}
