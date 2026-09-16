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
