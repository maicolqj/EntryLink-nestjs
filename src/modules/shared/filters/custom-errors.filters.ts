import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { GqlExceptionFilter } from "@nestjs/graphql";
import { CustomError } from "../utils/errors.utils";
import { GraphQLError } from "graphql";

@Catch()
export class UniversalExceptionFilter implements ExceptionFilter, GqlExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        const type = host.getType();


        // determinar si es REST o GraphQL
        if (type === 'http') {
            return this.handleHttpException(exception, host);
        } else if (type.toString() === 'graphql') {
            return this.handleGraphQLException(exception, host)
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
                const exceptionResponse = exception.getResponse();
                message = typeof exceptionResponse === 'string'
                    ? exceptionResponse
                    : (exceptionResponse as any).message || exception.message;
            } else if (exception instanceof Error) {
                message = exception.message;
                details = exception.stack || null;

            }

            // Asegurarse de que status sea siempre un número válido
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

            // Log del error para debugging
            console.error('HTTP Exception caught:', errorResponse);

            response.status(status).json(errorResponse);


        } catch (error) {
            console.error('Error in HTTP exception filter:', error);
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
                const exceptionResponse = exception.getResponse();
                message = typeof exceptionResponse === 'string'
                    ? exceptionResponse
                    : (exceptionResponse as any).message || exception.message;
            } else if (exception instanceof Error) {
                message = exception.message;
            }

            // Log del error para debugging
            console.error('GraphQL Exception caught:', {
                message,
                errorCode,
                statusCode,
                details,
                timestamp: new Date().toISOString(),
            });

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
            // Si el error ya es un GraphQLError, re-lanzarlo
            if (error instanceof GraphQLError) {
                throw error;
            }

            // Para cualquier otro error, crear un GraphQLError genérico
            console.error('Error in GraphQL exception filter:', error);
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