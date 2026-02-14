export interface BotManifest {
  schema: string;
  type: "telegram";
  name?: string;
  description?: string;
  env?: {
    required?: string[];
    optional?: string[];
  };
  "os-packages"?: string[];
}
