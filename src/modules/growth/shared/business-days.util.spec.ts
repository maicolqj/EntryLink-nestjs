import {
  addBusinessDays,
  colombianHolidays,
  isBusinessDay,
} from './business-days.util';

describe('días hábiles en Colombia', () => {
  it('festivos 2026 (calendario oficial)', () => {
    expect([...colombianHolidays(2026)].sort()).toEqual(
      [
        '2026-01-01',
        '2026-01-12', // Reyes (traslado)
        '2026-03-23', // San José (traslado)
        '2026-04-02', // Jueves Santo
        '2026-04-03', // Viernes Santo
        '2026-05-01',
        '2026-05-18', // Ascensión
        '2026-06-08', // Corpus Christi
        '2026-06-15', // Sagrado Corazón
        '2026-06-29', // San Pedro y San Pablo
        '2026-07-20',
        '2026-08-07',
        '2026-08-17', // Asunción (traslado)
        '2026-10-12', // Día de la Raza
        '2026-11-02', // Todos los Santos (traslado)
        '2026-11-16', // Independencia de Cartagena (traslado)
        '2026-12-08',
        '2026-12-25',
      ].sort(),
    );
  });

  it('fines de semana y festivos no son hábiles', () => {
    expect(isBusinessDay(new Date('2026-10-31T00:00:00Z'))).toBe(false); // sábado
    expect(isBusinessDay(new Date('2026-11-02T00:00:00Z'))).toBe(false); // festivo
    expect(isBusinessDay(new Date('2026-11-03T00:00:00Z'))).toBe(true);
  });

  it('10 días hábiles desde el viernes 30-oct-2026 saltan festivos', () => {
    // Recibida el viernes 30 de octubre a las 3 p. m. de Bogotá.
    const due = addBusinessDays(new Date('2026-10-30T20:00:00Z'), 10);
    // Hábiles: 3,4,5,6,9,10,11,12,13,17 (el 2 y el 16 son festivos).
    expect(due.toISOString()).toBe('2026-11-18T04:59:59.999Z'); // fin del 17 en Bogotá
  });

  it('usa la fecha de Bogotá aunque en UTC ya sea el día siguiente', () => {
    // Jueves 29-oct a las 9 p. m. en Bogotá = viernes 30 en UTC.
    const due = addBusinessDays(new Date('2026-10-30T02:00:00Z'), 1);
    expect(due.toISOString()).toBe('2026-10-31T04:59:59.999Z'); // fin del viernes 30
  });
});
