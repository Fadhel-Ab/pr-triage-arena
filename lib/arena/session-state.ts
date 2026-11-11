import type { LockReason, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PACING, LOCK_GRACE_MS } from "./pacing";
import { highlight } from "./highlight";
import type { ArenaView } from "./types";

type Tx = Prisma.TransactionClient;

/**
 * Locks stage `fromIndex` and starts the next one, but only if the session is
 * still on `fromIndex`. The conditional update is the concurrency guard: if two
 * tabs (or a tab and the server's expiry sweep) race, exactly one wins.
 */
export async function lockAndAdvance(
  tx: Tx,
  sessionId: string,
  fromIndex: number,
  stageCount: number,
  opts: { reason: LockReason; lockedAt: Date; nextStartAt: Date; nextDurationSec?: number },
): Promise<boolean> {
  const isLast = fromIndex === stageCount - 1;

  const won = await tx.session.updateMany({
    where: { id: sessionId, currentStageIndex: fromIndex, status: "IN_PROGRESS" },
    data: {
      currentStageIndex: fromIndex + 1,
      ...(isLast ? { status: "SUBMITTED", submittedAt: opts.lockedAt } : {}),
    },
  });
  if (won.count === 0) return false;

  await tx.sessionStage.update({
    where: { sessionId_index: { sessionId, index: fromIndex } },
    data: { lockedAt: opts.lockedAt, lockReason: opts.reason },
  });

  if (!isLast && opts.nextDurationSec !== undefined) {
    await tx.sessionStage.update({
      where: { sessionId_index: { sessionId, index: fromIndex + 1 } },
      data: {
        startedAt: opts.nextStartAt,
        deadlineAt: new Date(opts.nextStartAt.getTime() + opts.nextDurationSec * 1000),
      },
    });
  }
  return true;
}

/**
 * If the user closed the tab, stages keep expiring like a real proctored exam.
 * Each expired stage is locked with no answers and the next one starts at the
 * previous deadline. Anything already saved for those hunks is left alone.
 */
export async function expireOverdueStages(tx: Tx, sessionId: string, now = new Date()) {
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    select: { status: true, currentStageIndex: true, stages: { orderBy: { index: "asc" } } },
  });
  if (!session || session.status !== "IN_PROGRESS") return;

  let index = session.currentStageIndex;
  const stages = session.stages;

  while (index < stages.length) {
    const stage = stages[index];
    // A stage started by a previous loop iteration has its deadline computed here.
    const deadline = stage.deadlineAt ?? new Date(0);
    if (now.getTime() <= deadline.getTime() + LOCK_GRACE_MS) break;

    const next = stages[index + 1];
    const won = await lockAndAdvance(tx, sessionId, index, stages.length, {
      reason: "EXPIRED",
      lockedAt: now,
      nextStartAt: deadline,
      nextDurationSec: next?.durationSec,
    });
    if (!won) break;

    await fillUnanswered(tx, sessionId, stage.fileId, now);
    if (next) next.deadlineAt = new Date(deadline.getTime() + next.durationSec * 1000);
    index++;
  }
}

/** Every hunk of a locked file gets a submission row, so "never answered" is explicit. */
export async function fillUnanswered(tx: Tx, sessionId: string, fileId: string | null, lockedAt: Date) {
  if (!fileId) return;
  const hunks = await tx.hunk.findMany({ where: { fileId }, select: { id: true } });
  await tx.userSubmission.createMany({
    data: hunks.map((h) => ({ sessionId, hunkId: h.id, verdict: null, lockedAt })),
    skipDuplicates: true, // keeps any real answers already written
  });
}

/** Loads the client-safe view. Runs the expiry sweep first so the view is never stale. */
export async function getArenaView(sessionId: string): Promise<ArenaView | null> {
  await prisma.$transaction((tx) => expireOverdueStages(tx, sessionId));

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      title: true,
      prSummary: true,
      stackLabel: true,
      pacing: true,
      briefContext: true,
      briefRules: true,
      briefPolicies: true,
      currentStageIndex: true,
      stages: { orderBy: { index: "asc" } },
      files: { orderBy: { order: "asc" }, select: { id: true, order: true, path: true, purpose: true } },
    },
  });
  if (!session) return null;

  const current = session.stages[session.currentStageIndex];
  const activeFileId = session.status === "IN_PROGRESS" ? (current?.fileId ?? null) : null;

  let activeFile: ArenaView["activeFile"] = null;
  if (activeFileId) {
    const file = await prisma.generatedFile.findUniqueOrThrow({
      where: { id: activeFileId },
      // Explicit select: `truth` is never loaded on this path.
      select: {
        id: true,
        path: true,
        language: true,
        hunks: {
          orderBy: { order: "asc" },
          select: { id: true, label: true, startLine: true, endLine: true, code: true },
        },
      },
    });
    activeFile = {
      id: file.id,
      path: file.path,
      hunks: await Promise.all(
        file.hunks.map(async ({ code, ...h }) => ({ ...h, html: await highlight(code, file.language) })),
      ),
    };
  }

  return {
    sessionId: session.id,
    status: session.status,
    serverNow: new Date().toISOString(),
    title: session.title,
    prSummary: session.prSummary,
    stackLabel: session.stackLabel,
    pacingLabel: PACING[session.pacing].label,
    brief: {
      context: session.briefContext,
      rules: session.briefRules,
      policies: session.briefPolicies as ArenaView["brief"]["policies"],
    },
    currentStageIndex: session.currentStageIndex,
    stages: session.stages.map((s) => ({
      index: s.index,
      kind: s.kind,
      durationSec: s.durationSec,
      fileId: s.fileId,
      startedAt: s.startedAt?.toISOString() ?? null,
      deadlineAt: s.deadlineAt?.toISOString() ?? null,
      lockedAt: s.lockedAt?.toISOString() ?? null,
    })),
    files: session.files.map((f) => {
      const stageIndex = f.order + 1;
      const state =
        stageIndex < session.currentStageIndex ? "locked" : stageIndex === session.currentStageIndex ? "active" : "upcoming";
      return { ...f, state };
    }),
    activeFile,
  };
}
