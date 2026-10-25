/**
 * Topics MQTT del firmware (CONTRATO_REAL.md §2):
 *   entrylink/devices/<deviceId>/telemetry  matera → (QoS 0)
 *   entrylink/devices/<deviceId>/status     matera → "online"/"offline" retenido (LWT)
 *   entrylink/devices/<deviceId>/ack        matera → respuesta a cmd
 *   entrylink/devices/<deviceId>/cmd        → matera (QoS 1)
 *   entrylink/devices/<deviceId>/notify     → matera (QoS 1)
 */
export const TOPIC_PREFIX = 'entrylink/devices/';

export type DeviceInboundTopic = 'telemetry' | 'status' | 'ack';
export type DeviceOutboundTopic = 'cmd' | 'notify';

const ENTRANTES: ReadonlySet<string> = new Set(['telemetry', 'status', 'ack']);
const SALIENTES: ReadonlySet<string> = new Set(['cmd', 'notify']);

export interface ParsedTopic {
  deviceId: string;
  suffix: string;
}

/** null si el topic no es entrylink/devices/<id>/<sufijo> (sin comodines). */
export function parseTopic(topic: string): ParsedTopic | null {
  if (!topic.startsWith(TOPIC_PREFIX)) return null;
  const partes = topic.slice(TOPIC_PREFIX.length).split('/');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  if (/[+#]/.test(topic)) return null;
  return { deviceId: partes[0], suffix: partes[1] };
}

export const topicFor = (
  deviceId: string,
  suffix: DeviceOutboundTopic | DeviceInboundTopic,
): string => `${TOPIC_PREFIX}${deviceId}/${suffix}`;

/** ACL: un aparato solo publica telemetry/status/ack de SU deviceId. */
export function canDevicePublish(clientId: string, topic: string): boolean {
  const p = parseTopic(topic);
  return !!p && p.deviceId === clientId && ENTRANTES.has(p.suffix);
}

/** ACL: un aparato solo se suscribe a SU cmd/notify. */
export function canDeviceSubscribe(clientId: string, topic: string): boolean {
  const p = parseTopic(topic);
  return !!p && p.deviceId === clientId && SALIENTES.has(p.suffix);
}
