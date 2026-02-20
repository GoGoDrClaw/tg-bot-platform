export interface BotEnvVariable {
  description?: string;
  default?: string;
  required?: boolean;
  configKey?: string; // Custom key for accessing in SDK config (e.g., "welcomeMessage" instead of "WELCOME_MESSAGE")
}

export interface BotManifest {
  schema: string;
  type: "telegram";
  name?: string;
  description?: string;
  env?: Record<string, BotEnvVariable>;
  "os-packages"?: string[];
}
