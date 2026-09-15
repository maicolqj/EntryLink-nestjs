import {
  NotificationEntitySnapshot,
  NotificationFieldKind,
  NotificationSnapshotField,
  NotificationSnapshotFile,
  NotificationSnapshotImage,
  NotificationSnapshotSection,
  NotificationSnapshotSource,
  NotificationSnapshotTone,
} from '../dto/responses/notification-snapshot.response';
import {
  NotificationActionField,
  NotificationActionFieldKind,
  NotificationActionOption,
  NotificationActionTone,
  NotificationSnapshotAction,
} from '../dto/responses/notification-action.response';

/**
 * Herramientas para armar un expediente sin repetir el mismo `if` en cada
 * módulo. Lo que importa aquí: un campo vacío NO se muestra. Una ficha con diez
 * renglones en blanco se lee peor que una con tres llenos, y quien mira termina
 * sin ver lo único que importaba.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;
const IMAGE_RE = /\.(jpe?g|png|webp|gif|heic|avif)(\?|$)/i;
const FILE_RE = /\.(pdf|docx?|xlsx?|csv)(\?|$)/i;
const URL_RE = /^https?:\/\//i;

export const isImageUrl = (value: unknown): boolean =>
  typeof value === 'string' && URL_RE.test(value) && IMAGE_RE.test(value);

export const isFileUrl = (value: unknown): boolean =>
  typeof value === 'string' && URL_RE.test(value) && FILE_RE.test(value);

/** Un identificador no le dice nada a quien lee; solo ensucia la pantalla. */
export const isTechnicalKey = (key: string, value: unknown): boolean =>
  key === 'id' ||
  key.endsWith('Id') ||
  key.endsWith('_id') ||
  UUID_RE.test(String(value));

/** Campo con valor: si viene vacío devuelve null y el llamador lo descarta. */
export function field(
  label: string,
  value: unknown,
  kind: NotificationFieldKind = NotificationFieldKind.TEXT,
  href?: string | null,
): NotificationSnapshotField | null {
  if (value === null || value === undefined || value === '') return null;

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'boolean'
        ? value
          ? 'Sí'
          : 'No'
        : String(value).trim();

  if (!text) return null;

  return { label, value: text, kind, href: href ?? null };
}

/** Sección sin campos con valor no se devuelve: no hay nada que leer en ella. */
export function section(
  title: string | null,
  fields: (NotificationSnapshotField | null)[],
): NotificationSnapshotSection | null {
  const kept = fields.filter((f): f is NotificationSnapshotField => !!f);
  if (kept.length === 0) return null;
  return { title, fields: kept };
}

export function image(
  url: unknown,
  caption?: string | null,
  sealHash?: string | null,
): NotificationSnapshotImage | null {
  if (typeof url !== 'string' || !URL_RE.test(url)) return null;
  return { url, caption: caption ?? null, sealHash: sealHash ?? null };
}

export function file(
  url: unknown,
  label: string,
): NotificationSnapshotFile | null {
  if (typeof url !== 'string' || !URL_RE.test(url)) return null;
  return { url, label };
}

/** Un dato que la acción pide antes de ejecutarse. */
export function actionField(params: {
  name: string;
  label: string;
  kind?: NotificationActionFieldKind;
  required?: boolean;
  helpText?: string | null;
  placeholder?: string | null;
  defaultValue?: unknown;
  defaultLabel?: string | null;
  options?: NotificationActionOption[] | null;
  minLength?: number | null;
  min?: number | null;
  max?: number | null;
}): NotificationActionField {
  return {
    name: params.name,
    label: params.label,
    kind: params.kind ?? NotificationActionFieldKind.TEXT,
    required: params.required ?? false,
    helpText: params.helpText ?? null,
    placeholder: params.placeholder ?? null,
    defaultValue:
      params.defaultValue === null || params.defaultValue === undefined
        ? null
        : String(params.defaultValue),
    defaultLabel: params.defaultLabel ?? null,
    options: params.options ?? null,
    minLength: params.minLength ?? null,
    min: params.min ?? null,
    max: params.max ?? null,
  };
}

/**
 * Una acción del expediente.
 *
 * `isEnabled` por defecto es `true` y `disabledReason` es lo que la apaga: una
 * acción deshabilitada sin explicación deja al administrador adivinando por qué
 * no puede hacer lo que la pantalla le está mostrando.
 */
