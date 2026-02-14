import { DeployRequest, RuntimeAdapter } from "../types";
import { createLogger } from "../logger";

const log = createLogger("KubernetesAdapter");

export class KubernetesAdapter implements RuntimeAdapter {
  // Skeleton implementation; extend with kubectl/helm calls.
  async deployBot(request: DeployRequest): Promise<void> {
    log.info(`deployBot called for ${request.botId} with image ${request.imageName}`);
  }

  async stopBot(botId: string): Promise<void> {
    log.info(`stopBot called for ${botId}`);
  }

  async restartBot(botId: string): Promise<void> {
    log.info(`restartBot called for ${botId}`);
  }

  async getStatus(botId: string): Promise<string> {
    log.warn(`getStatus not implemented for ${botId}`);
    return `[k8s] status for ${botId} not implemented`;
  }

  async getLogs(botId: string, tail = 100): Promise<string> {
    log.warn(`getLogs not implemented for ${botId}`);
    return `[k8s] logs for ${botId} tail=${tail} not implemented`;
  }
}
