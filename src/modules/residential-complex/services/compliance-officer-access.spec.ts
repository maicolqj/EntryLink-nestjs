import { ResidentialComplexService } from './residential-complex.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationActionErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * El oficial de cumplimiento revisa todos los conjuntos (lectura) pero no los
 * opera: no ejecuta las acciones de los avisos (aprobar, sancionar…).
 */
const compliance = {
  sub: 'officer-1',
  email: 'cumplimiento@x.co',
  roles: ['COMPILANCE_OFFICER_ROL', 'RESIDENT_ROL'],
};

describe('Oficial de cumplimiento', () => {
  it('pasa el control de acceso de cualquier conjunto', async () => {
    const service = Object.create(
      ResidentialComplexService.prototype,
    ) as ResidentialComplexService;

    await expect(
      service.assertAccess(
        { id: 'otro-conjunto', ownerId: 'alguien' } as never,
        compliance as never,
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.assertComplexAccess('otro-conjunto', compliance as never),
    ).resolves.toBeUndefined();
  });

  it('no ejecuta acciones de los avisos', async () => {
    const service = Object.create(
      NotificationsService.prototype,
    ) as NotificationsService;
    const findOneForUser = jest.fn();
    Object.assign(service, { findOneForUser });

    await expect(
      service.executeEntityAction(
        { notificationId: 'n1', actionCode: 'APPROVE' },
        compliance as never,
      ),
    ).rejects.toMatchObject({
      errorCode: NotificationActionErrorCode.NOTIFICATION_ACTION_UNAVAILABLE,
    });
    expect(findOneForUser).not.toHaveBeenCalled();
  });
});
