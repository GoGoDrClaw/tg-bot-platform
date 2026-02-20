import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { BotEnv } from "@/entities/BotEnv";
import { BotRuntimeMeta } from "@/entities/BotRuntimeMeta";
import { BotAccess } from "@/entities/BotAccess";

export type BotStatus = "created" | "running" | "stopped" | "failed";
export type BotRuntime = "swarm" | "k8s" | "docker";

@Entity()
export class Bot {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true, nullable: true })
  code?: string;

  @Column({ type: "varchar" })
  status!: BotStatus;

  @Column({ type: "varchar" })
  runtime!: BotRuntime;

  @Column({ type: "varchar", default: "1.0.0" })
  runtimeVersion!: string;

  @Column()
  imageName!: string;

  @Column()
  webhookUrl!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => BotEnv, (env) => env.bot, { cascade: true })
  envs?: BotEnv[];

  @OneToMany(() => BotRuntimeMeta, (meta) => meta.bot, { cascade: true })
  runtimeMeta?: BotRuntimeMeta[];

  @OneToMany(() => BotAccess, (access) => access.bot, { cascade: true })
  access?: BotAccess[];
}
