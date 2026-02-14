import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { BotAccess } from "@/entities/BotAccess";

export type UserRole = "admin" | "editor" | "viewer";

@Entity()
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "bigint", unique: true })
  telegramId!: number;

  @Column({ nullable: true })
  username?: string;

  @Column({ nullable: true })
  firstName?: string;

  @Column({ nullable: true })
  lastName?: string;

  @Column({ nullable: true })
  photoUrl?: string;

  @Column({ type: "varchar", default: "viewer" })
  role!: UserRole;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => BotAccess, (access) => access.user, { cascade: true })
  botAccess?: BotAccess[];
}
