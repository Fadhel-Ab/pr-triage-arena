import { NextResponse } from "next/server";
import { z } from "zod";
import { Domain, PacingMode, StackMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PACING } from "@/lib/arena/pacing";
import { GENERATION_MODEL, ScenarioGenerationError, generateScenario } from "@/lib/scenario/generate";
import { PROMPT_VERSION, lineCount } from "@/lib/scenario/spec";

// Generation with thinking + up to 3 repair turns can take ~30-90s.
export const maxDuration = 120;

const bodyZ = z.object({
  domain: z.nativeEnum(Domain),
  stackMode: z.nativeEnum(StackMode),
  pacing: z.nativeEnum(PacingMode),
});

export async function POST(request: Request) {
  const body = bodyZ.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid configuration", issues: body.error.issues }, { status: 400 });
  }

  const config = body.data;
  const pacing = PACING[config.pacing];

  let generated: Awaited<ReturnType<typeof generateScenario>>;
  try {
    generated = await generateScenario(config, AbortSignal.timeout(110_000));
  } catch (error) {
    console.error("generate-session failed", error);
    const details = error instanceof ScenarioGenerationError ? error.lastErrors : undefined;
    return NextResponse.json({ error: "Could not generate a valid scenario. Try again.", details }, { status: 502 });
  }

  const { scenario } = generated;

  const sessionId = await prisma.$transaction(async (tx) => {
    const session = await tx.session.create({
      data: {
        ...config,
        title: scenario.title,
        prSummary: scenario.prSummary,
        stackLabel: scenario.stackLabel,
        briefContext: scenario.brief.context,
        briefRules: scenario.brief.rules,
        briefPolicies: scenario.brief.policies,
        model: GENERATION_MODEL,
        promptVersion: PROMPT_VERSION,
        generationMs: generated.ms,
        generationTries: generated.tries,
        files: {
          create: scenario.files.map((file, fileOrder) => ({
            order: fileOrder,
            path: file.path,
            language: file.language,
            purpose: file.purpose,
            hunks: {
              create: file.hunks.map((hunk, hunkOrder) => ({
                order: hunkOrder,
                label: hunk.label,
                startLine: hunk.startLine,
                endLine: hunk.startLine + lineCount(hunk.code) - 1,
                code: hunk.code.replace(/\n+$/, ""),
                truth: {
                  create: {
                    severity: hunk.truth.severity,
                    category: hunk.truth.category,
                    defect: hunk.truth.defect,
                    blastRadius: hunk.truth.blastRadius,
                    canonicalFix: hunk.truth.canonicalFix,
                    evidenceLines: hunk.truth.evidenceLines,
                    policyId: hunk.truth.severity === "INTENTIONAL" ? hunk.truth.policyId : null,
                    decoyReason: hunk.truth.decoyReason,
                    graderNotes: hunk.truth.graderNotes,
                  },
                },
              })),
            },
          })),
        },
      },
      select: { id: true, files: { select: { id: true, order: true } } },
    });

    // Stage 0 = brief, stage n = file n-1
    await tx.sessionStage.createMany({
      data: [
        { sessionId: session.id, index: 0, kind: "BRIEF", durationSec: pacing.briefSec },
        ...session.files.map((f) => ({
          sessionId: session.id,
          index: f.order + 1,
          kind: "FILE" as const,
          fileId: f.id,
          durationSec: pacing.fileSec,
        })),
      ],
    });

    return session.id;
  });

  // Only the id goes back. The scenario (and its answer key) is never returned here.
  return NextResponse.json({ id: sessionId }, { status: 201 });
}
