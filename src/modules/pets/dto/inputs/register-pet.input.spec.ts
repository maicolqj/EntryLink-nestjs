import { plainToInstance } from 'class-transformer';

import { RegisterPetDto } from './register-pet.input';

/**
 * Los booleanos de la ficha llegan por multipart, es decir como TEXTO.
 *
 * Esto existe porque el bug real fue silencioso: una mascota registrada sin
 * marcar "raza de manejo especial" quedaba guardada como si lo fuera. Ni el
 * typecheck ni el validador lo ven —el tipo declarado es `boolean` y el valor
 * que llega es un `boolean`—, y la consecuencia no es cosmética: una raza de
 * manejo especial exige póliza de responsabilidad civil para poder aprobarse.
 *
 * La causa: el ValidationPipe global corre con `enableImplicitConversion: true`
 * (ver main.ts), así que class-transformer convierte la cadena antes que
 * cualquier @Transform, y esa conversión es un `Boolean("false")` → `true`.
 * Por eso el DTO lee el valor CRUDO del objeto original.
 *
 * Las opciones de abajo replican las del pipe: sin `enableImplicitConversion`
 * el test pasaría aunque el bug volviera.
 */
const parseAsPipeWould = (raw: Record<string, unknown>): RegisterPetDto =>
  plainToInstance(RegisterPetDto, raw, { enableImplicitConversion: true });

describe('RegisterPetDto — booleanos que llegan por multipart', () => {
  it('la cadena "false" NO marca la mascota como raza de manejo especial', () => {
    expect(parseAsPipeWould({ isSpecialBreed: 'false' }).isSpecialBreed).toBe(
      false,
    );
  });

  it('la cadena "true" sí la marca', () => {
    expect(parseAsPipeWould({ isSpecialBreed: 'true' }).isSpecialBreed).toBe(
      true,
    );
  });

  it('aplica lo mismo al microchip y a la esterilización', () => {
    const dto = parseAsPipeWould({
      hasMicrochip: 'false',
      sterilized: 'false',
    });

    expect(dto.hasMicrochip).toBe(false);
    expect(dto.sterilized).toBe(false);
  });

  it('un booleano de verdad pasa intacto', () => {
    expect(parseAsPipeWould({ isSpecialBreed: true }).isSpecialBreed).toBe(
      true,
    );
    expect(parseAsPipeWould({ isSpecialBreed: false }).isSpecialBreed).toBe(
      false,
    );
  });

  /** Omitido no es lo mismo que falso: el campo es opcional y debe quedar sin valor. */
  it('omitido queda undefined', () => {
    expect(
      parseAsPipeWould({ name: 'FIRULAIS' }).isSpecialBreed,
    ).toBeUndefined();
  });
});
