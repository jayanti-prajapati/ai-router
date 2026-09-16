# Changelog

All notable changes to `smart-ai-router` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [SemVer](https://semver.org/)

## [Unreleased]

## [1.0.1] - 2026-09-16

### Changed

- Renamed package from `@ai/router` to `smart-ai-router`
- Updated all documentation and import examples to use `smart-ai-router`

## [1.0.0] - 2026-09-16

### Added

- Weighted heuristic complexity classifier (simple / medium / complex) — free, ~1ms, no model call
- Optional meta-model classifier for ambiguous prompts (`ENABLE_META_CLASSIFIER=true`)
- Priority-aware routing: `speed` (downgrade tier), `balanced` (quality per dollar), `quality` (upgrade tier)
- Per-request cost guard with configurable ceiling (`MAX_COST_PER_REQUEST`) and fallback-to-cheaper-model
- Output quality scorer: detects empty responses, truncation, refusals, repetition loops, bad JSON
- Quality-based escalation: automatically retries with a stronger model on low quality scores
- OpenAI Chat Completions provider (also compatible with Azure, OpenRouter, Together, Groq)
- Anthropic Messages API provider
- Local model provider (Ollama, vLLM, LM Studio) at zero cost
- Extensible provider registry — add a vendor in one file, zero changes elsewhere
- Redis + in-process LRU cache keyed on SHA-256 of prompt + task + priority
- Versioned prompt template registry with complexity pinning and temperature override
- Deterministic FNV-1a A/B experiment bucketing — same request always lands in the same arm
- BullMQ async job queue (optional, requires Redis)
- Structured telemetry with pluggable sink for database writes
- Daily budget circuit breaker — degrades to cheapest tier instead of hard failure
- Fastify HTTP server with `/ai/run`, `/ai/jobs/:id`, `/ai/models`, `/ai/prompts`, `/ai/metrics`, `/health`
- Full TypeScript types, declaration files, and source maps
- Zod-validated environment configuration with fail-fast startup
