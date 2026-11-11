import type { PacingMode, TruthSeverity } from "@prisma/client";

export type PacingConfig = {
  label: string;
  fileCount: number;
  briefSec: number;
  fileSec: number;
  hunksPerFile: { min: number; max: number };
  totalHunks: { min: number; max: number };
  // Minimum number of hunks per ground-truth severity
  minMix: Partial<Record<TruthSeverity, number>>;
  maxP0: number;
};

// Sprint:  3 min brief + 2 × 6 min    = 15 min
// Full:    3 min brief + 4 × 8:45 min = 38 min
export const PACING: Record<PacingMode, PacingConfig> = {
  SPRINT: {
    label: "Sprint · 15 min · 2 files",
    fileCount: 2,
    briefSec: 180,
    fileSec: 360,
    hunksPerFile: { min: 2, max: 3 },
    totalHunks: { min: 4, max: 6 },
    minMix: { P0: 1, P1: 1, INTENTIONAL: 1, CLEAN: 1 },
    maxP0: 2,
  },
  FULL_SIMULATION: {
    label: "Full Simulation · 38 min · 4 files",
    fileCount: 4,
    briefSec: 180,
    fileSec: 525,
    hunksPerFile: { min: 2, max: 4 },
    totalHunks: { min: 10, max: 14 },
    minMix: { P0: 2, P1: 2, P2: 1, INTENTIONAL: 1, CLEAN: 2 },
    maxP0: 3,
  },
};

// Submissions arriving this long after the deadline are still accepted,
// so network latency on an auto-lock doesn't throw away the user's answers.
export const LOCK_GRACE_MS = 10_000;

export const WORD_CAP = 40;
export const FIELD_CHAR_CAP = 320; // stops one 2,000-char "word" slipping past the word cap
