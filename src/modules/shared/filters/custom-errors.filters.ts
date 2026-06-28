import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { GqlExceptionFilter } from "@nestjs/graphql";
import { CustomError } from "../utils/errors.utils";
import { GeneralErrorCode } from "../constans/error-codes.constants";
import { GraphQLError } from "graphql";

@Catch()
export class UniversalExceptionFilter implements ExceptionFilter, GqlExceptionFilter {
    private readonly logger = new Logger(UniversalExceptionFilter.name);

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
            if (exception instanceof CustomError) {
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
            this.logger.error(`HTTP ${status} — ${request.method} ${request.url}`, JSON.stringify({ message, errorCode }));

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
            if (exception instanceof CustomError) {
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
            this.logger.error(`GraphQL error`, JSON.stringify({ message, errorCode, statusCode }));

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