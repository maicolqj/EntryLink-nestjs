import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { MAIL_QUEUE_NAME } from './constants/mail.constants';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: MAIL_QUEUE_NAME }),

    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST', 'localhost'),
          port: config.get<number>('MAIL_PORT', 1025),
          secure: config.get<string>('MAILER_SECURE') === 'true',
          auth: config.get<string>('MAIL_USER')
            ? {
                user: config.get<string>('MAIL_USER'),
                pass: config.get<string>('MAIL_PASSWORD'),
              }
            : undefined,
        },
        defaults: {
          from: `"${config.get<string>('MAIL_FROM', 'entrylink')}" <${config.get<string>('MAIL_FROM_ADDRESS', 'noreply@entrylink.app')}>`,
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
      }),
    }),
  ],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
