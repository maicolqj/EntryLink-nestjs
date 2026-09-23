import {
  NOTIFICATION_AUDIENCE,
  RESIDENT_VISIBLE_AUDIENCES,
  audienceOf,
} from './notification-audience.map';
import { NotificationAudience } from '../enums/notification-audience.enum';
import { NotificationType } from '../enums/notification-type.enum';

/**
 * El mapa de audiencias es lo que decide qué ve el residente en su bandeja.
 * Un tipo sin clasificar o mal clasificado no rompe nada visible: simplemente
 * deja pasar —o esconde— una notificación, en silencio. De ahí estas pruebas.
 */
describe('NOTIFICATION_AUDIENCE', () => {
  const allTypes = Object.values(NotificationType);

  it('clasifica TODOS los tipos existentes', () => {
    const sinClasificar = allTypes.filter(
      (type) => NOTIFICATION_AUDIENCE[type] === undefined,
    );

    // Si esta prueba falla es porque se agregó un NotificationType nuevo y nadie
    // decidió con qué sombrero se lee. Clasificarlo en el mapa es el arreglo.
    expect(sinClasificar).toEqual([]);
  });

  it('no clasifica tipos que ya no existen', () => {
    const fantasmas = Object.keys(NOTIFICATION_AUDIENCE).filter(
      (key) => !allTypes.includes(key as NotificationType),
    );

    expect(fantasmas).toEqual([]);
  });

  it('un tipo desconocido cae en STAFF, nunca en la app del residente', () => {
    const inventado = 'TIPO_QUE_NO_EXISTE' as NotificationType;

    expect(audienceOf(inventado)).toBe(NotificationAudience.STAFF);
    expect(RESIDENT_VISIBLE_AUDIENCES).not.toContain(
      NotificationAudience.STAFF,
    );
  });

  // ── Garantías que no se pueden perder en una reclasificación ─────────────

  it('el acceso a la propia cuenta llega con cualquier sombrero', () => {
    // Sin esto, el aviso de equipo nuevo no le llega al residente y la
    // aprobación de ingreso desde otro dispositivo deja de funcionar.
    for (const type of [
      NotificationType.NEW_DEVICE_LINKED,
      NotificationType.LOGIN_APPROVAL_REQUEST,
      NotificationType.ACCESS_CODE_RESET,
    ]) {
      expect(RESIDENT_VISIBLE_AUDIENCES).toContain(audienceOf(type));
    }
  });

  it('el pánico y las alertas del conjunto llegan con cualquier sombrero', () => {
    for (const type of [
      NotificationType.PANIC_ALERT,
      NotificationType.COMPLEX_ALERT,
      NotificationType.SYSTEM_ANNOUNCEMENT,
    ]) {
      expect(audienceOf(type)).toBe(NotificationAudience.ANY);
    }
  });

  it('quien reporta nunca queda expuesto ante el acusado', () => {
    // El reporte de convivencia lleva la identidad de quien reportó, y el de un
    // aviso en la vitrina es dato de moderación. Ninguno puede llegar a la
    // bandeja del residente, que es donde está el señalado.
    for (const type of [
      NotificationType.PET_INCIDENT_REPORTED,
      NotificationType.LISTING_REPORTED,
    ]) {
      expect(audienceOf(type)).toBe(NotificationAudience.STAFF);
    }
  });

  it('el movimiento financiero de una unidad es de la unidad', () => {
    for (const type of [
      NotificationType.PAYMENT_DUE,
      NotificationType.PAYMENT_OVERDUE,
      NotificationType.PAYMENT_RECEIVED,
      NotificationType.PAYMENT_CONFIRMED,
      NotificationType.PAYMENT_REVERSED,
      NotificationType.CHARGE_ADDED,
      NotificationType.DIRECT_CHARGE,
      NotificationType.CHARGE_WAIVED,
      NotificationType.MORA_APPLIED,
      NotificationType.WALLET_CREDIT,
      NotificationType.WALLET_APPLIED,
    ]) {
      expect(audienceOf(type)).toBe(NotificationAudience.RESIDENT);
    }
  });

  it('ANY se usa con cuentagotas: es el único valor que pasa a las dos bandejas', () => {
    const any = allTypes.filter(
      (t) => NOTIFICATION_AUDIENCE[t] === NotificationAudience.ANY,
    );

    // No es un número mágico: es un tope que obliga a justificar cada tipo
    // nuevo que se marque ANY en vez de decidir su sombrero.
    expect(any.length).toBeLessThanOrEqual(15);
  });
});
