import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Bot } from "@/entities/Bot";

export type LogLevel = "debug" | "info" | "warn" | "error";

@Entity()
export class BotLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Bot, { onDelete: "CASCADE" })
  bot!: Bot;

  @Column()
  botId!: string;

  @Column({ type: "varchar" })
  level!: LogLevel;

  @Column({ type: "text" })
  message!: string;

  @Column({ type: "simple-json", nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  timestamp!: Date;
}
