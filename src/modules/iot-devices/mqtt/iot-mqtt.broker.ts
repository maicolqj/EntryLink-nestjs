import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createBroker } from 'aedes';
import type Aedes from 'aedes';
import type { AuthenticateError, Client } from 'aedes';
import { readFileSync } from 'node:fs';
import { createServer as createTcpServer, Server } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';

import { IOT_CONFIG, IotConfig } from '../iot.config';
import { DeviceCredentialsService } from '../services/device-credentials.service';
import { DeviceIngressService } from '../services/device-ingress.service';
import { DeviceOutboxService } from '../services/device-outbox.service';
import { DevicePublisher } from './device-publisher';
import { canDevicePublish, canDeviceSubscribe, parseTopic } from './iot-topics';

/** Códigos CONNACK de MQTT 3.1.1: el firmware trata 4 y 5 como "identidad rechazada". */
const BAD_USERNAME_OR_PASSWORD = 4;
const NOT_AUTHORIZED = 5;

const rechazo = (returnCode: number, mensaje: string): AuthenticateError =>
  Object.assign(new Error(mensaje), { returnCode });

/**
 * Broker MQTT embebido (aedes) del módulo IoT. Solo existe si IOT_ENABLED=true
 * (es un provider de este módulo): con el flag apagado no abre ningún puerto.
 *
 * - Autenticación: usuario = deviceId, contraseña = deviceKey (bcrypt) y
 *   clientId = deviceId, como manda el firmware.
 * - ACL: cada aparato publica telemetry/status/ack y se suscribe a cmd/notify
 *   SOLO de su propio deviceId.
 * - El backend no es un cliente MQTT: escucha el evento `publish` del broker
 *   (equivale a estar suscrito a entrylink/devices/#) y publica con
 *   `broker.publish` a través de DevicePublisher.
 * - TLS con IOT_MQTT_TLS_CERT / IOT_MQTT_TLS_KEY. Sin certificado solo arranca
 *   fuera de producción (pruebas locales).
 *
 * Limitación: un solo proceso. Con varias réplicas del backend, cada una
 * tendría su broker; para eso habría que pasar a un broker externo o a
 * aedes con mqemitter-redis + persistencia compartida.
 */
