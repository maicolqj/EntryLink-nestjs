import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { GqlExceptionFilter } from "@nestjs/graphql";
import { CustomError } from "../utils/errors.utils";
import { GeneralErrorCode } from "../constans/error-codes.constants";
import { GraphQLError } from "graphql";

@Catch()
export class UniversalExceptionFilter implements ExceptionFilter, GqlExceptionFilter {
    private readonly logger = new Logger(UniversalExceptionFilter.name);

    /** Nivel al que se registran los 404. Los escáneres automatizados barren decenas de rutas
     *  de otros frameworks (/phpinfo.php, /actuator, /telescope/...) en cada pasada. Con 'warn'
     *  quedan visibles para rastrear el origen; con 'debug' desaparecen del log de producción
     *  una vez identificado el patrón; 'silent' los omite del todo. */
    private readonly notFoundLogLevel = process.env.HTTP_404_LOG_LEVEL ?? 'warn';

    /** Los valores vienen del cliente y terminan en el log: un salto de línea permitiría
     *  inyectar líneas falsas que imiten el formato de Nest. Se neutralizan y se truncan. */
    private sanitizeForLog(value: unknown, maxLength: number): string {
        return String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
    }

    /** Identifica al emisor para poder correlacionar escaneos automatizados sin depender del
     *  access log del proxy. `trust proxy = 1` (main.ts) hace que req.ip sea la IP real del
     *  cliente y no la de Traefik; cf-ipcountry solo llega si Cloudflare está delante. */
    private describeClient(request: any): string {
        const ip = request.ip || request.socket?.remoteAddress || 'unknown';
        const country = request.headers?.['cf-ipcountry'] || '-';
        const userAgent = this.sanitizeForLog(request.headers?.['user-agent'] || 'none', 120);
        // El frontend Next.js reescribe /graphql y /api/v1/* hacia este backend, así que un
        // request puede llegar por el dominio de la API o rebotado desde el de la web. El
        // Host distingue ambos casos y evita atribuir a la API un escaneo dirigido a la web.
        const host = this.sanitizeForLog(request.headers?.['host'] || '-', 80);
        return `ip=${ip} host=${host} country=${country} ua="${userAgent}"`;
    }

    /** Un 4xx lo causa el cliente (ruta inexistente, token vencido, escaneo de bots) y no
     *  implica una falla del servidor: mandarlo a ERROR ahoga las caídas reales que sí exigen
     *  intervención. Solo los 5xx conservan ese nivel, junto con el stack. */
    private logHttpFailure(status: number, request: any, payload: string) {
        const route = this.sanitizeForLog(request.url, 200);
        const summary = `HTTP ${status} — ${request.method} ${route} | ${this.describeClient(request)}`;

        if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
            this.logger.error(summary, payload);
            return;
        }

        if (status !== HttpStatus.NOT_FOUND) {
            this.logger.warn(`${summary} ${payload}`);
            return;
        }

