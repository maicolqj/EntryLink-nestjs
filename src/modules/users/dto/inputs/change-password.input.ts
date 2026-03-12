import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

@InputType()
export class ChangePasswordInput {
    @Field(() => String, { description: 'Contraseña actual del usuario' })
    @IsNotEmpty({ message: 'La contraseña actual es requerida' })
    @IsString({ message: 'La contraseña actual debe ser un string' })
    currentPassword: string;

    @Field(() => String, { description: 'Nueva contraseña' })
    @IsNotEmpty({ message: 'La nueva contraseña es requerida' })
    @IsString({ message: 'La nueva contraseña debe ser un string' })
    @MinLength(8, { message: 'La nueva contraseña debe tener al menos 8 caracteres' })
    @Matches(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.+-])[A-Za-z\d@$!%*?&.+-]+$/,
        {
            message:
                'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character (@$!%*?&.+-)',
        },
    ) 
    newPassword: string;

    @Field(() => String, { description: 'Confirmación de la nueva contraseña' })
    @IsNotEmpty({ message: 'La confirmación de contraseña es requerida' })
    @IsString({ message: 'La confirmación debe ser un string' })
    confirmPassword: string;
}