@Injectable()
export class IotMqttBroker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('IotMqttBroker');
  private broker: Aedes | null = null;
  private server: Server | null = null;

  constructor(
    @Inject(IOT_CONFIG) private readonly config: IotConfig,
    private readonly credentials: DeviceCredentialsService,
    private readonly ingress: DeviceIngressService,
    private readonly outbox: DeviceOutboxService,
    private readonly publisher: DevicePublisher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const conTls = !!(this.config.mqttTlsCert && this.config.mqttTlsKey);
    if (!conTls && process.env.NODE_ENV === 'production') {
      this.logger.error(
        'IOT: sin IOT_MQTT_TLS_CERT / IOT_MQTT_TLS_KEY el broker MQTT NO arranca en producción (las claves irían en claro)',
      );
      return;
    }

    const broker = createBroker({
      authenticate: (client, username, password, done) =>
        void this.authenticate(client, username, password, done),
      authorizePublish: (client, packet, done) => {
        if (!client) return done(null); // publicaciones internas del backend
        if (!canDevicePublish(client.id, packet.topic))
          return done(new Error('topic no permitido'));
        // Solo .../status puede quedar retenido (el LWT "offline" del firmware)
        if (packet.retain && parseTopic(packet.topic)?.suffix !== 'status')
          packet.retain = false;
        done(null);
      },
      authorizeSubscribe: (client, sub, done) => {
        if (!canDeviceSubscribe(client.id, sub.topic))
          return done(new Error('suscripción no permitida'));
        done(null, sub);
      },
    });

    broker.on('clientReady', (client: Client) => {
      this.publisher.markConnected(client.id, true);
      void this.ingress
        .setConnected(client.id, true)
        .catch((e) => this.fallo('clientReady', e));
    });
    broker.on('clientDisconnect', (client: Client) => {
      this.publisher.markConnected(client.id, false);
      void this.ingress
        .setConnected(client.id, false)
        .catch((e) => this.fallo('clientDisconnect', e));
    });
    // Al suscribirse a cmd / notify recibe lo que quedó pendiente mientras dormía
    broker.on('subscribe', (subs, client) => {
      if (!client) return;
      void this.alSuscribirse(
        client.id,
        subs.map((s) => s.topic),
      ).catch((e) => this.fallo('subscribe', e));
    });
    broker.on('publish', (packet, client) => {
      if (!client) return; // lo publicado por el propio backend
      void this.alPublicar(client.id, packet.topic, packet.payload).catch((e) =>
        this.fallo('publish', e),
      );
    });
    broker.on('clientError', (client, error) =>
      this.logger.debug(`[mqtt] ${client?.id}: ${error.message}`),
    );

    const server = conTls
      ? createTlsServer(
          {
            cert: readFileSync(this.config.mqttTlsCert),
            key: readFileSync(this.config.mqttTlsKey),
          },
          broker.handle,
        )
      : createTcpServer(broker.handle);
    // Si el puerto está ocupado se registra y el resto del backend sigue arriba
    const escuchando = await new Promise<boolean>((resolve) => {
      server.once('error', (e: Error) => {
        this.logger.error(
          `IOT: el broker MQTT no pudo escuchar en ${this.config.mqttPort}: ${e.message}`,
        );
        resolve(false);
      });
      server.listen(this.config.mqttPort, this.config.mqttHost, () =>
        resolve(true),
      );
    });
    if (!escuchando) {
      broker.close();
      return;
    }

    this.broker = broker;
    this.server = server;
    this.publisher.attach(broker);
    this.logger.log(
      `IOT: broker MQTT en ${this.config.mqttHost}:${this.config.mqttPort} ${conTls ? '(TLS)' : '(SIN TLS: solo pruebas)'}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.publisher.attach(null);
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    await new Promise<void>((resolve) =>
      this.broker ? this.broker.close(() => resolve()) : resolve(),
    );
    this.server = null;
    this.broker = null;
  }

  private async authenticate(
    client: Client,
    username: string | undefined,
    password: Buffer | undefined,
    done: (error: AuthenticateError | null, success: boolean | null) => void,
  ): Promise<void> {
    try {
      if (!username || client.id !== username) {
        return done(
          rechazo(NOT_AUTHORIZED, 'clientId distinto del usuario'),
          false,
        );
      }
      const device = await this.credentials.verify(
        username,
        password?.toString('utf8'),
      );
      if (!device)
        return done(
          rechazo(BAD_USERNAME_OR_PASSWORD, 'identidad rechazada'),
          false,
        );
      done(null, true);
    } catch (e) {
      this.fallo('authenticate', e);
      done(rechazo(NOT_AUTHORIZED, 'error interno'), false);
    }
  }

  private async alPublicar(
    clientId: string,
    topic: string,
    payload: Buffer | string,
  ): Promise<void> {
    const t = parseTopic(topic);
    if (!t || t.deviceId !== clientId) return;
    const texto = payload.toString();
    if (t.suffix === 'status') {
      await this.ingress.setConnected(clientId, texto === 'online');
      return;
    }
    const device = await this.ingress.findByDeviceId(clientId);
    if (!device) return;
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      this.logger.warn(`[mqtt] ${clientId}/${t.suffix}: JSON inválido`);
      return;
    }
    if (t.suffix === 'telemetry')
      await this.ingress.ingestTelemetry(device, json, 'mqtt');
    else if (t.suffix === 'ack') await this.ingress.recordAck(device, json);
  }

  private async alSuscribirse(
    clientId: string,
    topics: string[],
  ): Promise<void> {
    const device = await this.ingress.findByDeviceId(clientId);
    if (!device) return;
    for (const topic of topics) {
      const sufijo = parseTopic(topic)?.suffix;
      if (sufijo === 'cmd' || sufijo === 'notify')
        await this.outbox.flush(device, sufijo);
    }
  }

  private fallo(donde: string, e: unknown): void {
    this.logger.error(
      `[mqtt] ${donde}: ${e instanceof Error ? e.message : JSON.stringify(e)}`,
    );
  }
}
