import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';
import { SpecialNumberCategory } from '../enums/special-number-category.enum';

@ObjectType({ description: 'Número especial de marcado rápido configurado en el complejo' })
@Entity({ name: 'special_numbers' })
@Index(['isGlobal', 'order'])
@Index(['complexId', 'order'])
export class SpecialNumber {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String, { description: 'Nombre descriptivo (ej: Policía Nacional)' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Field(() => String, { description: 'Número de teléfono de marcado rápido' })
  @Column({ name: 'phone_number', type: 'varchar', length: 50 })
  phoneNumber: string;

  @Field(() => SpecialNumberCategory)
  @Column({ type: 'varchar', length: 50 })
  category: SpecialNumberCategory;

  @Field(() => String, { nullable: true, description: 'Descripción opcional del número' })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Field(() => Int, { description: 'Orden de visualización ascendente' })
  @Column({ type: 'int', default: 0 })
  order: number;

  @Field(() => Boolean, { description: 'Si es true: creado por SUPER_ADMIN, visible en todos los complejos y no editable por ningún otro rol' })
  @Column({ name: 'is_global', type: 'boolean', default: false })
  isGlobal: boolean;

  @Field(() => String, { nullable: true, description: 'null para números globales; UUID del complejo para números específicos' })
  @Column({ name: 'complex_id', type: 'uuid', nullable: true })
  complexId: string | null;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
