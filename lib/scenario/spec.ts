import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import type { Domain, PacingMode, StackMode } from "@prisma/client";
import { PACING, type PacingConfig } from "@/lib/arena/pacing";

export const PROMPT_VERSION = "gen-v1";

// ───────────────────────── Allowed values ─────────────────────────

// Shiki language ids. Constraining these means highlighting never throws.
export const LANGUAGES = ["typescript", "tsx", "javascript", "sql", "prisma", "dart", "json", "yaml"] as const;

export const SEVERITIES = ["P0", "P1", "P2", "INTENTIONAL", "CLEAN"] as const;

// Fixed list so "weak categories" can be aggregated across attempts.
export const CATEGORIES = [
  "tenant-isolation",
  "authorization",
  "authentication",
  "injection",
  "data-integrity",
  "race-condition",
  "idempotency",
  "transaction-boundary",
  "validation",
  "error-handling",
  "async-lifecycle",
  "state-management",
  "caching",
  "pagination",
  "performance",
  "api-contract",
  "privacy-logging",
  "migration-safety",
] as const;

// ───────────────────────── Gemini response schema ─────────────────────────
// Note: the SDK types minItems/maxItems as strings. These are hints to the
// model; the Zod validator below is the real gate.

const truthSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    severity: { type: Type.STRING, enum: [...SEVERITIES] },
    category: {
      type: Type.STRING,
      enum: [...CATEGORIES],
      description: "For CLEAN/INTENTIONAL: the category a skimming reviewer would WRONGLY flag it under.",
    },
    defect: { type: Type.STRING, description: "What is actually wrong. For CLEAN/INTENTIONAL write 'none'." },
    blastRadius: { type: Type.STRING, description: "Who/what is affected in production and how badly. 'none' if CLEAN/INTENTIONAL." },
    canonicalFix: { type: Type.STRING, description: "The single best one-line fix. 'none' if CLEAN/INTENTIONAL." },
    evidenceLines: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
      minItems: "1",
      description: "Absolute line numbers (between startLine and the hunk's last line) that prove the verdict.",
    },
    policyId: {
      type: Type.STRING,
      nullable: true,
      description: "Required when severity is INTENTIONAL: the id of the brief policy this hunk implements. Otherwise null.",
    },
    decoyReason: {
      type: Type.STRING,
      nullable: true,
      description: "For CLEAN/INTENTIONAL: why a hurried reviewer would flag it. Otherwise null.",
    },
    graderNotes: {
      type: Type.STRING,
      description: "What a correct answer must mention, plus the generic advice that should earn zero for this hunk.",
    },
  },
  required: ["severity", "category", "defect", "blastRadius", "canonicalFix", "evidenceLines", "policyId", "decoyReason", "graderNotes"],
  propertyOrdering: ["severity", "category", "defect", "blastRadius", "canonicalFix", "evidenceLines", "policyId", "decoyReason", "graderNotes"],
};

const hunkSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING, description: "HUNK A, HUNK B, ... continuing across files." },
    startLine: { type: Type.INTEGER, description: "Line number of the first line of `code` in the real file." },
    code: { type: Type.STRING, description: "6-30 lines of source. No line numbers. No diff +/- markers." },
    truth: truthSchema,
  },
  required: ["label", "startLine", "code", "truth"],
  // Code before truth: the model writes the code, then grades it.
  propertyOrdering: ["label", "startLine", "code", "truth"],
};

