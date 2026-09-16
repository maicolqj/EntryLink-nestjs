import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';

import { NotificationSnapshotAction } from './notification-action.response';

/**
 * El "expediente" de una notificación: lo que hay detrás del aviso.
 *
 * Una notificación dice "Se registró KODA y está pendiente de validación", y
 * con eso el administrador no puede decidir nada: le faltan la foto, la raza,
 * la unidad, la póliza. Antes cada tipo de aviso se resolvía a mano en la web
 * —una consulta distinta, un bloque de JSX distinto— y el módulo que se sumaba
 * después no mostraba nada hasta que alguien se acordara de agregarle su
 * bloque.
 *
 * Por eso el expediente lo arma el SERVIDOR y siempre con la misma forma:
 * secciones de campos, imágenes y archivos. La web pinta esa forma sin saber de
 * qué módulo viene, y un módulo nuevo aparece completo el día que registra su
 * proveedor.
 */

/** Cómo se lee un campo. La web decide el formato con esto, no adivinando. */
export enum NotificationFieldKind {
  TEXT = 'TEXT',
  MULTILINE = 'MULTILINE',
  DATE = 'DATE',
  MONEY = 'MONEY',
  BADGE = 'BADGE',
  LINK = 'LINK',
  PHONE = 'PHONE',
  LOCATION = 'LOCATION',
}

registerEnumType(NotificationFieldKind, {
  name: 'NotificationFieldKind',
  description: 'Formato de lectura de un campo del expediente',
});

/** Color del estado. Lo decide quien conoce el dominio, no la pantalla. */
export enum NotificationSnapshotTone {
  NEUTRAL = 'NEUTRAL',
  POSITIVE = 'POSITIVE',
  WARNING = 'WARNING',
  DANGER = 'DANGER',
}

registerEnumType(NotificationSnapshotTone, {
  name: 'NotificationSnapshotTone',
  description: 'Tono con el que se muestra el estado del expediente',
});

/** De dónde salió lo que se está mostrando. */
export enum NotificationSnapshotSource {
  /** Se leyó la entidad real: lo que se ve es el estado de HOY. */
  LIVE = 'LIVE',
  /**
   * La entidad ya no existe (se eliminó, se retiró) o el módulo todavía no
   * registra proveedor: se muestra lo que quedó guardado en la notificación.
   */
  METADATA = 'METADATA',
}

registerEnumType(NotificationSnapshotSource, {
  name: 'NotificationSnapshotSource',
  description: 'Origen de los datos del expediente',
});

@ObjectType({ description: 'Un dato del expediente, ya con nombre legible' })
export class NotificationSnapshotField {
  @Field(() => String)
  label: string;

  @Field(() => String)
  value: string;

  @Field(() => NotificationFieldKind)
  kind: NotificationFieldKind;

  /** Destino cuando el campo se puede abrir (mapa, teléfono, archivo). */
  @Field(() => String, { nullable: true })
  href?: string | null;
}

@ObjectType({ description: 'Bloque de datos del expediente' })
export class NotificationSnapshotSection {
  @Field(() => String, { nullable: true })
  title?: string | null;

  @Field(() => [NotificationSnapshotField])
  fields: NotificationSnapshotField[];
}

@ObjectType({ description: 'Imagen del expediente' })
export class NotificationSnapshotImage {
  @Field(() => String)
  url: string;

  @Field(() => String, { nullable: true })
  caption?: string | null;

  /**
   * SHA-256 con el que el servidor selló la imagen al recibirla, cuando el
   * módulo lo guarda (evidencia de convivencia). Mostrarlo es lo que permite
   * sostener después que la foto del expediente es la que llegó ese día.
   */
  @Field(() => String, { nullable: true })
  sealHash?: string | null;
}

@ObjectType({ description: 'Archivo adjunto del expediente (PDF, carné…)' })
export class NotificationSnapshotFile {
  @Field(() => String)
  url: string;

  @Field(() => String)
  label: string;
}

@ObjectType({
  description: 'Datos completos de lo que originó la notificación',
})
export class NotificationEntitySnapshot {
  @Field(() => String, { nullable: true })
  entityType?: string | null;

  @Field(() => String, { nullable: true })
  entityId?: string | null;

  /** Título corto de la cosa: "KODA · Golden retriever", "MAS-000012". */
  @Field(() => String, { nullable: true })
  headline?: string | null;

  /**
   * Estado de HOY, no el del momento del aviso. Es la diferencia entre
   * "solicitud pendiente" y "ya la aprobó otro administrador hace una hora".
   */
  @Field(() => String, { nullable: true })
  statusLabel?: string | null;

  /**
   * El mismo estado, pero en crudo ("PENDING_APPROVAL", "RESUELTO"…).
   *
   * `statusLabel` es para leer; esto es para decidir. Sin un valor estable, la
   * web tendría que comparar textos en español para saber si ofrecer "Aprobar",
   * y ese es el tipo de condición que se rompe el día que alguien mejora una
   * etiqueta.
   */
  @Field(() => String, { nullable: true })
  statusCode?: string | null;

  @Field(() => NotificationSnapshotTone)
  statusTone: NotificationSnapshotTone;

  @Field(() => [NotificationSnapshotSection])
  sections: NotificationSnapshotSection[];

  @Field(() => [NotificationSnapshotImage])
  images: NotificationSnapshotImage[];

  @Field(() => [NotificationSnapshotFile])
  files: NotificationSnapshotFile[];

  /**
   * Lo que se puede hacer desde aquí, según el estado de HOY y quien mira.
   * Vacío cuando no hay nada que hacer o cuando quien abre el aviso solo mira.
   */
  @Field(() => [NotificationSnapshotAction])
  actions: NotificationSnapshotAction[];

  @Field(() => NotificationSnapshotSource)
  source: NotificationSnapshotSource;

  /** La entidad ya no existe: lo que se muestra es histórico. */
  @Field(() => Boolean)
  isMissing: boolean;
}
