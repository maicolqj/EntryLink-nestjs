import { normalizeSlots } from './schedule-slots';

const slot = (dayOfWeek: number, openTime: string, closeTime: string) => ({
  dayOfWeek,
  openTime,
  closeTime,
});

describe('normalizeSlots', () => {
  it('ordena por día y hora; mañana y tarde el mismo día no se cruzan', () => {
    const result = normalizeSlots([
      slot(1, '14:00', '17:00'),
      slot(0, '08:00', '12:00'),
      slot(1, '08:00', '12:00'),
    ]);
    expect(result).toEqual({
      slots: [
        slot(0, '08:00', '12:00'),
        slot(1, '08:00', '12:00'),
        slot(1, '14:00', '17:00'),
      ],
    });
  });

  it('acepta todo el día y una franja que cruza la medianoche', () => {
    expect('slots' in normalizeSlots([slot(2, '00:00', '23:59')])).toBe(true);
    expect('slots' in normalizeSlots([slot(5, '22:00', '06:00')])).toBe(true);
  });

  it('rechaza franjas que se cruzan', () => {
    expect(
      normalizeSlots([slot(1, '08:00', '12:00'), slot(1, '11:00', '14:00')]),
    ).toHaveProperty('error');
  });

  it('rechaza la que viene del día anterior pasada la medianoche', () => {
    // Viernes 22:00 – sábado 06:00 choca con el sábado desde las 05:00.
    expect(
      normalizeSlots([slot(5, '22:00', '06:00'), slot(6, '05:00', '09:00')]),
    ).toHaveProperty('error');
    // Sábado 22:00 – domingo 06:00 choca con el domingo desde las 05:00.
    expect(
      normalizeSlots([slot(6, '22:00', '06:00'), slot(0, '05:00', '09:00')]),
    ).toHaveProperty('error');
  });

  it('rechaza abrir y cerrar a la misma hora', () => {
    expect(normalizeSlots([slot(3, '08:00', '08:00')])).toHaveProperty('error');
  });
});
