/**
 * Zod-validated environment configuration.
 * Import `env` anywhere in the codebase — it fails fast at startup if a
 * required variable is missing or has the wrong type, so misconfiguration
 * is caught before the first request rather than mid-flight.
 */
import { z } from "zod";

const AbExperiment = z.object({
  control: z.string(),
  variant: z.string(),
  split: z.number().min(0).max(1),
});

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // ── Provider credentials ────────────────────────────────────────────────
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com/v1"),
  ANTHROPIC_VERSION: z.string().default("2023-06-01"),
  LOCAL_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  LOCAL_MODEL: z.string().default("llama3"),
  LOCAL_BASE_URL: z.string().url().default("http://localhost:11434/v1"),

  // ── Routing knobs ───────────────────────────────────────────────────────
  FORCE_MODEL: z.string().optional(),
  ALLOW_CLIENT_FORCE_MODEL: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  MAX_COST_PER_REQUEST: z.coerce.number().positive().default(0.05),
  FALLBACK_TO_CHEAPER_MODEL: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),
  DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),

  // ── Quality & classification ────────────────────────────────────────────
  ENABLE_QUALITY_RETRY: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),
  QUALITY_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5),
  ENABLE_META_CLASSIFIER: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  META_CLASSIFIER_MODEL: z.string().default("gpt-4.1-nano"),

  // ── Cache ───────────────────────────────────────────────────────────────
  CACHE_ENABLED: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),
  CACHE_TTL_SECONDS: z.coerce.number().positive().default(3600),
  REDIS_URL: z.string().optional(),

  // ── Queue ───────────────────────────────────────────────────────────────
  QUEUE_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // ── A/B experiments ─────────────────────────────────────────────────────
  /** JSON object of experiment configs, e.g. {"exp1":{"control":"gpt-4.1-nano","variant":"claude-haiku-4-5","split":0.1}} */
  AB_EXPERIMENTS: z
    .string()
    .default("{}")
    .transform((raw) => {
      try {
        return z.record(AbExperiment).parse(JSON.parse(raw));
      } catch {
        return {} as Record<string, z.infer<typeof AbExperiment>>;
      }
    }),

  // ── Server ──────────────────────────────────────────────────────────────
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
});

export type Env = z.infer<typeof schema>;

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "[ai-model-router] Invalid environment:\n",
    parsed.error.format(),
  );
  process.exit(1);
}

export const env: Env = parsed.data;

/** Which providers are active (have credentials). */
export const enabledProviders: Record<string, boolean> = {
  openai: Boolean(env.OPENAI_API_KEY),
  anthropic: Boolean(env.ANTHROPIC_API_KEY),
  local: env.LOCAL_ENABLED,
};
