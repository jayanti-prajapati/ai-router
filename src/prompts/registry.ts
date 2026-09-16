/**
 * Versioned prompt template registry.
 *
 * Templates are versioned: "code-review@1", "code-review@2", etc.
 * The highest version number for each id is treated as `latest`.
 * Old versions are never removed so telemetry rows remain comparable
 * across deployments.
 *
 * A template may pin complexity and/or temperature, bypassing the classifier.
 */
import type { Complexity } from '../core/types.js';

export interface PromptTemplate {
  id: string;
  version: number;
  system: string;
  /**
   * User message template. Use `{{task}}` and `{{input}}` as placeholders.
   * If omitted, the raw `input` from the request is used as-is.
   */
  user?: string;
  /** When set, the classifier is skipped entirely for this template. */
  pinnedComplexity?: Complexity;
  /** Override the default temperature for this template. */
  temperature?: number;
}

// ─── Template definitions ─────────────────────────────────────────────────

const TEMPLATES: PromptTemplate[] = [
  // ── default: pass-through, no pins ───────────────────────────────────────
  {
    id: 'default',
    version: 1,
    system: 'You are a helpful assistant. Respond concisely and accurately.',
  },

  // ── json-transform: always simple, zero temperature ───────────────────────
  {
    id: 'json-transform',
    version: 1,
    system: 'Output only valid JSON. No explanation, no markdown fences.',
    user: 'Convert the following to JSON:\n\n{{input}}',
    pinnedComplexity: 'simple',
    temperature: 0,
  },

  // ── code-review@1 (original) ──────────────────────────────────────────────
  {
    id: 'code-review',
    version: 1,
    system:
      'You are an expert code reviewer. Identify bugs, security issues, and ' +
      'opportunities to improve readability and performance. Be specific.',
    user: 'Review the following code:\n\n{{input}}',
    pinnedComplexity: 'complex',
  },

  // ── code-review@2 (structured output) ────────────────────────────────────
  {
    id: 'code-review',
    version: 2,
    system:
      'You are an expert code reviewer. Return a JSON object with keys: ' +
      '"summary" (string), "issues" (array of {severity, location, description}), ' +
      '"suggestions" (array of strings). No prose outside the JSON.',
    user: 'Review the following code and return structured JSON:\n\n{{input}}',
    pinnedComplexity: 'complex',
    temperature: 0,
  },

  // ── summarize ─────────────────────────────────────────────────────────────
  {
    id: 'summarize',
    version: 1,
    system: 'Summarize the following text in 3-5 bullet points. Be concise.',
    user: '{{input}}',
    pinnedComplexity: 'simple',
  },
];

// ─── Index ────────────────────────────────────────────────────────────────

/** Map: id → highest version number */
const latestVersion = new Map<string, number>();
for (const t of TEMPLATES) {
  const current = latestVersion.get(t.id) ?? 0;
  if (t.version > current) latestVersion.set(t.id, t.version);
}

/** Map: "id@version" → template */
const byRef = new Map<string, PromptTemplate>(TEMPLATES.map((t) => [`${t.id}@${t.version}`, t]));

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Look up a template. Accepts:
 *   - "code-review"    → latest version of "code-review"
 *   - "code-review@1"  → pinned to version 1
 *   - undefined        → the "default" template
 */
export function getPrompt(ref?: string): PromptTemplate {
  if (!ref) return byRef.get(`default@1`)!;
  const [id, vStr] = ref.split('@');
  if (!id) return byRef.get(`default@1`)!;
  const version = vStr ? parseInt(vStr, 10) : (latestVersion.get(id) ?? 1);
  const key = `${id}@${version}`;
  return byRef.get(key) ?? byRef.get(`default@1`)!;
}

/**
 * Render a template's user message, substituting `{{task}}` and `{{input}}`.
 * If the template has no `user` field, input is used verbatim.
 */
export function render(template: PromptTemplate, vars: { task: string; input: string }): string {
  const tpl = template.user ?? '{{input}}';
  return tpl.replace('{{task}}', vars.task).replace('{{input}}', vars.input);
}

/** Canonical string reference for a template, e.g. "code-review@2". */
export function promptRef(template: PromptTemplate): string {
  return `${template.id}@${template.version}`;
}

/** List all templates for the /ai/prompts endpoint. */
export function listPrompts(): Array<{ id: string; version: number; isLatest: boolean }> {
  return TEMPLATES.map((t) => ({
    id: t.id,
    version: t.version,
    isLatest: latestVersion.get(t.id) === t.version,
  }));
}
