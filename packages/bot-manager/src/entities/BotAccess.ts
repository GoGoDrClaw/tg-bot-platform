import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { User } from "@/entities/User";
import { Bot } from "@/entities/Bot";

export type BotPermission = "owner" | "admin" | "editor" | "viewer";

@Entity()
@Unique(["user", "bot"])
export class BotAccess {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.botAccess, { onDelete: "CASCADE" })
  user!: User;

  @ManyToOne(() => Bot, (bot) => bot.access, { onDelete: "CASCADE" })
  bot!: Bot;

  @Column({ type: "varchar" })
  permission!: BotPermission;

  @CreateDateColumn()
  createdAt!: Date;
}
