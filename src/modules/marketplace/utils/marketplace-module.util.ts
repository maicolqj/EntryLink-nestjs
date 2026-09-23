import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import type { MarketplaceSettings } from '../entities/marketplace-settings.entity';

/**
 * ¿El complejo tiene encendido al menos uno de los dos tableros?
 *
 * Clasificados (`CLASIFICADOS`) y el directorio de servicios (`SERVICIOS`)
 * comparten módulo backend, pero cada conjunto los enciende por separado: hay
 * conjuntos que quieren el directorio de oficios y no la venta entre vecinos.
 *
 * Misma regla que el resto del sistema: lista nula o vacía significa "todos los
 * módulos". La fuente de verdad es `enabledModules`, lo único que el SUPER_ADMIN
 * mueve desde la ficha del complejo; un segundo interruptor propio solo se
 * justifica si alguien puede moverlo (ver `pets-module.util.ts`).
 */
export function isMarketplaceModuleEnabled(complex: {
  enabledModules?: string[] | null;
}): boolean {
  return (
    isComplexModuleOn(complex, ComplexModule.CLASIFICADOS) ||
    isComplexModuleOn(complex, ComplexModule.SERVICIOS)
  );
}

/**
 * El interruptor que gobierna un tipo de aviso: los servicios viven en el
 * directorio, todo lo demás —vender, arrendar, regalar, buscar— en clasificados.
 */
export function moduleForListingType(
  type: MarketplaceListingType,
): ComplexModule {
  return type === MarketplaceListingType.SERVICE
    ? ComplexModule.SERVICIOS
    : ComplexModule.CLASIFICADOS;
}

/** ¿El conjunto admite este tipo de aviso? */
export function isListingTypeEnabled(
  complex: { enabledModules?: string[] | null },
  type: MarketplaceListingType,
): boolean {
  return isComplexModuleOn(complex, moduleForListingType(type));
}

/** Los tipos de aviso que el conjunto admite hoy. */
export function enabledListingTypes(complex: {
  enabledModules?: string[] | null;
}): MarketplaceListingType[] {
  return Object.values(MarketplaceListingType).filter((type) =>
    isListingTypeEnabled(complex, type),
  );
}

/**
 * Cuántos días dura publicado un aviso de este tipo.
 *
 * El servicio tiene su propia vigencia: el vecino que arregla lavadoras sigue
 * ahí el mes siguiente, y obligarlo a renovar cada 30 días como si fuera un
 * sofá usado vacía el directorio. La caducidad se conserva —un oficio
 * abandonado tampoco debe quedarse para siempre—, solo que más larga.
 */
export function listingDurationFor(
  type: MarketplaceListingType,
  settings: Pick<
    MarketplaceSettings,
    'listingDurationDays' | 'serviceListingDurationDays'
  >,
): number {
  return type === MarketplaceListingType.SERVICE
    ? settings.serviceListingDurationDays
    : settings.listingDurationDays;
}

function isComplexModuleOn(
  complex: { enabledModules?: string[] | null },
  module: ComplexModule,
): boolean {
  const modules = complex?.enabledModules;
  return !modules || modules.length === 0 || modules.includes(module);
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
