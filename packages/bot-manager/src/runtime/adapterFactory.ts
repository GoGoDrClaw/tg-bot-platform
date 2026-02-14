import type { RuntimeAdapter } from "@bot-platform/runtime-adapters";
import { DockerAdapter, DockerSwarmAdapter, KubernetesAdapter } from "@bot-platform/runtime-adapters";
import { BotRuntime } from "@/entities/Bot";
import { createLogger } from "@/utils/logger";

const log = createLogger("AdapterFactory");

export function createRuntimeAdapter(runtime: BotRuntime): RuntimeAdapter {
  switch (runtime) {
    case "docker": {
      log.debug("selected Docker adapter");
      return new DockerAdapter();
    }
    case "swarm": {
      log.debug("selected Swarm adapter");
      return new DockerSwarmAdapter();
    }
    case "k8s": {
      log.debug("selected Kubernetes adapter");
      return new KubernetesAdapter();
    }
    default:
      throw new Error(`Unsupported runtime: ${runtime}`);
  }
}
