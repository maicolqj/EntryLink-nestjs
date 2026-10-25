import { Column, Entity, PrimaryColumn } from 'typeorm';
import { Field, Int, ObjectType } from '@nestjs/graphql';

/** Hardware que necesita un tema: ninguno, microSD o PSRAM. */
export type FaceThemeRequirement = 'none' | 'sd' | 'psram';

/**
 * Catálogo de TEMAS de caras (el "skin" de la mascota) que la app puede
 * ofrecer. Que un tema esté aquí no basta: la matera tiene que poder
 * mostrarlo (ver availableThemesForDevice, que lo cruza con lo que reporta).
 */
@ObjectType('DeviceFaceTheme', { description: 'Tema de caras de la matera' })
@Entity({ name: 'iot_device_face_themes' })
export class DeviceFaceTheme {
  /** El mismo id que usa el firmware (set_theme): "classic", "minimal"… */
  @Field(() => String)
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id: string;

  @Field(() => String)
  @Column({ type: 'varchar', length: 40 })
  nombre: string;

  /** VECTOR (por código, va en el firmware) | BITMAP (imágenes en la microSD) */
  @Field(() => String)
  @Column({ type: 'varchar', length: 8 })
  kind: 'VECTOR' | 'BITMAP';

  @Field(() => String)
  @Column({ type: 'varchar', length: 8, default: 'none' })
  requires: FaceThemeRequirement;

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
