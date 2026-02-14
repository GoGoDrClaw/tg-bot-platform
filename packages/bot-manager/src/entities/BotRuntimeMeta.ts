import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Bot } from "@/entities/Bot";

@Entity()
export class BotRuntimeMeta {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  key!: string;

  @Column()
  value!: string;

  @ManyToOne(() => Bot, (bot) => bot.runtimeMeta, { onDelete: "CASCADE" })
  bot!: Bot;
}
