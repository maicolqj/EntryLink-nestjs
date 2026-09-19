import { RevokeInactiveAssignmentsCron } from './revoke-inactive-assignments.cron';
import { AssignmentStatus } from '../../users/entities/user-complex-assignment.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * El cron retira del complejo al supervisor que dejó de venir: lo movieron de
 * zona o ya no trabaja en la empresa de seguridad. El plazo es de cada
 * complejo y el corte se calcula en SQL; aquí se prueba lo que la rodea: con
 * qué plazo compara, qué se actualiza y qué se le avisa a cada supervisor.
 */
describe('RevokeInactiveAssignmentsCron', () => {
  type Row = {
    id: string;
    user_id: string;
    complex_id: string;
    inactivity_days: number;
  };

  const build = (rows: Row[]) => {
    const query = jest.fn<Promise<Row[]>, [string, unknown[]]>(() =>
      Promise.resolve(rows),
    );
    const assignmentRepo = {
      manager: { query },
      update: jest.fn(() => Promise.resolve({ affected: rows.length })),
    };
    const notificationsService = {
      notify: jest.fn<Promise<void>, [{ body: string }]>(() =>
        Promise.resolve(),
      ),
    };
    const cron = new RevokeInactiveAssignmentsCron(
      assignmentRepo as never,
      notificationsService as never,
    );
    return { cron, query, assignmentRepo, notificationsService };
  };

  it('compara con el plazo de cada complejo y solo mira supervisores activos', async () => {
    const { cron, query } = build([]);

    await cron.run();

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([
      ValidRoles.SUPERVISOR_ROL,
      AssignmentStatus.ACTIVE,
    ]);
    // Ningún plazo fijo: el corte sale de la columna del complejo.
    expect(sql).toContain(
      'make_interval(days => c.supervisor_inactivity_days)',
    );
  });

  it('retira las asignaciones vencidas y le avisa a cada supervisor con su plazo', async () => {
    const { cron, assignmentRepo, notificationsService } = build([
      { id: 'a1', user_id: 'sup-1', complex_id: 'c1', inactivity_days: 15 },
      { id: 'a2', user_id: 'sup-2', complex_id: 'c2', inactivity_days: 45 },
    ]);

    await cron.run();

    expect(assignmentRepo.update).toHaveBeenCalledWith(
      { id: expect.anything() as unknown },
      expect.objectContaining({ status: AssignmentStatus.REMOVED }),
    );
    expect(notificationsService.notify).toHaveBeenCalledTimes(2);
    const [first] = notificationsService.notify.mock.calls[0];
    expect(first).toMatchObject({ userIds: ['sup-1'], complexId: 'c1' });
    expect(first.body).toContain('15 días');
    const [second] = notificationsService.notify.mock.calls[1];
    expect(second.body).toContain('45 días');
  });

  it('sin vencidos no toca nada', async () => {
    const { cron, assignmentRepo, notificationsService } = build([]);

    await cron.run();

    expect(assignmentRepo.update).not.toHaveBeenCalled();
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });
});
