import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

/**
 * ¿El complejo tiene encendido el módulo de mascotas?
 *
 * La fuente de verdad es `enabledModules`, que es lo que la administración
 * prende y apaga desde la ficha del complejo. La regla —lista nula o vacía
 * significa "todos los módulos"— es la misma que usan finanzas y votaciones.
 *
 * Hubo aquí una columna propia `pets_enabled` que nacía en `false` y que
 * ninguna pantalla escribía: el residente recibía un 403 con el módulo
 * visiblemente activo en la web. Un segundo interruptor solo se justifica si
 * alguien puede moverlo.
 */
export function isPetsModuleEnabled(complex: {
  enabledModules?: string[] | null;
}): boolean {
  const modules = complex?.enabledModules;
  return (
    !modules || modules.length === 0 || modules.includes(ComplexModule.MASCOTAS)
  );
}

/**
 * Lee un booleano que pudo llegar como texto.
 *
 * En multipart TODO llega como cadena, y `"false"` es una cadena no vacía: para
 * JavaScript, verdadera. El bug no es teórico —una mascota registrada sin
 * marcar "raza de manejo especial" quedó guardada como si lo fuera— y no es
 * cosmético: esa marca exige póliza de responsabilidad civil para aprobar la
 * ficha.
 *
 * El DTO ya lo resuelve al entrar (`register-pet.input.ts`), pero la conversión
 * vive aquí para que el servicio pueda repetirla antes de persistir: quien
 * decide lo que queda en la base es el servicio, y no puede confiar en que
 * todos sus llamadores —REST hoy, lo que venga mañana— hayan pasado por el
 * mismo pipe.
 *
 * `undefined` se conserva: omitir el campo no es lo mismo que decir que no.
 */
export function readOptionalBoolean(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  const text = String(raw).trim().toLowerCase();
  return text === 'true' || text === '1';
}

/** Igual que `readOptionalBoolean`, pero con valor por defecto para columnas NOT NULL. */
export function readBoolean(raw: unknown, fallback = false): boolean {
  return readOptionalBoolean(raw) ?? fallback;
}
