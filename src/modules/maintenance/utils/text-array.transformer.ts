/**
 * Postgres devuelve `text[]` como texto crudo (`{a,b}`) según por dónde entre
 * la consulta, y TypeORM no lo normaliza. El mismo transformer está en
 * `PetIncident` y en `Note`; aquí vive suelto porque el módulo lo usa en tres
 * entidades y copiarlo tres veces más era pedir que una se quedara atrás.
 */
export const textArrayTransformer = {
  to: (value: string[] | null | undefined): string[] => value ?? [],
  from: (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') {
      const stripped = value.replace(/^\{|\}$/g, '');
      if (!stripped) return [];
      return stripped
        .split(',')
        .map((item) => item.replace(/^"|"$/g, '').trim())
        .filter(Boolean);
    }
    return [];
  },
};

/** `numeric` sale de Postgres como string: sin esto el front suma cadenas. */
export const numericTransformer = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};
