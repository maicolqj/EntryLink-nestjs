import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

/**
 * ¿El complejo tiene encendidos los clasificados?
 *
 * Misma regla que el resto del sistema: lista nula o vacía significa "todos los
 * módulos". La fuente de verdad es `enabledModules`, lo único que el SUPER_ADMIN
 * mueve desde la ficha del complejo; un segundo interruptor propio solo se
 * justifica si alguien puede moverlo (ver `pets-module.util.ts`).
 */
export function isMarketplaceModuleEnabled(complex: {
  enabledModules?: string[] | null;
}): boolean {
  const modules = complex?.enabledModules;
  return (
    !modules ||
    modules.length === 0 ||
    modules.includes(ComplexModule.CLASIFICADOS)
  );
}

/**
 * Lee un booleano que pudo llegar como texto.
 *
 * El alta de una publicación entra por multipart —lleva fotos— y ahí TODO llega
 * como cadena: `"false"` es una cadena no vacía y, para JavaScript, verdadera.
 * Sin esto, quien publica sin marcar "mostrar mi teléfono" terminaría con su
 * número a la vista de todo el conjunto, que es exactamente lo que el
 * consentimiento explícito pretende evitar.
 *
 * La misma conversión está en `pets-module.util.ts`. Vive duplicada y no
 * compartida a propósito: son cuatro líneas, y un helper común en `shared`
 * obligaría a los dos módulos a moverse juntos para siempre.
 *
 * `undefined` se conserva: omitir el campo no es lo mismo que decir que no.
 */
export function readOptionalBoolean(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  // Solo se interpreta lo que llega como texto: un objeto no es un booleano
  // disfrazado, y convertirlo daría "[object Object]" —verdadero para
  // cualquier comparación laxa—.
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().toLowerCase();
  return text === 'true' || text === '1';
}

/** Igual que `readOptionalBoolean`, pero con valor por defecto. */
export function readBoolean(raw: unknown, fallback = false): boolean {
  return readOptionalBoolean(raw) ?? fallback;
}

/**
 * Convierte el nombre de una categoría en su identificador estable.
 *
 * Sin tildes, sin eñes y sin espacios: el slug se compara contra el índice
 * único al sembrar, y "Tecnología" y "Tecnologia" tienen que ser la misma
 * categoría o el conjunto termina con las dos en la vitrina.
 */
export function slugifyCategory(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
