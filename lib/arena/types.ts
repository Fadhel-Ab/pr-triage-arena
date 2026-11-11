// Client-safe view of a session. Contains no ground truth, and only the
// active file's code (upcoming files aren't sent, so DevTools can't peek).

export type VerdictValue = "P0" | "P1" | "P2" | "CLEAN_OR_INTENTIONAL" | "STRATEGIC_SKIP";

export type ArenaHunk = {
  id: string;
  label: string;
  startLine: number;
  endLine: number;
  html: string; // shiki output, generated on the server
};

export type ArenaStage = {
  index: number;
  kind: "BRIEF" | "FILE";
  durationSec: number;
  fileId: string | null;
  startedAt: string | null;
  deadlineAt: string | null;
  lockedAt: string | null;
};

export type ArenaFile = {
  id: string;
  order: number;
  path: string;
  purpose: string;
  state: "locked" | "active" | "upcoming";
};

export type ArenaView = {
  sessionId: string;
  status: "READY" | "IN_PROGRESS" | "SUBMITTED" | "GRADED" | "GRADING_FAILED";
  serverNow: string; // lets the client correct for clock skew
  title: string;
  prSummary: string;
  stackLabel: string;
  pacingLabel: string;
  brief: {
    context: string;
    rules: string[];
    policies: { id: string; rule: string; rationale: string }[];
  };
  currentStageIndex: number; // -1 before start, stages.length when finished
  stages: ArenaStage[];
  files: ArenaFile[];
  activeFile: { id: string; path: string; hunks: ArenaHunk[] } | null;
};

export type Draft = {
  verdict: VerdictValue | null;
  defectSummary: string;
  blastRadius: string;
  oneLineFix: string;
};

export type TelemetryInput = {
  type: "BRIEF_TOGGLED" | "HUNK_FOCUSED" | "VERDICT_CHANGED" | "WORD_CAP_HIT" | "TAB_HIDDEN" | "TAB_VISIBLE";
  stageIndex: number;
  hunkId?: string;
  payload?: Record<string, string | number | boolean | null>;
  clientAt: string;
};

export type ArenaErrorCode = "STALE_STAGE" | "LATE" | "NOT_IN_PROGRESS";
