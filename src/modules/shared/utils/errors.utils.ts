import { HttpException, HttpStatus } from "@nestjs/common";

export class CustomError extends HttpException {
    public readonly errorCode: string;
    public readonly details: string;

    constructor(
        params: {
            message: string,
            statusCode: number,
            errorCode?: string,
            details?: string
        }
    ) {
        super(params.message, params.statusCode || HttpStatus.INTERNAL_SERVER_ERROR);
        this.errorCode = params.errorCode || HttpStatus.INTERNAL_SERVER_ERROR.toString();
        this.details = params.details || '';

        Object.setPrototypeOf(this, CustomError.prototype) // Esto es necesario debido a cómo funciona la herencia de clases en TypeScript
    }

    getResponse(): string | object {
        return {
            message: this.message,
            statusCode: this.getStatus(),
            errorCode: this.errorCode,
            details: this.details
        }
    }


}