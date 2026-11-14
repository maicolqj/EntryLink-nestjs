import { SetMetadata } from '@nestjs/common';

import { PANIC_TRIGGER_KEY } from '../guards/subscription.guard';

/**
 * Marca la operación que dispara una alerta de pánico nueva. Es la única que
 * se apaga con el corte del pánico: una alerta ya abierta se sigue atendiendo.
 */
export const PanicTrigger = () => SetMetadata(PANIC_TRIGGER_KEY, true);
