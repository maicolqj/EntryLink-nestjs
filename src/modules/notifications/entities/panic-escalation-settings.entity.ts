import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

/**
 * Tiempos de escalamiento de pánico, por complejo.
 *
 * Van en tabla y no en constantes porque el tiempo razonable depende del
 * conjunto: una portería con dos guardias de turno no se comporta como una con
 * uno solo de noche. Un complejo sin fila configurada usa los valores por
 * defecto de las columnas, así que no hace falta sembrar nada al crear complejos.
 */
@ObjectType()
@Entity('panic_escalation_settings')
export class PanicEscalationSettings {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Index({ unique: true })
  @Column({ name: 'complex_id' })
  complexId: string;

  /** Permite apagar el escalamiento sin borrar la configuración. */
  @Field()
  @Column({ name: 'is_enabled', default: true })
  isEnabled: boolean;

  /** Nadie confirmó haber MOSTRADO la alerta → canales alternos. */
  @Field(() => Int)
  @Column({ name: 'level1_delay_seconds', type: 'int', default: 15 })
  level1DelaySeconds: number;

  /** Nadie la RECONOCIÓ → aviso al supervisor. */
  @Field(() => Int)
  @Column({ name: 'level2_delay_seconds', type: 'int', default: 45 })
  level2DelaySeconds: number;

  /** Sigue sin reconocer → contacto de emergencia y SUPER_ADMIN. */
  @Field(() => Int)
  @Column({ name: 'level3_delay_seconds', type: 'int', default: 90 })
  level3DelaySeconds: number;

  /** Correo del contacto de emergencia del conjunto (nivel 3). */
  @Field(() => String, { nullable: true })
  @Column({ name: 'emergency_contact_email', nullable: true })
  emergencyContactEmail?: string;

  /** Teléfono del contacto de emergencia. Lo usará el canal de voz cuando exista. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'emergency_contact_phone', nullable: true })
  emergencyContactPhone?: string;

  @Field()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
