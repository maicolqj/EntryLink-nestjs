import { stripAccents } from '../../prospects/shared/prospect-normalizers';
import {
  GrowthImportField as F,
  GrowthImportTarget as T,
} from '../imports.enums';

export interface ImportFieldDefinition {
  field: F;
  label: string;
  required: boolean;
  /** Encabezados que se reconocen para sugerir el mapeo (ya normalizados). */
  synonyms: string[];
}

const def = (
  field: F,
  label: string,
  synonyms: string[],
  required = false,
): ImportFieldDefinition => ({
  field,
  label,
  required,
  synonyms: [field, label, ...synonyms].map(normalizeHeader),
});

const ADDRESS = def(F.ADDRESS, 'Dirección', [
  'direccion',
  'dir',
  'address',
  'domicilio',
]);
const CITY = def(F.CITY, 'Ciudad', ['city', 'municipio']);
const LOCALITY = def(F.LOCALITY, 'Localidad', ['locality', 'localidad bogota']);
const NIT = def(F.NIT, 'NIT', [
  'nit',
  'nit empresa',
  'numero nit',
  'identificacion tributaria',
]);
const EMAIL = def(F.EMAIL, 'Correo', [
  'email',
  'e-mail',
  'correo electronico',
  'mail',
]);
const PHONE = def(F.PHONE, 'Teléfono', [
  'telefono',
  'tel',
  'celular',
  'movil',
  'phone',
  'whatsapp',
]);

export const IMPORT_FIELDS: Record<T, ImportFieldDefinition[]> = {
  [T.ORGANIZATIONS]: [
    def(
      F.LEGAL_NAME,
      'Razón social',
      ['razon social', 'empresa', 'nombre empresa', 'nombre', 'administradora'],
      true,
    ),
    def(F.TRADE_NAME, 'Nombre comercial', ['nombre comercial', 'marca']),
    NIT,
    def(F.WEBSITE, 'Sitio web', [
      'web',
      'pagina web',
      'sitio',
      'website',
      'url',
    ]),
    ADDRESS,
    CITY,
    LOCALITY,
    def(F.ESTIMATED_PROPERTIES, 'Copropiedades estimadas', [
      'copropiedades',
      'numero de copropiedades',
      'conjuntos',
      'propiedades',
    ]),
    def(F.ESTIMATED_UNITS, 'Unidades estimadas', [
      'unidades',
      'numero de unidades',
    ]),
    EMAIL,
    PHONE,
  ],
  [T.PROPERTIES]: [
    def(
      F.NAME,
      'Nombre',
      [
        'nombre',
        'copropiedad',
        'conjunto',
        'edificio',
        'nombre copropiedad',
        'nombre conjunto',
      ],
      true,
    ),
    def(F.PH_TYPE, 'Tipo de PH', [
      'tipo ph',
      'tipo propiedad horizontal',
      'uso',
    ]),
    def(F.BUILDING_KIND, 'Tipo de inmueble', [
      'tipo inmueble',
      'tipo',
      'tipologia',
    ]),
    ADDRESS,
    CITY,
    LOCALITY,
    def(F.NEIGHBORHOOD, 'Barrio', ['barrio', 'sector']),
    def(F.ESTIMATED_UNITS, 'Unidades', [
      'unidades',
      'numero de unidades',
      'apartamentos',
      'casas',
      'unidades estimadas',
    ]),
    def(F.REAL_ESTATE_REGISTRATION, 'Matrícula inmobiliaria', [
      'matricula',
      'matricula inmobiliaria',
      'folio',
    ]),
    NIT,
  ],
  [T.PEOPLE]: [
    def(
      F.FULL_NAME,
      'Nombre completo',
      ['nombre', 'nombres', 'nombre completo', 'administrador', 'contacto'],
      true,
    ),
    def(F.IS_INDEPENDENT_ADMIN, 'Administrador independiente', [
      'independiente',
      'administrador independiente',
      'es independiente',
    ]),
    EMAIL,
    PHONE,
  ],
};

export function normalizeHeader(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Sugerencia de mapeo por encabezado. Cada campo se asigna a lo sumo a una
 * columna (la primera que lo reconoce) y cada columna a lo sumo a un campo.
 */
export function suggestMapping(
  target: T,
  headers: string[],
): Array<{ column: number; field: F }> {
  const used = new Set<F>();
  const out: Array<{ column: number; field: F }> = [];
  headers.forEach((header, column) => {
    const h = normalizeHeader(header);
    const match = IMPORT_FIELDS[target].find(
      (d) => !used.has(d.field) && d.synonyms.includes(h),
    );
    if (match) {
      used.add(match.field);
      out.push({ column, field: match.field });
    }
  });
  return out;
}

/** Errores de un mapeo: campos repetidos, columnas fuera de rango, campos ajenos al destino u obligatorios sin columna. */
export function mappingProblems(
  target: T,
  headerCount: number,
  mapping: Array<{ column: number; field: F }>,
): string[] {
  const problems: string[] = [];
  const allowed = new Set(IMPORT_FIELDS[target].map((d) => d.field));
  const fields = new Set<F>();
  const columns = new Set<number>();
  for (const m of mapping) {
    if (
      !Number.isInteger(m.column) ||
      m.column < 0 ||
      m.column >= headerCount
    ) {
      problems.push(`La columna ${m.column + 1} no existe`);
    }
    if (!allowed.has(m.field))
      problems.push(`El campo ${m.field} no aplica a este destino`);
    if (fields.has(m.field))
      problems.push(`El campo ${m.field} está en dos columnas`);
    if (columns.has(m.column))
      problems.push(`La columna ${m.column + 1} está asignada dos veces`);
    fields.add(m.field);
    columns.add(m.column);
  }
  for (const d of IMPORT_FIELDS[target]) {
    if (d.required && !fields.has(d.field)) {
      problems.push(`Falta asignar el campo obligatorio "${d.label}"`);
    }
  }
  return problems;
}
