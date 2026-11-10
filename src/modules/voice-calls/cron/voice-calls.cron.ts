import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { VoiceCallsService } from '../services/voice-calls.service';

/**
 * Red de seguridad del temporizador de timbre: si el servidor se reinició
 * mientras una llamada sonaba, nadie la cerraría y la cuenta quedaría
 * "ocupada" para siempre.
 */
@Injectable()
export class VoiceCallsCron {
  private readonly logger = new Logger(VoiceCallsCron.name);

  constructor(private readonly voiceCalls: VoiceCallsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    try {
      const closed = await this.voiceCalls.sweepStaleCalls();
      if (closed > 0) {
        this.logger.log(`Citofonía: ${closed} llamadas colgadas cerradas`);
      }
    } catch (err) {
      this.logger.warn(
        `Barrido de llamadas falló: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}
