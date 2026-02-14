import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Bot } from "@/entities/Bot";

@Entity()
export class BotEnv {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  key!: string;

  @Column()
  value!: string;

  @ManyToOne(() => Bot, (bot) => bot.envs, { onDelete: "CASCADE" })
  bot!: Bot;
}