export const scenarioResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "PR title as the junior dev wrote it, e.g. 'feat(invoices): bulk export endpoint'." },
    stackLabel: { type: Type.STRING, description: "e.g. 'Fastify + Drizzle + PostgreSQL'." },
    prSummary: { type: Type.STRING, description: "The junior dev's PR description, 2-4 sentences, confident tone." },
    brief: {
      type: Type.OBJECT,
      properties: {
        context: { type: Type.STRING, description: "Business context, 80-150 words." },
        rules: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          minItems: "3",
          maxItems: "6",
          description: "Tenant, security and data rules the code must obey. One rule per entry.",
        },
        policies: {
          type: Type.ARRAY,
          minItems: "1",
          maxItems: "2",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "POL-1, POL-2" },
              rule: { type: Type.STRING, description: "A deliberate, slightly odd product decision." },
              rationale: { type: Type.STRING, description: "The business reason, one sentence." },
            },
            required: ["id", "rule", "rationale"],
            propertyOrdering: ["id", "rule", "rationale"],
          },
        },
      },
      required: ["context", "rules", "policies"],
      propertyOrdering: ["context", "rules", "policies"],
    },
    files: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          language: { type: Type.STRING, enum: [...LANGUAGES] },
          purpose: { type: Type.STRING, description: "One line: what this file does in the PR." },
          hunks: { type: Type.ARRAY, items: hunkSchema },
        },
        required: ["path", "language", "purpose", "hunks"],
        propertyOrdering: ["path", "language", "purpose", "hunks"],
      },
    },
  },
  required: ["title", "stackLabel", "prSummary", "brief", "files"],
  propertyOrdering: ["title", "stackLabel", "prSummary", "brief", "files"],
};

// ───────────────────────── Prompt ─────────────────────────

const DOMAIN_FOCUS: Record<Domain, string> = {
  FULL_STACK:
    "server actions / route handlers trusting client-sent ids, cache revalidation that leaks across tenants, optimistic UI that is never rolled back, check-then-write races spanning client and server.",
  BACKEND_API:
    "a tenant filter present on one query but missing on its sibling, non-idempotent webhook or retry handling, wrong transaction boundaries, cursor pagination that skips or repeats rows, guard/middleware ordering, wrong status codes that break clients.",
  FRONTEND_STATE_UI:
    "out-of-order responses when filters change quickly, stale closures in effects, double submit, derived state copied into state, list keys that break on reorder, subscriptions/timers never cleaned up, permission checks done only in the UI.",
  DATABASE_SECURITY:
    "row-level-security policies with a wrong OR, raw SQL built with string interpolation, missing unique constraint enabling duplicates, soft-deleted rows not filtered, IDOR through guessable ids, migrations that lock a hot table, timezone/date boundary bugs.",
  MOBILE_FLUTTER:
    "setState / BuildContext used across an async gap, unawaited futures, tokens in SharedPreferences, offline queue replay creating duplicates, rebuild loops, a Dart client trusting a server field it should verify (include one backend file the app talks to).",
};

const STACKS: Record<StackMode, string> = {
  CORE: "Pick from the user's core stack: Next.js App Router (route handlers, server actions), NestJS (guards, pipes, DTOs), Express middleware, Prisma ORM, PostgreSQL. For the Mobile domain use Flutter + Riverpod against a NestJS or Next.js API.",
  CURVEBALL:
    "Use a stack the user does NOT know well, so they must read unfamiliar syntax: pick a coherent combination from Supabase (supabase-js + RLS SQL policies), Drizzle ORM, tRPC routers/procedures, Fastify (hooks, route schemas), Hono, Kysely. For the Mobile domain use Flutter + supabase_flutter or drift. Use each SDK's real, current API.",
};

// Server-side randomness so repeated runs don't converge on the same scenario.
const BUSINESSES = [
  "B2B invoicing for agencies",
  "multi-clinic appointment scheduling",
  "freight dispatch and proof-of-delivery",
  "school LMS with parent accounts",
  "payroll for hourly shift workers",
  "marketplace seller payouts",
  "IoT fleet telemetry for rental scooters",
  "property management maintenance tickets",
  "event ticketing with resale",
  "internal expense approvals",
];

export function pickBusiness(): string {
  return BUSINESSES[Math.floor(Math.random() * BUSINESSES.length)];
}

