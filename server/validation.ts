import "server-only";
import { z } from "zod";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RunConfig } from "@/lib/types";

const scopeSchema = z.object({
  ui: z.boolean(),
  ux: z.boolean(),
  api: z.boolean(),
});

const runConfigSchema = z
  .object({
    projectPath: z.string().min(1),
    mode: z.enum(["auto-start", "url"]),
    url: z.string().url().optional(),
    scope: scopeSchema,
    saveMode: z.enum(["ephemeral", "project"]),
    saveDir: z.string().optional(),
  })
  .refine((c) => c.mode !== "url" || !!c.url, {
    message: "url is required when mode is 'url'",
    path: ["url"],
  })
  .refine((c) => c.scope.ui || c.scope.ux || c.scope.api, {
    message: "At least one scope (ui/ux/api) must be enabled",
    path: ["scope"],
  });

export interface ValidationResult {
  ok: boolean;
  config?: RunConfig;
  error?: string;
}

export function validateRunConfig(input: unknown): ValidationResult {
  const parsed = runConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const config = parsed.data as RunConfig;

  if (!existsSync(config.projectPath)) {
    return { ok: false, error: `Project path does not exist: ${config.projectPath}` };
  }
  if (!existsSync(join(config.projectPath, "package.json"))) {
    return { ok: false, error: "Selected folder has no package.json (not a Node project)." };
  }
  return { ok: true, config };
}
