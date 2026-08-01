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
 */
export function buildDeviceInfo(context: any, fingerprintSecret: string): DeviceInfo {
  const req = context?.req ?? {};
  const ua = req.headers?.['user-agent'] ?? 'unknown';
  const ip = extractIp(context);
  const deviceId = req.headers?.['x-device-id'] as string | undefined;
  const appVersion = req.headers?.['x-app-version'] as string | undefined;

  const fingerprint = createHmac('sha256', fingerprintSecret)
    .update(`${ua}|${deviceId ?? 'web'}`)
    .digest('hex');

  return { fingerprint, userAgent: ua, ip, platform: detectPlatform(ua), deviceId, appVersion };
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