export function action(params: {
  code: string;
  label: string;
  description?: string | null;
  tone?: NotificationActionTone;
  disabledReason?: string | null;
  confirmText?: string | null;
  fields?: (NotificationActionField | null)[];
}): NotificationSnapshotAction {
  return {
    code: params.code,
    label: params.label,
    description: params.description ?? null,
    tone: params.tone ?? NotificationActionTone.NEUTRAL,
    isEnabled: !params.disabledReason,
    disabledReason: params.disabledReason ?? null,
    confirmText: params.confirmText ?? null,
    fields: (params.fields ?? []).filter(
      (f): f is NotificationActionField => !!f,
    ),
  };
}

/** Arma el expediente descartando de una vez lo vacío. */
export function snapshot(params: {
  entityType?: string | null;
  entityId?: string | null;
  headline?: string | null;
  statusLabel?: string | null;
  statusCode?: string | null;
  statusTone?: NotificationSnapshotTone;
  sections: (NotificationSnapshotSection | null)[];
  images?: (NotificationSnapshotImage | null)[];
  files?: (NotificationSnapshotFile | null)[];
  actions?: (NotificationSnapshotAction | null)[];
  source?: NotificationSnapshotSource;
  isMissing?: boolean;
}): NotificationEntitySnapshot {
  return {
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    headline: params.headline ?? null,
    statusLabel: params.statusLabel ?? null,
    statusCode: params.statusCode ?? null,
    statusTone: params.statusTone ?? NotificationSnapshotTone.NEUTRAL,
    sections: params.sections.filter(
      (s): s is NotificationSnapshotSection => !!s,
    ),
    images: (params.images ?? []).filter(
      (i): i is NotificationSnapshotImage => !!i,
    ),
    files: (params.files ?? []).filter(
      (f): f is NotificationSnapshotFile => !!f,
    ),
    actions: (params.actions ?? []).filter(
      (a): a is NotificationSnapshotAction => !!a,
    ),
    source: params.source ?? NotificationSnapshotSource.LIVE,
    isMissing: params.isMissing ?? false,
  };
}

/**
 * Nombre en palabras de las claves que los módulos escriben en `metadata`.
 *
 * `metadata` se escribió para que la app pudiera ABRIR el recurso al tocar la
 * notificación, no para leerla. Sin traducir, al administrador le quedaba
 * "amenityName" y "startAt" en pantalla. Vive en el servidor y no en la web
 * porque el mismo aviso se lee también desde la app y desde el correo.
 */
export const METADATA_LABELS: Record<string, string> = {
  amount: 'Valor',
  amenityName: 'Zona común',
  buildingName: 'Torre',
  floorLabel: 'Piso',
  locationReference: 'Referencia',
  reportedBy: 'Reportó',
  site: 'Sitio',
  tagName: 'Punto señalizado',
  bookingDate: 'Fecha de la reserva',
  brand: 'Marca',
  color: 'Color',
  complexName: 'Complejo',
  description: 'Descripción',
  dueDate: 'Vence',
  endAt: 'Hasta',
  fineAmount: 'Multa',
  guestCount: 'Acompañantes',
  model: 'Modelo',
  occurredAt: 'Ocurrió',
  packageCode: 'Guía',
  period: 'Período',
  petName: 'Mascota',
  plate: 'Placa',
  reason: 'Motivo',
  rejectionReason: 'Motivo del rechazo',
  requestLat: 'Latitud',
  requestLng: 'Longitud',
  residentName: 'Residente',
  resolvedAt: 'Resuelta',
  startAt: 'Desde',
  status: 'Estado',
  supervisorName: 'Supervisor',
  unitNumber: 'Unidad',
  visitorName: 'Visitante',
};

/** "arrivalDate" → "Arrival date" para lo que nadie tradujo todavía. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const MONEY_KEYS = /(amount|valor|total|saldo|fine|price|monto)/i;

export function kindForValue(
  key: string,
  value: unknown,
): NotificationFieldKind {
  if (MONEY_KEYS.test(key) && !Number.isNaN(Number(value))) {
    return NotificationFieldKind.MONEY;
  }
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
    return NotificationFieldKind.DATE;
  }
  if (value instanceof Date) return NotificationFieldKind.DATE;
  if (typeof value === 'string' && URL_RE.test(value)) {
    return NotificationFieldKind.LINK;
  }
  return NotificationFieldKind.TEXT;
}

/**
 * "Torre A · 101" con lo que haya.
 *
 * La unidad guarda el apartamento en `number` y la torre en la relación
 * `building`: sin la torre, un "101" no identifica nada en un conjunto con seis
 * edificios.
 */
export function unitLabel(
  unit?: {
    number?: string;
    building?: { name?: string } | null;
  } | null,
): string | null {
  if (!unit) return null;
  return [unit.building?.name, unit.number].filter(Boolean).join(' · ') || null;
}
