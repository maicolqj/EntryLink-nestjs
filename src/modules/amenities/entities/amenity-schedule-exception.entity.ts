import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { Amenity } from './amenity.entity';

/**
 * Excepción de horario para una FECHA concreta.
 *
 * El horario semanal (`AmenitySchedule`) resuelve el caso normal —"los sábados
 * de 12:00 a 05:00"— y no hay que volver a cargarlo nunca. Pero hay fechas que
 * se salen de la regla: un festivo en que el salón se presta hasta la madrugada
 * del lunes, o un día en que simplemente no se presta.
 *
 * Esta tabla es esa excepción, y REEMPLAZA al horario semanal en esa fecha: no
 * se suma. Si `isClosed` es true la zona no abre ese día, sin importar lo que
 * diga la semana; si no, `openTime`/`closeTime` definen la única ventana, con la
 * misma convención que el horario semanal — un cierre anterior a la apertura
 * termina al día siguiente.
 *
 * Se eligió esto sobre un calendario de festivos porque el reglamento de cada
 * copropiedad decide qué días son especiales, y no siempre coinciden con los
 * festivos oficiales.
 */
@ObjectType({
  description: 'Horario especial de una zona común para una fecha puntual',
})
@Entity({ name: 'amenity_schedule_exceptions' })
@Index(['amenityId', 'date'], { unique: true })
@Index(['complexId', 'date'])
export class AmenityScheduleException {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ name: 'amenity_id', type: 'uuid' })
  amenityId: string;

  @Field(() => Amenity, { nullable: true })
  @ManyToOne(() => Amenity, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'amenity_id' })
  amenity?: Amenity;

  @Field()
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  /**
   * Fecha calendario YYYY-MM-DD. Va como `date` y no como timestamp a
   * propósito: es un día del calendario del complejo, no un instante, y
   * guardarlo con zona horaria lo correría un día en los bordes.
   */
  @Field(() => String, { description: 'Fecha en formato YYYY-MM-DD' })
  @Column({ type: 'date' })
  date: string;

  @Field(() => Boolean, {
    description:
      'true: la zona no abre ese día, sin importar el horario semanal',
  })
  @Column({ name: 'is_closed', type: 'boolean', default: false })
  isClosed: boolean;

  /** Null cuando `isClosed`. Hora de pared, como el horario semanal. */
  @Field(() => String, {
    nullable: true,
    description: 'Hora de apertura HH:mm',
  })
  @Column({ name: 'open_time', type: 'time', nullable: true })
  openTime?: string | null;

  /** Un cierre anterior a la apertura significa que termina al día siguiente. */
  @Field(() => String, { nullable: true, description: 'Hora de cierre HH:mm' })
  @Column({ name: 'close_time', type: 'time', nullable: true })
  closeTime?: string | null;

  /** Por qué esta fecha es distinta. Lo ve el residente cuando el día está cerrado. */
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  reason?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
