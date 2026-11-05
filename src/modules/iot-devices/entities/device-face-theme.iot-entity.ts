import { Column, Entity, PrimaryColumn } from 'typeorm';
import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * Catálogo de TEMAS de caras (el "skin" de la mascota) que ofrece la app.
 *
 *  - VECTOR: viene compilado en el firmware (classic, minimal). Nada que instalar.
 *  - PACKAGE: paquete JSON (formato en nexus-firmware/README_temas.md) que la
 *    matera descarga por HTTPS y verifica con SHA-256 al elegirlo, "como una
 *    actualización". Se publica en `packageUrl` (p. ej. en R2) con su `sha256`.
 *    Para actualizarlo: nuevo archivo, nuevo sha256 y `version` + 1.
 */
@ObjectType('DeviceFaceTheme', { description: 'Tema de caras de la matera' })
@Entity({ name: 'iot_device_face_themes' })
export class DeviceFaceTheme {
  /** El mismo id que usa el firmware: "classic", "minimal", "pastel"… */
  @Field(() => String)
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id: string;

  @Field(() => String)
  @Column({ type: 'varchar', length: 40 })
  nombre: string;

  @Field(() => String, {
    description: 'VECTOR (en el firmware) | PACKAGE (se descarga)',
  })
  @Column({ type: 'varchar', length: 8 })
  kind: 'VECTOR' | 'PACKAGE';

  /** Solo PACKAGE: dónde está el JSON (https). */
  @Column({ name: 'package_url', type: 'varchar', length: 300, nullable: true })
  packageUrl?: string | null;

  /** Solo PACKAGE: SHA-256 del JSON (64 hex). La matera lo rechaza si no coincide. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sha256?: string | null;

  @Field(() => Int, {
    description: 'Versión del paquete (sube al publicar uno nuevo)',
  })
  @Column({ type: 'smallint', default: 1 })
  version: number;

  /** Imagen de muestra para la pantalla "Apariencia" de RemoteLink. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'preview_url', type: 'varchar', length: 300, nullable: true })
  previewUrl?: string | null;

  @Field(() => Boolean)
  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Field(() => Int)
  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;
}
