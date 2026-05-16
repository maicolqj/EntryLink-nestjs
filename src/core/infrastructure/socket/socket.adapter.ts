import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

export class SocketIoRedisAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(options: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  }): Promise<void> {
    const redisOptions = {
      host: options.host,
      port: options.port,
      password: options.password || undefined,
      db: options.db ?? 6,
      enableReadyCheck: false,
      lazyConnect: false,
      family: 4 as const,
      keepAlive: 60000,
    };

    const pubClient = new Redis(redisOptions);
    const subClient = pubClient.duplicate();

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