        // Cualquier valor distinto de 'silent'/'debug' cae en warn: ante una var mal escrita
        // es preferible ruido a perder la traza del escaneo en silencio.
        if (this.notFoundLogLevel === 'silent') return;
        if (this.notFoundLogLevel === 'debug') {
            this.logger.debug(`${summary} ${payload}`);
        } else {
            this.logger.warn(`${summary} ${payload}`);
        }
    }

    /** Mapea un status HTTP a un errorCode de negocio para HttpException nativas
     *  (las que no son CustomError, ej. las que lanza el ValidationPipe). */
    private httpStatusToErrorCode(status: number): GeneralErrorCode {
        switch (status) {
            case HttpStatus.BAD_REQUEST:        return GeneralErrorCode.BAD_REQUEST;
            case HttpStatus.UNAUTHORIZED:       return GeneralErrorCode.UNAUTHORIZED;
            case HttpStatus.FORBIDDEN:          return GeneralErrorCode.FORBIDDEN;
            case HttpStatus.NOT_FOUND:          return GeneralErrorCode.NOT_FOUND;
            case HttpStatus.CONFLICT:           return GeneralErrorCode.CONFLICT;
            case HttpStatus.METHOD_NOT_ALLOWED: return GeneralErrorCode.METHOD_NOT_ALLOWED;
            case HttpStatus.TOO_MANY_REQUESTS:  return GeneralErrorCode.TOO_MANY_REQUESTS;
            case HttpStatus.PAYLOAD_TOO_LARGE:  return GeneralErrorCode.PAYLOAD_TOO_LARGE;
            case HttpStatus.SERVICE_UNAVAILABLE: return GeneralErrorCode.SERVICE_UNAVAILABLE;
            default:                            return GeneralErrorCode.INTERNAL_SERVER_ERROR;
        }
    }

    /** Extrae mensaje y errorCode de una HttpException nativa. El ValidationPipe
     *  de class-validator devuelve `message` como array de mensajes; se unifica
     *  a string y se conserva la lista en `details`. */
    private describeHttpException(exception: HttpException, status: number): { message: string; errorCode: GeneralErrorCode; details: string[] | null } {
        const res = exception.getResponse();
        const raw = typeof res === 'string' ? res : (res as { message?: unknown }).message ?? exception.message;

        if (Array.isArray(raw)) {
            return {
                message: raw.join('; '),
                errorCode: status === HttpStatus.BAD_REQUEST ? GeneralErrorCode.VALIDATION_ERROR : this.httpStatusToErrorCode(status),
                details: raw as string[],
            };
        }

        return {
            message: String(raw),
            errorCode: this.httpStatusToErrorCode(status),
            details: null,
        };
    }

    /** body-parser lanza errores planos (PayloadTooLargeError, SyntaxError de JSON) que no
     *  son HttpException: sin este mapeo se reportaban como 500 genérico. */
    private describeBodyParserError(exception: unknown): { status: number; message: string; errorCode: GeneralErrorCode } | null {
        const err = exception as { type?: unknown } | null;
        if (!err || typeof err.type !== 'string') return null;

        switch (err.type) {
            case 'entity.too.large':
                return {
                    status: HttpStatus.PAYLOAD_TOO_LARGE,
                    message: 'El contenido enviado supera el tamaño máximo permitido. Sube un archivo más liviano.',
                    errorCode: GeneralErrorCode.PAYLOAD_TOO_LARGE,
                };
            case 'entity.parse.failed':
                return {
                    status: HttpStatus.BAD_REQUEST,
                    message: 'El cuerpo de la petición no es un JSON válido.',
                    errorCode: GeneralErrorCode.BAD_REQUEST,
                };
            default:
                return null;
        }
    }

    catch(exception: unknown, host: ArgumentsHost) {
        const type = host.getType();


        // determinar si es REST o GraphQL
        if (type === 'http') {
            const ctx = host.switchToHttp();
            const request = ctx.getRequest();

            if (request.url?.includes('/admin/bull-board')) {
                return;
            }

            return this.handleHttpException(exception, host);
        } else if (type.toString() === 'graphql' || type.toString() === 'ws') {
            return this.handleGraphQLException(exception, host);
        }

        return this.handleHttpException(exception, host);


    }

    private handleHttpException(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = HttpStatus.INTERNAL_SERVER_ERROR.toString();
        let errorCode = HttpStatus.INTERNAL_SERVER_ERROR.toString();
        let details = null;

        try {
            const bodyParserError = this.describeBodyParserError(exception);

            if (bodyParserError) {
                status = bodyParserError.status;
                message = bodyParserError.message;
                errorCode = bodyParserError.errorCode;

            } else if (exception instanceof CustomError) {
                status = exception.getStatus();
                const errorResponse = exception.getResponse();
                message = errorResponse['message'] || exception.message;
                errorCode = errorResponse['errorCode'] || exception.errorCode || HttpStatus.INTERNAL_SERVER_ERROR.toString();
                details = errorResponse['details'] || exception.details || null;

            } else if (exception instanceof HttpException) {
                status = exception.getStatus();
                const described = this.describeHttpException(exception, status);
                message = described.message;
                errorCode = described.errorCode;
                details = described.details;
            } else if (exception instanceof Error) {
                // VULN-13 fix: log interno completo, cliente solo ve mensaje genérico
                this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
                message = 'Internal server error';
                details = null;

            }

            status = Number.isInteger(status) ? status : HttpStatus.INTERNAL_SERVER_ERROR;

            const errorResponse = {
                statusCode: status,
                message: message,
                errorCode: errorCode,
                details: details,
                timestamp: new Date().toISOString(),
                path: request.url,
                method: request.method
            };

            // VULN-13 fix: usar Logger de NestJS en lugar de console.error
            this.logHttpFailure(status, request, JSON.stringify({ message, errorCode }));

            response.status(status).json(errorResponse);


        } catch (error) {
            this.logger.error('Error in HTTP exception filter', error instanceof Error ? error.stack : String(error));
            response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                message: 'Internal server error occurred while processing the original error',
                timestamp: new Date().toISOString(),
                path: request.url,
                method: request.method
            });
        }
    }

    private handleGraphQLException(exception: unknown, host: ArgumentsHost) {
        let message = HttpStatus.INTERNAL_SERVER_ERROR.toString();
        let errorCode = HttpStatus.INTERNAL_SERVER_ERROR.toString();
        let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        let details = null;

        try {
            const bodyParserError = this.describeBodyParserError(exception);

            if (bodyParserError) {
                statusCode = bodyParserError.status;
                message = bodyParserError.message;
                errorCode = bodyParserError.errorCode;

            } else if (exception instanceof CustomError) {
                const errorResponse = exception.getResponse();
                message = errorResponse['message'] || exception.message;
                statusCode = exception.getStatus();
                errorCode = errorResponse['errorCode'] || exception.errorCode || HttpStatus.INTERNAL_SERVER_ERROR.toString();
                details = errorResponse['details'] || exception.details || null;


            } else if (exception instanceof GraphQLError) {
                // Si ya es un GraphQLError, re-lanzarlo tal cual
                throw exception;
            } else if (exception instanceof HttpException) {
                statusCode = exception.getStatus();
                const described = this.describeHttpException(exception, statusCode);
                message = described.message;
                errorCode = described.errorCode;
                details = described.details;
            } else if (exception instanceof Error) {
                // VULN-04 fix: no exponer exception.message al cliente GraphQL
                this.logger.error(`Unhandled GraphQL error: ${exception.message}`, exception.stack);
                message = 'Internal server error';
            }

            // VULN-13 fix: usar Logger de NestJS en lugar de console.error
            // Mismo criterio que en REST: un 4xx es del cliente, no una caída del servidor.
            const gqlPayload = JSON.stringify({ message, errorCode, statusCode });
            if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
                this.logger.error(`GraphQL error`, gqlPayload);
            } else {
                this.logger.warn(`GraphQL error ${gqlPayload}`);
            }

            // Lanzar GraphQLError con la información formateada
            throw new GraphQLError(message, {
                extensions: {
                    code: errorCode,
                    statusCode: statusCode,
                    details: details,
                    timestamp: new Date().toISOString(),
                },
            });
        } catch (error) {
            if (error instanceof GraphQLError) {
                throw error;
            }

            this.logger.error('Error in GraphQL exception filter', error instanceof Error ? error.stack : String(error));
            throw new GraphQLError('Internal server error occurred while processing the original error', {
                extensions: {
                    code: 'INTERNAL_SERVER_ERROR',
                    statusCode: 500,
                    timestamp: new Date().toISOString(),
                },
            });
        }
    }

}