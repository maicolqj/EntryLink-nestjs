import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

@ObjectType()
@Entity('charge_categories')
@Index(['complexId', 'isActive'])
export class ChargeCategory {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 300, nullable: true })
  description?: string;

  /** Color hex, ej: '#3B82F6' */
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 10, nullable: true })
  color?: string;

  @Field()
  @Column({ default: true })
  isActive: boolean;

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complexId' })
  complex: ResidentialComplex;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
