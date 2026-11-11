import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, TelemetryType, Verdict } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FIELD_CHAR_CAP, LOCK_GRACE_MS, WORD_CAP } from "@/lib/arena/pacing";
import { fillUnanswered, getArenaView, lockAndAdvance } from "@/lib/arena/session-state";
import type { ArenaErrorCode } from "@/lib/arena/types";
import { countWords } from "@/lib/word-cap";

// Same 40-word rule as the textarea. The client cap is for UX; this one is the rule.
const cappedText = z
  .string()
  .max(FIELD_CHAR_CAP)
  .refine((s) => countWords(s) <= WORD_CAP, `Max ${WORD_CAP} words`)
  .transform((s) => s.trim());

const bodyZ = z.object({
  stageIndex: z.number().int().min(0),
  answers: z
    .array(
      z.object({
        hunkId: z.string(),
        verdict: z.nativeEnum(Verdict).nullable(),
        defectSummary: cappedText,
        blastRadius: cappedText,
        oneLineFix: cappedText,
      }),
    )
    .max(10),
  telemetry: z
    .array(
      z.object({
        type: z.nativeEnum(TelemetryType),
        stageIndex: z.number().int(),
        hunkId: z.string().optional(),
        payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
        clientAt: z.string().datetime(),
      }),
    )
    .max(500),
});

class LockConflict extends Error {
  constructor(readonly code: ArenaErrorCode) {
    super(code);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = bodyZ.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid submission", issues: body.error.issues }, { status: 400 });
  }
  const { stageIndex, answers, telemetry } = body.data;
  const now = new Date();

  let conflict: ArenaErrorCode | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { id },
        select: { status: true, currentStageIndex: true, stages: { orderBy: { index: "asc" } } },
      });
      if (!session || session.status !== "IN_PROGRESS") throw new LockConflict("NOT_IN_PROGRESS");
      // Forward-only: you can only lock the stage you're on. Older tabs get the fresh view.
      if (stageIndex !== session.currentStageIndex) throw new LockConflict("STALE_STAGE");

      const stage = session.stages[stageIndex];
      const deadline = stage.deadlineAt!.getTime();
      if (now.getTime() > deadline + LOCK_GRACE_MS) throw new LockConflict("LATE");

      const next = session.stages[stageIndex + 1];
      const won = await lockAndAdvance(tx, id, stageIndex, session.stages.length, {
        reason: now.getTime() >= deadline ? "TIMEOUT" : "MANUAL",
        lockedAt: now,
        nextStartAt: now,
        nextDurationSec: next?.durationSec,
      });
      if (!won) throw new LockConflict("STALE_STAGE");

      if (stage.fileId) {
        // Only accept answers for hunks that belong to the stage being locked.
        const hunkIds = new Set(
          (await tx.hunk.findMany({ where: { fileId: stage.fileId }, select: { id: true } })).map((h) => h.id),
        );
        const valid = answers.filter((a) => hunkIds.has(a.hunkId));
        await tx.userSubmission.createMany({
          data: valid.map((a) => ({ sessionId: id, lockedAt: now, ...a })),
          skipDuplicates: true,
        });
        await fillUnanswered(tx, id, stage.fileId, now);
      }
    });
  } catch (error) {
    if (!(error instanceof LockConflict)) throw error;
    conflict = error.code;
  }

  // getArenaView runs the expiry sweep, so a LATE stage gets locked here.
  const view = await getArenaView(id);
  if (!view) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  // Outside the transaction so telemetry is kept even when the lock is rejected.
  if (telemetry.length) {
    await prisma.telemetryEvent.createMany({
      data: telemetry.map((e) => ({
        sessionId: id,
        type: e.type,
        stageIndex: e.stageIndex,
        hunkId: e.hunkId,
        payload: e.payload ?? Prisma.JsonNull,
        clientAt: new Date(e.clientAt),
      })),
    });
  }

  if (conflict) return NextResponse.json({ error: conflict, view }, { status: 409 });
  return NextResponse.json({ view });
}
