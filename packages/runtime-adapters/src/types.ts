export type RuntimeType = "swarm" | "k8s" | "docker";

export interface DeployRequest {
  botId: string;
  imageName: string;
  port: number;
  env: Record<string, string>;
  webhookUrl: string;
  resources?: {
    cpu?: string;
    memory?: string;
  };
}

export interface RuntimeAdapter {
  deployBot(request: DeployRequest): Promise<void>;
  stopBot(botId: string): Promise<void>;
  restartBot(botId: string): Promise<void>;
  getStatus(botId: string): Promise<string>;
  getLogs(botId: string, tail?: number): Promise<string>;
}
