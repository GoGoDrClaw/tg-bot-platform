import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { BotManifest } from "@/types/botManifest";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  manifest?: BotManifest;
  pkg?: any;
}

export function validateBotProject(root: string): ValidationResult {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    return { ok: false, reason: "package.json not found" };
  }

  const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
  const keywords: string[] = pkg.keywords ?? [];
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const hasKeyword = keywords.includes("telegram") && keywords.includes("bot");
  const hasDependency =
    "telegraf" in deps || "grammy" in deps || "grammY" in deps || "aiogram" in deps;

  if (!hasKeyword && !hasDependency) {
    return { ok: false, reason: "package.json must include telegram bot keywords or dependencies" };
  }

  const manifest = loadBotManifest(root, pkg);
  if (!manifest) {
    return { ok: false, reason: "manifest not found (package.json.bot)" };
  }
  const manifestOk = validateManifest(manifest);
  if (!manifestOk.ok) return manifestOk;

  return { ok: true, manifest, pkg };
}

function validateManifest(manifest: BotManifest): ValidationResult {
  if (manifest.type !== "telegram") {
    return { ok: false, reason: "manifest.type must be telegram" };
  }

  // Validate env format
  if (manifest.env) {
    // These keys are managed by the platform and must not appear in manifest.env
    const SYSTEM_ENV_KEYS = [
      "BOT_TOKEN", "BOT_ID", "PORT", "WEBHOOK_URL",
      "TELEGRAM_API_BASE", "BOT_MANAGER_URL", "DATABASE_URL",
      "BOT_OWNER_ID", "BOT_ADMIN_IDS",
    ];
    for (const key of SYSTEM_ENV_KEYS) {
      if (key in manifest.env) {
        return { ok: false, reason: `${key} should not be in manifest.env - it's managed by the platform` };
      }
    }

    // Validate each env variable
    for (const [key, config] of Object.entries(manifest.env)) {
      if (typeof config !== "object") {
        return { ok: false, reason: `manifest.env.${key} must be an object` };
      }
    }
  }

  if (manifest["os-packages"]) {
    if (!Array.isArray(manifest["os-packages"])) {
      return { ok: false, reason: "manifest.os-packages must be an array" };
    }
    const invalid = manifest["os-packages"].find((p) => typeof p !== "string");
    if (invalid) {
      return { ok: false, reason: "manifest.os-packages entries must be strings" };
    }
  }
  return { ok: true };
}

export function loadBotManifest(_root: string, pkg?: any): BotManifest | null {
  const packageJson = pkg ?? {};
  if (packageJson.bot && typeof packageJson.bot === "object") {
    const { name, description, schema, ...rest } = packageJson.bot;
    return rest as BotManifest;
  }
  return null;
}

/**
 * Get list of allowed environment variables from manifest
 * Returns object with env name as key and config as value
 */
export function getAllowedEnvVariables(manifest: BotManifest): Record<string, { required: boolean; description?: string; default?: string; configKey?: string }> {
  if (!manifest.env) return {};

  const allowed: Record<string, { required: boolean; description?: string; default?: string; configKey?: string }> = {};

  for (const [key, config] of Object.entries(manifest.env)) {
    allowed[key] = {
      required: config.required ?? false,
      description: config.description,
      default: config.default,
      configKey: config.configKey,
    };
  }

  return allowed;
}

