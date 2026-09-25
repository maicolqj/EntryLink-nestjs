import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { AmenityBooking } from './amenity-booking.entity';
import { textArrayTransformer } from '../../maintenance/utils/text-array.transformer';

/**
 * Novedad de portería sobre una reserva de zona común.
 *
 * Lo que el guarda encuentra al recibir la zona —o mientras está en uso—: el
 * relato, si hay daño y las fotos. Es la evidencia con la que la
 * administración decide si cobra daños a la unidad: `chargeAmenityDamage`
 * sigue siendo de la administración; portería solo deja constancia.
 *
 * Las fotos se sellan en el servidor (SHA-256 del buffer recibido) y la hora
 * es `createdAt`, también del servidor: el EXIF del celular se edita.
 */
@ObjectType({
  description: 'Novedad registrada por portería sobre una reserva',
})
@Entity('amenity_booking_novelties')
@Index(['bookingId', 'createdAt'])
export class AmenityBookingNovelty {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @ManyToOne(() => AmenityBooking, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking?: AmenityBooking;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { description: 'Qué encontró portería' })
  @Column({ type: 'text' })
  description: string;

  @Field(() => Boolean, {
    description: 'Portería reporta daño en la zona: insumo para el cobro',
  })
  @Column({ name: 'has_damage', type: 'boolean', default: false })
  hasDamage: boolean;

  @Field(() => [String], { description: 'Fotos de evidencia (R2)' })
  @Column({
    name: 'photo_urls',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  photoUrls: string[];

  @Field(() => [String], {
    description: 'SHA-256 de cada foto, en el orden de photoUrls',
  })
  @Column({
    name: 'photo_hashes',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  photoHashes: string[];

  @Field(() => String, { nullable: true })
  @Column({ name: 'reported_by_user_id', type: 'uuid', nullable: true })
  reportedByUserId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'reported_by_name',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  reportedByName?: string | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'reported_by_role',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  reportedByRole?: string | null;

  @Field(() => Date, { description: 'Hora del servidor al recibir la novedad' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
