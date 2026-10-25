import { Column, Entity, PrimaryColumn } from 'typeorm';
import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * Catálogo de avisos de EntryLink que puede mostrar un aparato (aro LED +
 * buzzer + icono). El firmware no conoce los tipos: recibe el mensaje ya
 * resuelto (color, patrón, sonido, icono, texto, duración). Un tipo nuevo es
 * una fila aquí, sin tocar el firmware.
 *
 * `entrylinkTypes` dice qué `NotificationType` de EntryLink se reenvían como
 * este tipo (p. ej. PACKAGE_RECEIVED → PACKAGE).
 */
@ObjectType('DeviceNotificationType', {
  description: 'Tipo de aviso que muestra el dispositivo',
})
@Entity({ name: 'iot_device_notification_types' })
export class DeviceNotificationType {
  @Field(() => String)
  @PrimaryColumn({ type: 'varchar', length: 32 })
  key: string;

  @Field(() => String)
  @Column({ type: 'varchar', length: 60 })
  title: string;

  /** Icono que dibuja el firmware: package, panic, info, visitor, alert. */
  @Field(() => String)
  @Column({ type: 'varchar', length: 12 })
  icon: string;

  @Field(() => String)
  @Column({ name: 'led_color', type: 'varchar', length: 7 })
  ledColor: string;

  /** solid | blink | pulse */
  @Field(() => String)
  @Column({ name: 'led_pattern', type: 'varchar', length: 8 })
  ledPattern: string;

  /** none | beep | two_beep | alarm */
  @Field(() => String)
  @Column({ type: 'varchar', length: 12 })
  sound: string;

  @Field(() => Int)
  @Column({ type: 'smallint', default: 0 })
  priority: number;

  /** true: pausa la cara · false: aviso discreto en la franja. */
  @Field(() => Boolean)
  @Column({ type: 'boolean', default: true })
  interrupts: boolean;

  /** El residente no lo puede desactivar (p. ej. PANIC). */
  @Field(() => Boolean)
  @Column({ type: 'boolean', default: false })
  mandatory: boolean;

  /** Solo se garantiza en tiempo real enchufado (USB). Con batería, al despertar si no caducó. */
  @Field(() => Boolean)
  @Column({ name: 'requires_powered', type: 'boolean', default: false })
  requiresPowered: boolean;

  /** Segundos en pantalla (1-300). */
  @Field(() => Int)
  @Column({ name: 'ttl_sec', type: 'smallint', default: 20 })
  ttlSec: number;

  /** Cuánto espera en la cola si el aparato no está conectado (s). */
  @Field(() => Int)
  @Column({ name: 'delivery_ttl_sec', type: 'integer', default: 3600 })
  deliveryTtlSec: number;

  /** Las horas de silencio no lo detienen (PANIC). */
  @Field(() => Boolean)
  @Column({ type: 'boolean', default: false })
  urgent: boolean;

  @Field(() => [String])
  @Column({
    name: 'entrylink_types',
    type: 'text',
    array: true,
    default: () => `'{}'`,
  })
  entrylinkTypes: string[];
}
