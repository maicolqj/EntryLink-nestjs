// user-role.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { Field, ObjectType } from '@nestjs/graphql';
import { Role } from '../../roles/entities/role.entity';

@ObjectType({
    description: 'Entidad intermedia qeu guarda la relacion entre el usuario y los roles'
})
@Entity('user_has_roles')
export class UserRole {

    @PrimaryGeneratedColumn('uuid')
    @Field(() => String, { description: 'Id del rol' })
    id: string;

    @Column({ name: 'is_primary', default: true, nullable: true })
    @Field(() => Boolean, { description: 'Indica si el rol está marcado como seleccionado o principal para el usuario', nullable: true })
    isPrimary?: boolean;

    @Column({ name: 'assigned_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    @Field(() => Date, { description: 'Indica la fecha de asignación del rol al usuario' })
    assignedAt: Date;


    //**************************************************************************************************************************
    //**************************************************************************************************************************
    //*************************************************************RELACIONES***************************************************
    //**************************************************************************************************************************
    //**************************************************************************************************************************
    
    @ManyToOne(() => User, user => user.userRoles)
    @JoinColumn({ name: 'user_id' })
    @Field(() => User, {
        nullable: true,
        description: 'Users who have this role'
    })
    user: User;

    @ManyToOne(() => Role, role => role.userRoles)
    @JoinColumn({ name: 'role_id' })
    @Field(() => Role, {
        description: 'Roles asignados al usuario'
    })
    role: Role;

    //**************************************************************************************************************************
    //**************************************************************************************************************************
    //*************************************************************HOOKS***************************************************
    //**************************************************************************************************************************
    //**************************************************************************************************************************
    
}