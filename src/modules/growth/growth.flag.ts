/**
 * La suite solo se registra con GROWTH_ENABLED=true explícito.
 *
 * No se usa `ConditionalModule.registerWhen(mod, 'GROWTH_ENABLED')` con el
 * nombre de la variable: esa forma registra el módulo cuando la variable NO
 * existe (`undefined !== 'false'`), justo lo contrario de "apagada por
 * defecto".
 */
export function isGrowthEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.GROWTH_ENABLED?.trim().toLowerCase() === 'true';
}
