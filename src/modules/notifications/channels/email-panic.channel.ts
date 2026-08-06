import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { MailService }          from '../../../mail/mail.service';
import { User }                 from '../../users/entities/user.entity';
import { PanicDeliveryChannel } from '../enums/panic-delivery-channel.enum';
import {
  PanicChannel,
  PanicChannelContext,
  PanicChannelResult,
} from './panic-channel.interface';

/**
 * Correo de escalamiento.
 *
 * Es el único canal alterno realmente operativo hoy: no depende de que el
 * celular despierte, ni de una plantilla aprobada por Meta, ni de un proveedor
 * de SMS. Menos inmediato que un push, pero llega — que es exactamente lo que
 * hace falta cuando el push ya falló.
 */
@Injectable()
export class EmailPanicChannel implements PanicChannel {
  readonly channel = PanicDeliveryChannel.EMAIL;
  private readonly logger = new Logger(EmailPanicChannel.name);

  constructor(
    private readonly mailService: MailService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  unavailableReason(): string {
    return '';
  }

  async send(ctx: PanicChannelContext): Promise<PanicChannelResult> {
    if (ctx.userIds.length === 0) return { reached: 0, skippedReason: 'sin destinatarios' };

    try {
      const users = await this.userRepo.find({
        where:  { id: In(ctx.userIds) },
        select: ['id', 'name', 'lastName', 'email'],
      });

      const withEmail = users.filter(u => !!u.email);
      if (withEmail.length === 0) {
        return { reached: 0, skippedReason: 'ningún destinatario tiene correo registrado' };
      }

      const locationUrl = ctx.alert.latitude && ctx.alert.longitude
        ? `https://www.google.com/maps/search/?api=1&query=${ctx.alert.latitude},${ctx.alert.longitude}`
        : undefined;

      // Encolar, no enviar: el envío SMTP puede tardar segundos y este canal
      // corre dentro del procesador de escalamiento, que debe seguir al
      // siguiente nivel sin quedarse esperando al servidor de correo.
      await Promise.allSettled(
        withEmail.map(u => this.mailService.queuePanicAlertEmail({
          email:            u.email!,
          name:             `${u.name ?? ''} ${u.lastName ?? ''}`.trim() || 'equipo',
          alertId:          ctx.alert.id,
          complexId:        ctx.alert.complexId,
          triggeredByLabel: ctx.alert.triggeredByLabel ?? 'Origen no identificado',
          triggeredAt:      ctx.alert.createdAt.toISOString(),
          escalationLevel:  ctx.escalationLevel,
          locationUrl,
        })),
      );

      return { reached: withEmail.length };
    } catch (err) {
      const message = (err as Error)?.message ?? 'error desconocido';
      this.logger.error(`Correo de pánico falló para la alerta ${ctx.alert.id}: ${message}`);
      return { reached: 0, skippedReason: message };
    }
  }
}