export const SYSTEM_INSTRUCTION = `You are a staff engineer who writes realistic code-review assessments for senior hiring loops.
You produce a single pull request written by a capable but rushed junior developer, plus a hidden answer key.

Quality bar:
- The code must look like real production code from a real repo: real imports, real SDK calls, plausible names, consistent types across files.
- Defects must be SUBTLE and PROVABLE. A strong reviewer can point at specific lines and explain the production impact using only the code and the brief. No defect may depend on information that is not shown.
- Never telegraph. Do not write comments that mention bugs, TODO, FIXME, HACK, "intentional", "deliberate", "on purpose", "insecure", "vulnerable" or "race". Comments, if any, are what the junior would write (often explaining the happy path).
- Avoid cartoon bugs (hard-coded passwords, eval, SELECT * FROM users WHERE 1=1, obvious typos). Prefer bugs that pass a quick skim and pass type-checking.
- Each hunk has exactly ONE primary finding. Its severity is the most severe issue in it. Do not stack several unrelated bugs in one hunk.

Severity definitions:
- P0: ship-blocking. Cross-tenant data exposure, auth bypass, data loss/corruption, money moved wrongly, irreversible damage.
- P1: must fix this sprint. Wrong behaviour users will hit, but contained or recoverable.
- P2: backlog. Real but low impact: inefficiency at current scale, misleading naming, minor contract wart.
- INTENTIONAL: the code looks wrong to a skimmer but EXACTLY implements a policy stated in the brief. The hunk must be correct given the policy and must reference nothing that hints at the policy.
- CLEAN: correct code. Make CLEAN hunks decoys: include a pattern that tempts reflexive review comments (a non-null assertion that is guarded earlier, no try/catch because a framework error filter handles it, findFirst without orderBy where a unique constraint guarantees one row, an un-memoized computation that is trivially cheap).

Deliberate policy quirks (brief.policies): invent a business rule that sounds odd but is defensible, e.g. "cross-tenant lookups return 404, never 403, so tenant existence is not leaked", "deleted invoices stay readable by finance admins for 30 days", "rate limits are per organisation, not per user", "prices are stored as integer cents but the export API returns decimal strings". Invent a NEW one that fits the business; do not reuse these examples.

Line numbers: hunks are excerpts of a larger file. startLine values are realistic (imports occupy the top, so the first hunk rarely starts at 1). Within one file, hunks are in increasing order and do not overlap; leave gaps between them. evidenceLines are absolute line numbers inside their own hunk.

Grader notes: for every hunk, say what a correct answer must mention, and list generic advice that must earn zero (e.g. "add try/catch", "add logging", "memoize", "add tests", "use TypeScript types") when it does not address the actual finding.`;

export type ScenarioRequest = { domain: Domain; stackMode: StackMode; pacing: PacingMode };

export function buildUserPrompt(req: ScenarioRequest, business: string): string {
  const p = PACING[req.pacing];
  const mix = Object.entries(p.minMix)
    .map(([sev, n]) => `at least ${n} × ${sev}`)
    .join(", ");

  return `Generate one PR review scenario.

Business: ${business}
Domain focus: ${req.domain} — favour defects like: ${DOMAIN_FOCUS[req.domain]}
Stack: ${STACKS[req.stackMode]}

Shape (hard requirements):
- Exactly ${p.fileCount} files, each with ${p.hunksPerFile.min}-${p.hunksPerFile.max} hunks; ${p.totalHunks.min}-${p.totalHunks.max} hunks in total.
- Label hunks HUNK A, HUNK B, HUNK C ... in order across all files.
- Severity mix: ${mix}; at most ${p.maxP0} × P0. Spread severities across files; do not put every P0 in the first file.
- Every INTENTIONAL hunk sets policyId to a policy id from brief.policies, and every policy is implemented by at least one INTENTIONAL hunk.
- The files must belong to ONE coherent feature PR (e.g. a route + its service + its schema/migration + a client component), sharing names and types.`;
}

// ───────────────────────── Validation ─────────────────────────

const truthZ = z.object({
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  defect: z.string().min(1),
  blastRadius: z.string().min(1),
  canonicalFix: z.string().min(1),
  evidenceLines: z.array(z.number().int()).min(1),
  policyId: z.string().nullable(),
  decoyReason: z.string().nullable(),
  graderNotes: z.string().min(1),
});

const scenarioZ = z.object({
  title: z.string().min(1).max(200),
  stackLabel: z.string().min(1).max(120),
  prSummary: z.string().min(1),
  brief: z.object({
    context: z.string().min(1),
    rules: z.array(z.string().min(1)).min(1),
    policies: z.array(z.object({ id: z.string().min(1), rule: z.string().min(1), rationale: z.string().min(1) })).min(1),
  }),
  files: z.array(
    z.object({
      path: z.string().min(1),
      language: z.enum(LANGUAGES),
      purpose: z.string().min(1),
      hunks: z.array(
        z.object({
          label: z.string(),
          startLine: z.number().int().min(1),
          code: z.string().min(1),
          truth: truthZ,
        }),
      ),
    }),
  ),
});

