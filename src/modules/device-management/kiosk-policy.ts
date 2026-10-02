import { createHash } from 'crypto';

/** Paquete de EntryLink en Google Play. */
export const ENTRYLINK_PACKAGE = 'com.alternaqj.entrylink';

/** Una sola política para todos los equipos de portería, de todos los conjuntos. */
export const KIOSK_POLICY_ID = 'porteria';

/**
 * Política de los equipos de portería: EntryLink en modo kiosco.
 *
 * Referencia: developers.google.com/android/management/reference/rest/v1/enterprises.policies
 *
 * Decisiones:
 * - `installType: KIOSK`: Google instala EntryLink desde Play y la deja como
 *   única app, abierta siempre. El guarda no puede salir, desinstalarla ni
 *   borrarle los datos.
 * - `defaultPermissionPolicy: GRANT`: cámara, ubicación, notificaciones,
 *   teléfono y Bluetooth (impresora) quedan concedidos sin preguntar. Un
 *   diálogo de permisos en un kiosco es un equipo bloqueado hasta que llegue
 *   alguien que sepa qué tocar.
 * - `DEFAULT_DIALER`: EntryLink es el marcador del equipo (InCallService). La
 *   API solo lo fija en Android 14+; en versiones anteriores la app sigue
 *   pidiendo el rol ella misma al iniciar.
 * - Ajustes bloqueados. Si el equipo arranca sin red, `networkEscapeHatchEnabled`
 *   deja escoger un wifi; para cambiarlo después hay que reinscribir o usar el
 *   botón de reinicio desde el panel.
 * - Se mantiene encendido conectado a la corriente y la ubicación queda forzada
 *   (el pánico manda dónde está la portería).
 * - Actualizaciones de Android y de la app de madrugada (2:00–5:00).
 */
export function buildKioskPolicy(): Record<string, unknown> {
  return {
    applications: [
      {
        packageName: ENTRYLINK_PACKAGE,
        installType: 'KIOSK',
        defaultPermissionPolicy: 'GRANT',
        autoUpdateMode: 'AUTO_UPDATE_HIGH_PRIORITY',
      },
    ],
    defaultApplicationSettings: [
      {
        defaultApplicationType: 'DEFAULT_DIALER',
        defaultApplications: [{ packageName: ENTRYLINK_PACKAGE }],
        defaultApplicationScopes: ['SCOPE_FULLY_MANAGED'],
      },
    ],
    kioskCustomization: {
      powerButtonActions: 'POWER_BUTTON_AVAILABLE',
      systemErrorWarnings: 'ERROR_AND_WARNINGS_MUTED',
      systemNavigation: 'NAVIGATION_DISABLED',
      statusBar: 'SYSTEM_INFO_ONLY',
      deviceSettings: 'SETTINGS_ACCESS_BLOCKED',
    },
    stayOnPluggedModes: ['AC', 'USB', 'WIRELESS'],
    factoryResetDisabled: true,
    networkEscapeHatchEnabled: true,
    locationMode: 'LOCATION_ENFORCED',
    systemUpdate: { type: 'WINDOWED', startMinutes: 120, endMinutes: 300 },
    statusReportingSettings: {
      applicationReportsEnabled: true,
      softwareInfoEnabled: true,
      hardwareStatusEnabled: true,
      deviceSettingsEnabled: true,
    },
  };
}

/** Huella de la política: si cambia en el código, se vuelve a aplicar al arrancar. */
export function kioskPolicyHash(): string {
  return createHash('sha256').update(JSON.stringify(buildKioskPolicy())).digest('hex');
}
