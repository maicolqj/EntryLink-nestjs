import { RevokeInactiveAssignmentsCron } from './revoke-inactive-assignments.cron';
import { AssignmentStatus } from '../../users/entities/user-complex-assignment.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { SUPERVISOR_INACTIVITY_DAYS } from '../supervisor-visits.constants';

/**
 * El cron retira del complejo al supervisor que dejó de venir: lo movieron de
 * zona o ya no trabaja en la empresa de seguridad. La consulta vive en SQL;
 * aquí se prueba lo que la rodea: el corte que se le pasa, qué se actualiza y
 * a quién se le avisa.
 */
describe('RevokeInactiveAssignmentsCron', () => {
  const build = (
    rows: { id: string; user_id: string; complex_id: string }[],
  ) => {
    const query = jest.fn(() => Promise.resolve(rows));
    const assignmentRepo = {
      manager: { query },
      update: jest.fn(() => Promise.resolve({ affected: rows.length })),
    };
    const notificationsService = {
      notify: jest.fn(() => Promise.resolve(undefined)),
    };
    const cron = new RevokeInactiveAssignmentsCron(
      assignmentRepo as never,
      notificationsService as never,
    );
    return { cron, query, assignmentRepo, notificationsService };
  };

  it(`corta en ${SUPERVISOR_INACTIVITY_DAYS} días y solo mira supervisores activos`, async () => {
    const { cron, query } = build([]);
    const before = Date.now();

    await cron.run();

    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    const [role, status, cutoff] = params as [string, string, Date];
    expect(role).toBe(ValidRoles.SUPERVISOR_ROL);
    expect(status).toBe(AssignmentStatus.ACTIVE);
    const expected = before - SUPERVISOR_INACTIVITY_DAYS * 24 * 60 * 60 * 1000;
    // Un par de horas de margen por el cambio de día que hace setDate.
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(2 * 3_600_000);
  });

  it('retira las asignaciones vencidas y le avisa a cada supervisor', async () => {
    const { cron, assignmentRepo, notificationsService } = build([
      { id: 'a1', user_id: 'sup-1', complex_id: 'c1' },
      { id: 'a2', user_id: 'sup-2', complex_id: 'c2' },
    ]);

    await cron.run();

    expect(assignmentRepo.update).toHaveBeenCalledWith(
      { id: expect.anything() as unknown },
      expect.objectContaining({ status: AssignmentStatus.REMOVED }),
    );
    expect(notificationsService.notify).toHaveBeenCalledTimes(2);
    expect(notificationsService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['sup-1'], complexId: 'c1' }),
    );
  });

  it('sin vencidos no toca nada', async () => {
    const { cron, assignmentRepo, notificationsService } = build([]);

    await cron.run();

    expect(assignmentRepo.update).not.toHaveBeenCalled();
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });
});
