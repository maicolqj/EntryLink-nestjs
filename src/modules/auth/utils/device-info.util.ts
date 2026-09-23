import { createHmac } from 'crypto';
import { DeviceInfo } from '../interfaces/jwt-payload.interface';

/**
 * Construye el DeviceInfo de la petición.
 *
 * Fuente única de verdad para todos los resolvers de auth: el fingerprint debe
 * calcularse igual en el login que en la rotación de tokens, o las sesiones se
 * invalidan solas.
 *
 * El fingerprint es un HMAC con llave del servidor (VULN-11): el cliente puede
 * mentir sobre su user-agent o su deviceId, pero no puede fabricar un
 * fingerprint que coincida con el de otro dispositivo ya registrado.
 *
 * Cuando hay `x-device-id` la huella se calcula SOLO sobre él. El user-agent
 * cambia al actualizar o reinstalar la app, y con la fórmula anterior el equipo
 * dejaba de reconocerse aunque el deviceId sobreviviera en el llavero —cosa que
 * en iOS pasa—. Eso mandaba al residente al canje por WhatsApp con segundo
 * factor, y a quien había olvidado su clave lo dejaba afuera. El user-agent no
 * aportaba seguridad ahí: el deviceId ya identifica al equipo y el HMAC es lo
 * que impide falsificarlo.
 *
 * `legacyFingerprint` mantiene la fórmula vieja para la transición: los
 * vínculos ya guardados se calcularon con ella y romperlos obligaría a TODOS
 * los residentes a volver a pasar por WhatsApp. Quien compara acepta las dos y
 * reescribe la guardada al reconocerla.
 */
export function buildDeviceInfo(
  context: any,
  fingerprintSecret: string,
): DeviceInfo {
  const req = context?.req ?? {};
  const ua = req.headers?.['user-agent'] ?? 'unknown';
  const ip = extractIp(context);
  const deviceId = req.headers?.['x-device-id'] as string | undefined;
  const appVersion = req.headers?.['x-app-version'] as string | undefined;

  const hmac = (value: string) =>
    createHmac('sha256', fingerprintSecret).update(value).digest('hex');

  // Sin deviceId —la web— el user-agent es la única señal que hay.
  const fingerprint = deviceId ? hmac(`device:${deviceId}`) : hmac(`${ua}|web`);
  const legacyFingerprint = hmac(`${ua}|${deviceId ?? 'web'}`);

  return {
    fingerprint,
    legacyFingerprint,
    userAgent: ua,
    ip,
    platform: detectPlatform(ua),
    deviceId,
    appVersion,
  };
}

export function extractIp(context: any): string {
  const req = context?.req ?? {};
  return (
    (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress ??
    '0.0.0.0'
  );
}

export function detectPlatform(userAgent: string): 'ios' | 'android' | 'web' {
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'web';
}
