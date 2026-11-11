import { Prisma } from "@prisma/client";
import { ThinkingLevel, Type, type Schema } from "@google/genai";
import { z } from "zod";
import { GEMINI_MODEL, gemini } from "@/lib/gemini";
import { prisma } from "@/lib/prisma";
import { scoreHunk, type TextJudgement } from "./score";

const MAX_TRIES = 2;

const JUDGE_INSTRUCTION = `You grade a candidate's code-review answers against a hidden answer key.
Judge ONLY the candidate's free text. Do not judge their severity choice; that is scored separately.

For each hunk:
- identifiedDefect: "yes" if their defect summary names the same root cause as the key, "partial" if it is
  in the right area but vague or incomplete, "no" if it describes a different or invented problem.
  For hunks the key marks CLEAN or INTENTIONAL, answer "no" (there was nothing to find).
- fixCorrect: "yes" if their one-line fix would resolve the key's defect, "partial" if it points the right
  way but would not fully fix it, "no" otherwise (including empty).
- genericAdvice: true if the answer is boilerplate that would fit almost any code ("add try/catch",
  "add validation", "add logging", "memoize", "write tests") rather than this specific defect.
- feedback: 1-2 direct sentences to the candidate. Say what they got right or missed and cite line numbers.

summary: 2-3 sentences of coaching on the whole attempt: their biggest strength and the habit to fix first.`;

const judgeSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    judgements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          hunkId: { type: Type.STRING },
          identifiedDefect: { type: Type.STRING, enum: ["yes", "partial", "no"] },
          fixCorrect: { type: Type.STRING, enum: ["yes", "partial", "no"] },
          genericAdvice: { type: Type.BOOLEAN },
          feedback: { type: Type.STRING },
        },
        required: ["hunkId", "identifiedDefect", "fixCorrect", "genericAdvice", "feedback"],
        propertyOrdering: ["hunkId", "identifiedDefect", "fixCorrect", "genericAdvice", "feedback"],
      },
    },
    summary: { type: Type.STRING },
  },
  required: ["judgements", "summary"],
  propertyOrdering: ["judgements", "summary"],
};

const judgeZ = z.object({
  judgements: z.array(
    z.object({
      hunkId: z.string(),
      identifiedDefect: z.enum(["yes", "partial", "no"]),
      fixCorrect: z.enum(["yes", "partial", "no"]),
      genericAdvice: z.boolean(),
      feedback: z.string(),
    }),
  ),
  summary: z.string(),
});

type JudgeResult = z.infer<typeof judgeZ>;

function numbered(code: string, startLine: number): string {
  return code
    .split("\n")
    .map((line, i) => `${String(startLine + i).padStart(4)} | ${line}`)
    .join("\n");
}

