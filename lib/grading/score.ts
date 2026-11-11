import type { TruthSeverity, Verdict } from "@prisma/client";

// Deterministic rubric. Gemini only judges the free text (did they name the real
// defect, is the fix right); the points come from here so they are explainable.

export type Judgement = "yes" | "partial" | "no";

export type TextJudgement = {
  identifiedDefect: Judgement;
  fixCorrect: Judgement;
  genericAdvice: boolean;
};

export type HunkScore = {
  points: number;
  maxPoints: number;
  isFalsePositive: boolean;
  isMissedDefect: boolean;
  isCaught: boolean;
  outcome: "caught" | "partial" | "wrong-guess" | "missed" | "skipped" | "false-positive" | "trap-avoided" | "unanswered";
};

const DEFECT_POINTS: Record<"P0" | "P1" | "P2", number> = { P0: 10, P1: 6, P2: 3 };
const RANK = { P0: 0, P1: 1, P2: 2 } as const;

// Flagging correct code costs more the harder you tried to block the PR.
const FALSE_POSITIVE_PENALTY: Record<"P0" | "P1" | "P2", number> = { P0: -8, P1: -5, P2: -3 };
const TRAP_AVOIDED_POINTS = 3;
// Worse than a strategic skip (0): you flagged it, but for an invented reason.
const WRONG_GUESS_PENALTY = -2;

function isFlag(v: Verdict | null): v is "P0" | "P1" | "P2" {
  return v === "P0" || v === "P1" || v === "P2";
}

export function scoreHunk(truth: TruthSeverity, verdict: Verdict | null, text: TextJudgement | undefined): HunkScore {
  const base = { isFalsePositive: false, isMissedDefect: false, isCaught: false };

  // ── The hunk is fine (CLEAN or matches a brief policy) ──
  if (truth === "CLEAN" || truth === "INTENTIONAL") {
    const maxPoints = TRAP_AVOIDED_POINTS;
    if (verdict === "CLEAN_OR_INTENTIONAL") return { ...base, points: maxPoints, maxPoints, outcome: "trap-avoided" };
    if (isFlag(verdict)) {
      return { ...base, points: FALSE_POSITIVE_PENALTY[verdict], maxPoints, isFalsePositive: true, outcome: "false-positive" };
    }
    return { ...base, points: 0, maxPoints, outcome: verdict === "STRATEGIC_SKIP" ? "skipped" : "unanswered" };
  }

  // ── The hunk has a real defect ──
  const maxPoints = DEFECT_POINTS[truth];
  if (!isFlag(verdict)) {
    const outcome = verdict === "STRATEGIC_SKIP" ? "skipped" : verdict === null ? "unanswered" : "missed";
    return { ...base, points: 0, maxPoints, isMissedDefect: true, outcome };
  }

  if (!text || text.identifiedDefect === "no" || text.genericAdvice) {
    return { ...base, points: WRONG_GUESS_PENALTY, maxPoints, isMissedDefect: true, outcome: "wrong-guess" };
  }

  const distance = Math.abs(RANK[verdict] - RANK[truth]);
  const severityFactor = [1, 0.6, 0.3][distance];
  const defectFactor = text.identifiedDefect === "yes" ? 1 : 0.6;
  const fixFactor = { yes: 1, partial: 0.8, no: 0.6 }[text.fixCorrect];
  const points = Math.round(maxPoints * severityFactor * defectFactor * fixFactor * 10) / 10;
  const full = distance === 0 && text.identifiedDefect === "yes";

  return { ...base, points, maxPoints, isCaught: true, outcome: full ? "caught" : "partial" };
}