export type Scenario = z.infer<typeof scenarioZ>;

const TELEGRAPH = /\b(bug|fixme|todo|hack|xxx|intentional(ly)?|deliberate(ly)?|on purpose|insecure|vulnerab\w*|race condition)\b/i;
const COMMENT = /(\/\/|\/\*|^\s*\*|--|#)/;

export function lineCount(code: string): number {
  return code.replace(/\n+$/, "").split("\n").length;
}

function hunkLabel(i: number): string {
  return `HUNK ${String.fromCharCode(65 + i)}`; // max 14 hunks, so A..N
}

// Returns the parsed scenario or a list of human-readable problems
// that are fed back to the model on retry.
export function validateScenario(
  raw: unknown,
  pacing: PacingConfig,
): { ok: true; scenario: Scenario } | { ok: false; errors: string[] } {
  const parsed = scenarioZ.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 15).map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const s = parsed.data;
  const errors: string[] = [];
  const allHunks = s.files.flatMap((f) => f.hunks);
  const policyIds = new Set(s.brief.policies.map((p) => p.id));

  if (s.files.length !== pacing.fileCount) errors.push(`Expected exactly ${pacing.fileCount} files, got ${s.files.length}.`);
  if (new Set(s.files.map((f) => f.path)).size !== s.files.length) errors.push("File paths must be unique.");
  if (allHunks.length < pacing.totalHunks.min || allHunks.length > pacing.totalHunks.max) {
    errors.push(`Expected ${pacing.totalHunks.min}-${pacing.totalHunks.max} hunks in total, got ${allHunks.length}.`);
  }

  let labelIndex = 0;
  for (const file of s.files) {
    const { min, max } = pacing.hunksPerFile;
    if (file.hunks.length < min || file.hunks.length > max) {
      errors.push(`${file.path}: expected ${min}-${max} hunks, got ${file.hunks.length}.`);
    }

    let prevEnd = 0;
    for (const hunk of file.hunks) {
      const expected = hunkLabel(labelIndex++);
      const lines = lineCount(hunk.code);
      const end = hunk.startLine + lines - 1;
      const where = `${file.path} ${hunk.label}`;

      if (hunk.label !== expected) errors.push(`${where}: label should be "${expected}".`);
      // Lenient gate: the prompt asks for 6-30, we only reject clear misses.
      if (lines < 4 || lines > 40) errors.push(`${where}: has ${lines} lines, expected 6-30.`);
      if (hunk.startLine <= prevEnd) errors.push(`${where}: startLine ${hunk.startLine} overlaps the previous hunk (ends at ${prevEnd}).`);
      prevEnd = end;

      const outOfRange = hunk.truth.evidenceLines.filter((n) => n < hunk.startLine || n > end);
      if (outOfRange.length) {
        errors.push(`${where}: evidenceLines ${outOfRange.join(", ")} are outside the hunk's lines ${hunk.startLine}-${end}.`);
      }

      const telegraph = hunk.code.split("\n").find((l) => COMMENT.test(l) && TELEGRAPH.test(l));
      if (telegraph) errors.push(`${where}: a comment gives the answer away: "${telegraph.trim()}". Rewrite it.`);

      if (hunk.truth.severity === "INTENTIONAL" && !policyIds.has(hunk.truth.policyId ?? "")) {
        errors.push(`${where}: INTENTIONAL hunk must set policyId to one of ${[...policyIds].join(", ")}.`);
      }
    }
  }

  const counts = Object.fromEntries(SEVERITIES.map((sev) => [sev, allHunks.filter((h) => h.truth.severity === sev).length]));
  for (const [sev, min] of Object.entries(pacing.minMix)) {
    if (counts[sev] < min) errors.push(`Need at least ${min} × ${sev}, got ${counts[sev]}.`);
  }
  if (counts.P0 > pacing.maxP0) errors.push(`At most ${pacing.maxP0} × P0, got ${counts.P0}.`);

  const implemented = new Set(allHunks.map((h) => h.truth.policyId).filter(Boolean));
  for (const id of policyIds) {
    if (!implemented.has(id)) errors.push(`Policy ${id} is not implemented by any INTENTIONAL hunk.`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, scenario: s };
}
