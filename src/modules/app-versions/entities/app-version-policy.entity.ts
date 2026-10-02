import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { ClientApp, ClientPlatform } from '../enums/client-app.enum';

/**
 * Versión mínima que puede usar cada app, por plataforma.
 *
 * Las actualizaciones normales las ofrece Google Play dentro de la app y el
 * usuario puede posponerlas. Esta política es para los cambios que rompen
 * compatibilidad (p. ej. un cambio disruptivo en la base de datos): las
 * instalaciones con `versionCode` menor a `minVersionCode` quedan bloqueadas
 * hasta actualizar.
 */
@ObjectType({ description: 'Versión mínima obligatoria de una app' })
@Entity({ name: 'app_version_policies' })
@Unique('UQ_app_version_policies_app_platform', ['app', 'platform'])
export class AppVersionPolicy {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ClientApp)
  @Column({ type: 'varchar', length: 20 })
  app: ClientApp;

  @Field(() => ClientPlatform)
  @Column({ type: 'varchar', length: 10 })
  platform: ClientPlatform;

  @Field(() => Int, {
    description:
      'versionCode (Android) o build number (iOS) mínimo. 0 = no se obliga a nadie.',
  })
  @Column({ name: 'min_version_code', type: 'int', default: 0 })
  minVersionCode: number;

  @Field(() => String, {
    nullable: true,
    description: 'Mensaje para el usuario al bloquear (vacío = texto genérico)',
  })
  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
