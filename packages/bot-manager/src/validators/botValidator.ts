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
  const requiredEnv = manifest.env?.required ?? [];
  if (!requiredEnv.includes("BOT_TOKEN")) {
    return { ok: false, reason: "manifest.env.required must include BOT_TOKEN" };
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
