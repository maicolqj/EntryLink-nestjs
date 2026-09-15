import {
  ObjectType,
  Field,
  Float,
  Int,
  registerEnumType,
} from '@nestjs/graphql';

/**
 * Lo que se puede HACER desde el aviso, declarado por el módulo dueño del
 * asunto.
 *
 * El expediente ya resolvió el "qué pasó"; esto resuelve el "y ahora qué".
 * Quien abre "Nuevo reporte de convivencia MAS-000001" necesita darle curso,
 * desestimarlo o sancionar ahí mismo: mandarlo a buscar el caso en otra
 * pantalla es la diferencia entre un trámite de diez segundos y uno que se
 * queda sin hacer.
 *
 * Las acciones las declara el SERVIDOR con la misma forma para todos los
 * módulos —código, etiqueta, si está habilitada y qué hay que preguntar antes—
 * y una sola mutation las ejecuta. Alternativa descartada: que la web arme los
 * botones mirando `entityType`. Eso es el `if` por tipo que ya se quitó del
 * modal, con el agravante de que aquí decide QUIÉN PUEDE SANCIONAR: una regla
 * de debido proceso escrita en la pantalla es una regla que se salta con la
 * consola del navegador abierta.
 *
 * Por eso los descriptores son una ayuda para pintar, NUNCA la autorización: el
 * servidor vuelve a evaluar la acción antes de ejecutarla.
 */

/** Qué se le pregunta al usuario antes de ejecutar. */
export enum NotificationActionFieldKind {
  TEXT = 'TEXT',
  TEXTAREA = 'TEXTAREA',
  NUMBER = 'NUMBER',
  MONEY = 'MONEY',
  DATE = 'DATE',
  BOOLEAN = 'BOOLEAN',
  /** Lista cerrada: las opciones vienen en `options`. */
  SELECT = 'SELECT',
  /**
   * Una unidad del complejo, sin `options`.
   *
   * Un conjunto tiene cientos de apartamentos: mandarlos todos en el expediente
   * es un payload enorme para elegir uno, y una lista de "101, 102, 103…" sin
   * torre no identifica nada. La web resuelve este campo con su buscador de
   * unidades, que consulta al servidor a medida que se escribe y muestra la
   * torre junto al número.
   */
  UNIT = 'UNIT',
}

registerEnumType(NotificationActionFieldKind, {
  name: 'NotificationActionFieldKind',
  description: 'Tipo de dato que pide una acción antes de ejecutarse',
});

/** Peso visual del botón. Lo decide quien conoce el trámite. */
export enum NotificationActionTone {
  /** La acción esperada del aviso: dar curso, aprobar, autorizar. */
  PRIMARY = 'PRIMARY',
  NEUTRAL = 'NEUTRAL',
  WARNING = 'WARNING',
  /** Irreversible o con consecuencia económica: multar, rechazar. */
  DANGER = 'DANGER',
}

registerEnumType(NotificationActionTone, {
  name: 'NotificationActionTone',
  description: 'Peso visual del botón de la acción',
});

@ObjectType({ description: 'Opción de una lista cerrada' })
export class NotificationActionOption {
  @Field(() => String)
  value: string;

  @Field(() => String)
  label: string;

  /** Segunda línea: "Torre A · 101", "Pendiente de validación". */
  @Field(() => String, { nullable: true })
  hint?: string | null;
}

@ObjectType({ description: 'Dato que la acción pide antes de ejecutarse' })
export class NotificationActionField {
  /** Nombre con el que viaja en `values`. */
  @Field(() => String)
  name: string;

  @Field(() => String)
  label: string;

  @Field(() => NotificationActionFieldKind)
  kind: NotificationActionFieldKind;

  @Field(() => Boolean)
  required: boolean;

  @Field(() => String, { nullable: true })
  helpText?: string | null;

  @Field(() => String, { nullable: true })
  placeholder?: string | null;

  /** Valor con el que se abre el formulario (la atribución que ya traía). */
  @Field(() => String, { nullable: true })
  defaultValue?: string | null;

  /**
   * Cómo se lee ese valor por defecto ("Torre A · 101").
   *
   * Un buscador prellenado con un UUID no le dice nada a quien mira; y pedirle
   * a la web que resuelva el nombre sería una consulta más para pintar algo que
   * el servidor ya tenía en la mano.
   */
  @Field(() => String, { nullable: true })
  defaultLabel?: string | null;

  @Field(() => [NotificationActionOption], { nullable: true })
  options?: NotificationActionOption[] | null;

  /**
   * Largo mínimo del texto. No es capricho de formulario: una sanción sin
   * motivar no se sostiene si la unidad la discute, y el servicio la rechaza
   * igual. Decirlo aquí evita que el administrador escriba "ok" y pierda el
   * trabajo contra un error del servidor.
   */
  @Field(() => Int, { nullable: true })
  minLength?: number | null;

  @Field(() => Float, { nullable: true })
  min?: number | null;

  @Field(() => Float, { nullable: true })
  max?: number | null;
}

@ObjectType({ description: 'Acción disponible sobre lo que originó el aviso' })
export class NotificationSnapshotAction {
  /** Código estable del módulo: `PET_INCIDENT_FINE`. Es lo que se ejecuta. */
  @Field(() => String)
  code: string;

  @Field(() => String)
  label: string;

  /** Qué va a pasar si se ejecuta, en una línea. */
  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => NotificationActionTone)
  tone: NotificationActionTone;

  /**
   * Se devuelve deshabilitada, no se esconde: que el administrador vea "Multar"
   * en gris con "los descargos vencen el 18/09" le explica el trámite. Un botón
   * ausente parece un error de la pantalla.
   */
  @Field(() => Boolean)
  isEnabled: boolean;

  @Field(() => String, { nullable: true })
  disabledReason?: string | null;

  /** Texto del "¿seguro?" cuando la acción no se puede deshacer. */
  @Field(() => String, { nullable: true })
  confirmText?: string | null;

  @Field(() => [NotificationActionField])
  fields: NotificationActionField[];
}
