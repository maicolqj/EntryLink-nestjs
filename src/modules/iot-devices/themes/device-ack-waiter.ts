import { Injectable } from '@nestjs/common';

type Ack = Record<string, unknown>;

/**
 * Esperar el `ack` de un comando que acaba de salir por MQTT (p. ej.
 * set_theme), para que la mutation pueda responder "aplicado"/"rechazado" en
 * vez de solo "enviado". Lo alimenta DeviceIngressService.recordAck.
 * En memoria: vale para un solo proceso, como el broker embebido.
 */
@Injectable()
export class DeviceAckWaiter {
  private readonly esperas = new Map<string, Set<(ack: Ack | null) => void>>();

  wait(deviceId: string, cmd: string, timeoutMs: number): Promise<Ack | null> {
    const clave = `${deviceId}:${cmd}`;
    return new Promise((resolve) => {
      const lista = this.esperas.get(clave) ?? new Set();
      let hecho = false;
      const terminar = (ack: Ack | null) => {
        if (hecho) return;
        hecho = true;
        clearTimeout(reloj);
        lista.delete(terminar);
        if (!lista.size) this.esperas.delete(clave);
        resolve(ack);
      };
      const reloj = setTimeout(() => terminar(null), timeoutMs);
      reloj.unref?.();
      lista.add(terminar);
      this.esperas.set(clave, lista);
    });
  }

  /** Llega un ack: despierta a quien lo esperaba. */
  notify(deviceId: string, ack: Ack): void {
    const cmd = typeof ack.cmd === 'string' ? ack.cmd : '';
    const lista = this.esperas.get(`${deviceId}:${cmd}`);
    lista?.forEach((terminar) => terminar(ack));
  }
}
