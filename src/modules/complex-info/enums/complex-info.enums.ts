import { registerEnumType } from '@nestjs/graphql';

/**
 * De qué trata el documento. Ordena la pantalla "Mi Conjunto" por secciones;
 * el orden de este enum es el orden en que el residente las ve.
 */
export enum ComplexDocumentCategory {
  /** Manual de convivencia (Ley 675, art. 58). */
  COEXISTENCE_MANUAL = 'COEXISTENCE_MANUAL',
  /** Reglamento de propiedad horizontal. */
  BYLAWS = 'BYLAWS',
  /** Normas de uso de zonas comunes (piscina, gimnasio, salón social…). */
  COMMON_AREA_RULES = 'COMMON_AREA_RULES',
  /** Circulares y comunicados de la administración. */
  CIRCULARS = 'CIRCULARS',
  /** Actas de asamblea y de consejo. */
  ASSEMBLY_MINUTES = 'ASSEMBLY_MINUTES',
  /** Estados financieros, presupuesto e informes de gestión. */
  FINANCIAL_REPORTS = 'FINANCIAL_REPORTS',
  /** Pólizas de áreas comunes y certificados. */
  INSURANCE = 'INSURANCE',
  /** Formatos: trasteos, remodelaciones, autorizaciones. */
  FORMS = 'FORMS',
  OTHER = 'OTHER',
}

registerEnumType(ComplexDocumentCategory, {
  name: 'ComplexDocumentCategory',
  description: 'Categoría de un documento del conjunto',
  valuesMap: {
    COEXISTENCE_MANUAL: { description: 'Manual de convivencia' },
    BYLAWS: { description: 'Reglamento de propiedad horizontal' },
    COMMON_AREA_RULES: { description: 'Normas de zonas comunes' },
    CIRCULARS: { description: 'Circulares y comunicados' },
    ASSEMBLY_MINUTES: { description: 'Actas de asamblea y consejo' },
    FINANCIAL_REPORTS: { description: 'Estados financieros y presupuesto' },
    INSURANCE: { description: 'Pólizas y certificados' },
    FORMS: { description: 'Formatos y solicitudes' },
    OTHER: { description: 'Otros documentos' },
  },
});

/**
 * Quién lo puede leer. Los estados financieros o las actas pueden quedar solo
 * para propietarios, que son quienes tienen voz en la asamblea.
 */
export enum ComplexDocumentAudience {
  ALL_RESIDENTS = 'ALL_RESIDENTS',
  OWNERS_ONLY = 'OWNERS_ONLY',
}

registerEnumType(ComplexDocumentAudience, {
  name: 'ComplexDocumentAudience',
  description: 'Quién ve el documento en la app',
  valuesMap: {
    ALL_RESIDENTS: { description: 'Todos los residentes' },
    OWNERS_ONLY: { description: 'Solo propietarios' },
  },
});

/** Sección del directorio de contactos del conjunto. */
export enum ComplexContactCategory {
  ADMINISTRATION = 'ADMINISTRATION',
  SECURITY = 'SECURITY',
  COUNCIL = 'COUNCIL',
  MAINTENANCE = 'MAINTENANCE',
  EMERGENCY = 'EMERGENCY',
  SERVICE = 'SERVICE',
  OTHER = 'OTHER',
}

registerEnumType(ComplexContactCategory, {
  name: 'ComplexContactCategory',
  description: 'Sección del directorio de contactos del conjunto',
  valuesMap: {
    ADMINISTRATION: { description: 'Administración' },
    SECURITY: { description: 'Portería y seguridad' },
    COUNCIL: { description: 'Consejo de administración' },
    MAINTENANCE: { description: 'Mantenimiento' },
    EMERGENCY: { description: 'Emergencias' },
    SERVICE: { description: 'Servicios (aseo, jardinería, ascensores…)' },
    OTHER: { description: 'Otros' },
  },
});

/** Para qué es un horario del conjunto; define el ícono en la app. */
export enum ComplexScheduleCategory {
  ADMINISTRATION = 'ADMINISTRATION',
  SECURITY = 'SECURITY',
  WASTE = 'WASTE',
  RECYCLING = 'RECYCLING',
  COMMON_AREA = 'COMMON_AREA',
  SERVICE = 'SERVICE',
  OTHER = 'OTHER',
}

registerEnumType(ComplexScheduleCategory, {
  name: 'ComplexScheduleCategory',
  description: 'Para qué es un horario del conjunto',
  valuesMap: {
    ADMINISTRATION: { description: 'Atención de la administración' },
    SECURITY: { description: 'Portería y seguridad' },
    WASTE: { description: 'Shut y cuarto de basuras' },
    RECYCLING: { description: 'Reciclaje y recolección' },
    COMMON_AREA: { description: 'Zonas comunes (gimnasio, piscina…)' },
    SERVICE: { description: 'Servicios (aseo, mantenimiento…)' },
    OTHER: { description: 'Otros' },
  },
});