async function judge(prompt: string, expectedIds: string[]): Promise<JudgeResult> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const response = await gemini().models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: JUDGE_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: judgeSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    try {
      const result = judgeZ.parse(JSON.parse(response.text ?? ""));
      const missing = expectedIds.filter((id) => !result.judgements.some((j) => j.hunkId === id));
      if (missing.length === 0) return result;
      lastError = `missing judgements for ${missing.length} hunks`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Grader returned an unusable response: ${lastError}`);
}

/**
 * Grades a SUBMITTED (or previously failed) session once. Safe to call
 * repeatedly: an existing report short-circuits, and the unique sessionId on
 * GradeReport stops two concurrent graders from both saving.
 */
export async function gradeSession(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      briefContext: true,
      briefPolicies: true,
      grade: { select: { id: true } },
      stages: true,
      files: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          path: true,
          hunks: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              label: true,
              startLine: true,
              code: true,
              truth: true,
              submissions: { where: { sessionId } },
            },
          },
        },
      },
    },
  });
  if (!session || session.grade) return;
  if (session.status !== "SUBMITTED" && session.status !== "GRADING_FAILED") return;

  const hunks = session.files.flatMap((f) =>
    f.hunks.map((h) => ({ ...h, path: f.path, submission: h.submissions[0] ?? null, truth: h.truth! })),
  );
  const answered = hunks.filter((h) => h.submission?.verdict);

  let judged: JudgeResult = { judgements: [], summary: "You didn't answer any hunks, so there was nothing to grade." };
  try {
    if (answered.length > 0) {
      const prompt = [
        `Brief:\n${session.briefContext}\nPolicies: ${JSON.stringify(session.briefPolicies)}`,
        ...answered.map((h) =>
          [
            `=== hunkId: ${h.id} (${h.label}, ${h.path}) ===`,
            numbered(h.code, h.startLine),
            `KEY: severity=${h.truth.severity}; defect=${h.truth.defect}; fix=${h.truth.canonicalFix}; notes=${h.truth.graderNotes}`,
            `CANDIDATE: verdict=${h.submission!.verdict}; defect="${h.submission!.defectSummary}"; blast radius="${h.submission!.blastRadius}"; fix="${h.submission!.oneLineFix}"`,
          ].join("\n"),
        ),
      ].join("\n\n");
      judged = await judge(prompt, answered.map((h) => h.id));
    }
  } catch (error) {
    await prisma.session.update({ where: { id: sessionId }, data: { status: "GRADING_FAILED" } });
    throw error;
  }

  const byHunk = new Map(judged.judgements.map((j) => [j.hunkId, j]));
  const scored = hunks.map((h) => {
    const j = byHunk.get(h.id);
    const text: TextJudgement | undefined = j && {
      identifiedDefect: j.identifiedDefect,
      fixCorrect: j.fixCorrect,
      genericAdvice: j.genericAdvice,
    };
    const score = scoreHunk(h.truth.severity, h.submission?.verdict ?? null, text);
    // Unanswered hunks get no AI feedback; the answer key on the results page explains them.
    return { hunk: h, score, feedback: j?.feedback ?? null };
  });

  // ── Aggregates ──
  const flagged = scored.filter((s) => ["P0", "P1", "P2"].includes(s.hunk.submission?.verdict ?? ""));
  const falsePositives = scored.filter((s) => s.score.isFalsePositive).length;
  const count = (sev: string, caught = false) =>
    scored.filter((s) => s.hunk.truth.severity === sev && (!caught || s.score.isCaught)).length;

  // Categories ranked by points lost, top 3
  const lost = new Map<string, number>();
  for (const s of scored) {
    const gap = s.score.maxPoints - s.score.points;
    if (gap > 0) lost.set(s.hunk.truth.category, (lost.get(s.hunk.truth.category) ?? 0) + gap);
  }
  const weakCategories = [...lost.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category);

  const seconds = (s: { startedAt: Date | null; lockedAt: Date | null }) =>
    s.startedAt && s.lockedAt ? Math.round((s.lockedAt.getTime() - s.startedAt.getTime()) / 1000) : 0;
  const briefStage = session.stages.find((s) => s.kind === "BRIEF");
  const secondsPerFile = Object.fromEntries(
    session.stages.filter((s) => s.fileId).map((s) => [s.fileId!, seconds(s)]),
  );

  try {
    await prisma.$transaction([
      ...scored.flatMap((s) =>
        s.hunk.submission
          ? [
              prisma.userSubmission.update({
                where: { id: s.hunk.submission.id },
                data: {
                  points: s.score.points,
                  isFalsePositive: s.score.isFalsePositive,
                  isMissedDefect: s.score.isMissedDefect,
                  graderFeedback: s.feedback,
                },
              }),
            ]
          : [],
      ),
      prisma.gradeReport.create({
        data: {
          sessionId,
          totalScore: Math.round(scored.reduce((sum, s) => sum + s.score.points, 0) * 10) / 10,
          maxScore: scored.reduce((sum, s) => sum + s.score.maxPoints, 0),
          p0Caught: count("P0", true),
          p0Total: count("P0"),
          p1Caught: count("P1", true),
          p1Total: count("P1"),
          falsePositives,
          falsePositiveRate: flagged.length ? falsePositives / flagged.length : 0,
          answeredCount: scored.filter((s) => s.hunk.submission?.verdict && s.hunk.submission.verdict !== "STRATEGIC_SKIP").length,
          skippedCount: scored.filter((s) => s.hunk.submission?.verdict === "STRATEGIC_SKIP").length,
          unansweredCount: scored.filter((s) => !s.hunk.submission?.verdict).length,
          briefSeconds: briefStage ? seconds(briefStage) : 0,
          secondsPerFile,
          weakCategories,
          summary: judged.summary,
          graderModel: GEMINI_MODEL,
        },
      }),
      prisma.session.update({ where: { id: sessionId }, data: { status: "GRADED" } }),
    ]);
  } catch (error) {
    // Another request graded it first; their report stands.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}
