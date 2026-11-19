/**
 * Configuración del módulo IoT. Todo se lee de variables de entorno opcionales
 * (documentadas en `.env.example`); el módulo solo existe si `IOT_ENABLED=true`.
 *
 * No pasa por el `envValidationSchema` global a propósito: tocarlo cambiaría la
 * validación de producción, donde estas variables no existen.
 */
export interface IotConfig {
  /** Puerto del broker MQTT embebido. */
  mqttPort: number;
  /** Interfaz donde escucha el broker. */
  mqttHost: string;
  /** Certificado y clave PEM del broker (TLS). Sin ellos, MQTT va sin cifrar. */
  mqttTlsCert?: string;
  mqttTlsKey?: string;
  /** Validez del código de vinculación (s). El firmware lo acota a 30-3600. */
  pairingCodeTtlS: number;
  /** Sin reportar este tiempo → OFFLINE + alerta. */
  offlineAfterMin: number;
  /** Zona horaria de las horas de silencio cuando el dispositivo no la indica. */
  defaultTimeZone: string;
}

const entero = (valor: string | undefined, porDefecto: number): number => {
  const n = Number.parseInt(valor ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
};

export function loadIotConfig(env: NodeJS.ProcessEnv = process.env): IotConfig {
  return {
    mqttPort: entero(env.IOT_MQTT_PORT, 8883),
    mqttHost: env.IOT_MQTT_HOST || '0.0.0.0',
    mqttTlsCert: env.IOT_MQTT_TLS_CERT || undefined,
    mqttTlsKey: env.IOT_MQTT_TLS_KEY || undefined,
    pairingCodeTtlS: entero(env.IOT_PAIRING_CODE_TTL_S, 600),
    offlineAfterMin: entero(env.IOT_OFFLINE_AFTER_MIN, 120),
    defaultTimeZone: env.IOT_DEFAULT_TZ || 'America/Bogota',
  };
}

export const IOT_CONFIG = Symbol('IOT_CONFIG');
