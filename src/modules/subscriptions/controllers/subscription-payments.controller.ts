import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SubscriptionPaymentsService } from '../services/subscription-payments.service';
import { SubmitSubscriptionPaymentDto } from '../dto/inputs/submit-subscription-payment.input';
import {
  ALLOWED_FILE_MIME_TYPES,
  singleDocumentInterceptor,
  singleImageInterceptor,
} from '../../../core/infrastructure/r2/upload-interceptors';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { AllowWhenSuspended } from '../../shared/decorators/allow-when-suspended.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Renovar es justo lo que necesita la administración suspendida: sin
 * `@AllowWhenSuspended` quedaría encerrada sin poder pagar.
 */
@AllowWhenSuspended()
@Controller('subscriptions')
export class SubscriptionPaymentsController {
  constructor(
    private readonly paymentsService: SubscriptionPaymentsService,
    private readonly storageService: R2StorageService,
  ) {}

  /**
   * POST /api/v1/subscriptions/payment-submissions
   *
   * Body (multipart/form-data):
   *   - amountPaid : valor pagado (COP)
   *   - paidAt     : fecha del pago (ISO)
   *   - reference  : número de la transacción (opcional)
   *   - receipt    : comprobante, imagen o PDF, máx 10 MB
   *
   * Carpeta R2: EntryLink/{complex-slug}/subscriptions/receipts (sin URL pública)
   */
  @Post('payment-submissions')
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL] })
  @UseInterceptors(
    singleDocumentInterceptor('receipt', {
      maxSizeMb: 10,
      allowedTypes: ALLOWED_FILE_MIME_TYPES,
    }),
  )
  async submit(
    @Body() body: Record<string, unknown>,
    @UploadedFile() receipt: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    const user = req.user as JwtAccessPayload;
    const complexId =
      user.complexId ?? (user.entityType === 'complex' ? user.sub : undefined);
    if (!complexId) {
      throw new ForbiddenException('La sesión no pertenece a un complejo');
    }

    const dto = plainToInstance(SubmitSubscriptionPaymentDto, body);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      throw new CustomError({
        message: `Datos del pago inválidos: ${errors
          .flatMap((e) => Object.values(e.constraints ?? {}))
          .join('; ')}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }

    return this.paymentsService.submit(complexId, dto, receipt, user);
  }

  /**
   * GET /api/v1/subscriptions/payment-submissions/:id/receipt
   *
   * El comprobante, para la administración del mismo conjunto o el personal
   * de la plataforma.
   */
  @Get('payment-submissions/:id/receipt')
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.ACCOUNTANT_ROL,
    ],
  })
  async downloadReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const submission = await this.paymentsService.resolveReceipt(
      id,
      req.user as JwtAccessPayload,
    );
    const file = await this.storageService.getObjectStream(
      submission.receiptKey,
    );

    // filename* (RFC 5987) para tildes y eñes; filename plano como respaldo.
    const name = submission.receiptName;
    const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Type', submission.receiptMimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    if (file.length) res.setHeader('Content-Length', String(file.length));
    res.setHeader('Cache-Control', 'private, no-store');
    file.stream.pipe(res);
  }

  /**
   * PUT /api/v1/subscriptions/payment-settings
   *
   * Body (multipart/form-data):
   *   - instructions : cuenta, titular, lo que deban saber para pagar
   *   - qr           : imagen del código QR (opcional; reemplaza la anterior)
   */
  @Put('payment-settings')
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  @UseInterceptors(singleImageInterceptor('qr', { maxSizeMb: 5 }))
  async updateSettings(
    @Body('instructions') instructions: string | undefined,
    @UploadedFile() qr: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    const user = req.user as JwtAccessPayload;
    return this.paymentsService.updatePaymentSettings(
      typeof instructions === 'string'
        ? instructions.slice(0, 2000)
        : undefined,
      qr,
      user.entityType === 'user' ? user.sub : null,
    );
  }
}
