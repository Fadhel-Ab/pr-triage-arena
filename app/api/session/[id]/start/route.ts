import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getArenaView } from "@/lib/arena/session-state";

// Starts the clock on stage 0 (brief reading). Idempotent: calling it again
// on a started session just returns the current view.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const started = await tx.session.updateMany({
      where: { id, status: "READY", currentStageIndex: -1 },
      data: { status: "IN_PROGRESS", currentStageIndex: 0, startedAt: now },
    });
    if (started.count === 0) return;

    const brief = await tx.sessionStage.findUniqueOrThrow({ where: { sessionId_index: { sessionId: id, index: 0 } } });
    await tx.sessionStage.update({
      where: { id: brief.id },
      data: { startedAt: now, deadlineAt: new Date(now.getTime() + brief.durationSec * 1000) },
    });
  });

  const view = await getArenaView(id);
  if (!view) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ view });
}
