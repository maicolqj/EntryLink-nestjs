import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
import {
  ComplexModuleGuard,
  REQUIRED_MODULE_KEY,
} from '../guards/complex-module.guard';

/**
 * Exige que el complejo tenga encendido el módulo para atender la operación.
 *
 * Va sobre la CLASE del resolver o del controlador —una línea por módulo— y no
 * sobre cada método: el interruptor es del módulo entero, y repetirlo cuarenta
 * veces solo garantiza que algún día se olvide en el método nuevo.
 *
 * No reemplaza a `@Auth`: rol y permiso siguen decidiendo QUIÉN entra, esto
 * decide si el conjunto contrató la función.
 */
/**
 * Con varios módulos basta con que el conjunto tenga encendido UNO: es para las
 * APIs que atienden a dos interruptores, como clasificados y el directorio de
 * servicios.
 */
export function RequireModule(module: ComplexModule | ComplexModule[]) {
  return applyDecorators(
    SetMetadata(REQUIRED_MODULE_KEY, module),
    UseGuards(ComplexModuleGuard),
  );
}
