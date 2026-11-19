import { registerEnumType } from '@nestjs/graphql';

/** De qué se trata el comunicado. Solo cambia la etiqueta que ve quien lo lee. */
export enum AnnouncementCategory {
  INFORMATIVE = 'INFORMATIVE',
  PROMOTION = 'PROMOTION',
  NEWS = 'NEWS',
  OTHER = 'OTHER',
}

registerEnumType(AnnouncementCategory, {
  name: 'AnnouncementCategory',
  description: 'Tipo de comunicado de la plataforma',
  valuesMap: {
    INFORMATIVE: { description: 'Informativo' },
    PROMOTION: { description: 'Promoción' },
    NEWS: { description: 'Noticia' },
    OTHER: { description: 'Otro' },
  },
});

/** Quién lo recibe dentro de cada conjunto. Lo elige quien envía. */
export enum AnnouncementAudience {
  /** La cuenta del complejo (COMPLEX_ROL), en el panel web. */
  ADMINISTRATION = 'ADMINISTRATION',
  /** Los residentes activos, en RemoteLink. */
  RESIDENTS = 'RESIDENTS',
  ALL = 'ALL',
}

registerEnumType(AnnouncementAudience, {
  name: 'AnnouncementAudience',
  description: 'Destinatarios del comunicado dentro de cada conjunto',
  valuesMap: {
    ADMINISTRATION: { description: 'Solo la administración del conjunto' },
    RESIDENTS: { description: 'Solo los residentes activos' },
    ALL: { description: 'Administración y residentes' },
  },
});

/** Cómo se eligen los conjuntos destino. */
export enum AnnouncementTargetMode {
  ALL_COMPLEXES = 'ALL_COMPLEXES',
  SELECTED = 'SELECTED',
  FILTERED = 'FILTERED',
}

registerEnumType(AnnouncementTargetMode, {
  name: 'AnnouncementTargetMode',
  description: 'Cómo se eligen los conjuntos que reciben el comunicado',
  valuesMap: {
    ALL_COMPLEXES: { description: 'Todos los conjuntos aprobados' },
    SELECTED: { description: 'Los conjuntos elegidos uno a uno' },
    FILTERED: {
      description: 'Los conjuntos que cumplen plan/estado/vinculación',
    },
  },
});

/**
 * Por dónde sale el comunicado. Se puede elegir uno o los dos.
 *
 * - NOTIFICATION: aviso en la bandeja del panel/app + push, según la audiencia.
 * - EMAIL: correo al email registrado del conjunto (el administrativo), con
 *   los adjuntos. La audiencia no aplica: el conjunto tiene un solo correo.
 */
export enum AnnouncementChannel {
  NOTIFICATION = 'NOTIFICATION',
  EMAIL = 'EMAIL',
}

registerEnumType(AnnouncementChannel, {
  name: 'AnnouncementChannel',
  description: 'Canal por el que sale el comunicado',
  valuesMap: {
    NOTIFICATION: { description: 'Aviso en el panel/app y push' },
    EMAIL: { description: 'Correo al email registrado del conjunto' },
  },
});

/**
 * El reparto corre después de responder: con residentes pueden ser miles de
 * avisos y la web no debería esperar a que salgan todos.
 */
export enum AnnouncementStatus {
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

registerEnumType(AnnouncementStatus, {
  name: 'AnnouncementStatus',
  description: 'Estado del reparto del comunicado',
});

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<
  AnnouncementCategory,
  string
> = {
  [AnnouncementCategory.INFORMATIVE]: 'Informativo',
  [AnnouncementCategory.PROMOTION]: 'Promoción',
  [AnnouncementCategory.NEWS]: 'Noticia',
  [AnnouncementCategory.OTHER]: 'Comunicado',
};

/**
 * Carpetas del historial, como en el correo. Destacados y archivados son de
 * cada quien; la papelera es de todo el equipo (el comunicado es uno solo).
 */
export enum AnnouncementFolder {
  /** Todo lo enviado que no está archivado ni en la papelera. */
  SENT = 'SENT',
  STARRED = 'STARRED',
  ARCHIVED = 'ARCHIVED',
  TRASH = 'TRASH',
}

registerEnumType(AnnouncementFolder, {
  name: 'AnnouncementFolder',
  description: 'Carpeta del historial de comunicados',
  valuesMap: {
    SENT: { description: 'Enviados (sin archivados ni borrados)' },
    STARRED: { description: 'Destacados por quien consulta' },
    ARCHIVED: { description: 'Archivados por quien consulta' },
    TRASH: { description: 'Papelera: se eliminan solos a los 30 días' },
  },
});
