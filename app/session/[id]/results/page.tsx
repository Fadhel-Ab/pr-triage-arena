import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, CircleAlert, MinusCircle, XCircle } from "lucide-react";
import type { TruthSeverity, Verdict } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { highlight } from "@/lib/arena/highlight";
import { gradeSession } from "@/lib/grading/grade-session";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // first visit runs the grader

const VERDICT_LABEL: Record<Verdict, string> = {
  P0: "P0 · Ship-blocking",
  P1: "P1 · This sprint",
  P2: "P2 · Backlog",
  CLEAN_OR_INTENTIONAL: "Clean / Intentional",
  STRATEGIC_SKIP: "N/A · Strategic skip",
};

const TRUTH_LABEL: Record<TruthSeverity, string> = {
  P0: "P0 · Ship-blocking",
  P1: "P1 · This sprint",
  P2: "P2 · Backlog",
  INTENTIONAL: "Intentional (brief policy)",
  CLEAN: "Clean",
};

// Status colors always come with an icon and a text label, never color alone.
const OUTCOMES = {
  caught: { label: "Caught", tone: "border-emerald-500/50 text-emerald-300", Icon: CheckCircle2 },
  "trap-avoided": { label: "Trap avoided", tone: "border-emerald-500/50 text-emerald-300", Icon: CheckCircle2 },
  partial: { label: "Partial", tone: "border-amber-500/50 text-amber-300", Icon: CircleAlert },
  "wrong-guess": { label: "Wrong guess", tone: "border-red-500/50 text-red-300", Icon: XCircle },
  missed: { label: "Missed", tone: "border-red-500/50 text-red-300", Icon: XCircle },
  "false-positive": { label: "False positive", tone: "border-red-500/50 text-red-300", Icon: XCircle },
  skipped: { label: "Skipped", tone: "border-border text-muted-foreground", Icon: MinusCircle },
  unanswered: { label: "Unanswered", tone: "border-border text-muted-foreground", Icon: MinusCircle },
} as const;

const MAX_POINTS: Record<TruthSeverity, number> = { P0: 10, P1: 6, P2: 3, INTENTIONAL: 3, CLEAN: 3 };

function outcomeOf(truth: TruthSeverity, verdict: Verdict | null, points: number, falsePositive: boolean): keyof typeof OUTCOMES {
  if (verdict === null) return "unanswered";
  if (verdict === "STRATEGIC_SKIP") return "skipped";
  if (truth === "CLEAN" || truth === "INTENTIONAL") return falsePositive ? "false-positive" : "trap-avoided";
  if (verdict === "CLEAN_OR_INTENTIONAL") return "missed";
  if (points < 0) return "wrong-guess";
  return points >= MAX_POINTS[truth] ? "caught" : "partial";
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const status = await prisma.session.findUnique({ where: { id }, select: { status: true } });
  if (!status) notFound();
  if (status.status === "READY" || status.status === "IN_PROGRESS") redirect(`/session/${id}`);

  if (status.status !== "GRADED") {
    try {
      await gradeSession(id);
    } catch (error) {
      console.error("grading failed", error);
      return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
          <h1 className="text-xl font-semibold">Grading failed</h1>
          <p className="text-sm text-muted-foreground">
            Your answers are saved. The grader didn&apos;t return a usable result (often a free-tier rate limit). Wait
            a moment and try again.
          </p>
          <Button asChild className="self-start">
            <a href={`/session/${id}/results`}>Try again</a>
          </Button>
        </main>
      );
    }
  }

  const session = await prisma.session.findUniqueOrThrow({
    where: { id },
    select: {
      title: true,
      stackLabel: true,
      briefPolicies: true,
      grade: true,
      files: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          path: true,
          language: true,
          hunks: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              label: true,
              startLine: true,
              endLine: true,
              code: true,
              truth: true,
              submissions: { where: { sessionId: id } },
            },
          },
        },
      },
    },
  });
  const grade = session.grade!;
  const policies = session.briefPolicies as { id: string; rule: string }[];
  const secondsPerFile = grade.secondsPerFile as Record<string, number>;

  const files = await Promise.all(
    session.files.map(async (file) => ({
      ...file,
      hunks: await Promise.all(
        file.hunks.map(async (h) => ({
          ...h,
          truth: h.truth!,
          submission: h.submissions[0] ?? null,
          html: await highlight(
            h.code,
            file.language,
            h.truth!.evidenceLines.map((n) => n - h.startLine + 1),
          ),
        })),
      ),
    })),
  );

  const history = await prisma.gradeReport.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      sessionId: true,
      totalScore: true,
      maxScore: true,
      falsePositiveRate: true,
      createdAt: true,
      session: { select: { domain: true, pacing: true, stackMode: true } },
    },
  });

  const percent = grade.maxScore > 0 ? Math.round((Math.max(0, grade.totalScore) / grade.maxScore) * 100) : 0;
  const tiles = [
    { label: "P0 caught", value: `${grade.p0Caught}/${grade.p0Total}` },
    { label: "P1 caught", value: `${grade.p1Caught}/${grade.p1Total}` },
    { label: "False positives", value: `${grade.falsePositives}`, sub: `${Math.round(grade.falsePositiveRate * 100)}% of flags` },
    { label: "Answered / skipped / blank", value: `${grade.answeredCount} / ${grade.skippedCount} / ${grade.unansweredCount}` },
    { label: "Brief reading", value: clock(grade.briefSeconds) },
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 pb-16 md:p-8">
      {/* ── Header + score ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs tracking-wider text-muted-foreground uppercase">Results</p>
          <h1 className="font-mono text-xl font-semibold">{session.title}</h1>
          <p className="text-sm text-muted-foreground">{session.stackLabel}</p>
        </div>
        <Button asChild>
          <Link href="/">New session</Link>
        </Button>
      </header>

      <section className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">Score</p>
          <p className="font-mono text-5xl font-semibold tabular-nums">{percent}%</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground tabular-nums">
            {grade.totalScore} / {grade.maxScore} pts
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="font-mono text-xl font-semibold tabular-nums">{t.value}</p>
              {t.sub && <p className="text-xs text-muted-foreground">{t.sub}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Coach&apos;s summary</h2>
        <p className="text-sm leading-relaxed">{grade.summary}</p>
        {grade.weakCategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Weakest categories:</span>
            {grade.weakCategories.map((c) => (
              <Badge key={c} variant="outline" className="font-mono">
                {c}
              </Badge>
            ))}
          </div>
        )}
      </section>

      {/* ── Per-hunk breakdown, answer key revealed ── */}
      {files.map((file) => (
        <section key={file.id} className="space-y-4">
          <h2 className="flex flex-wrap items-baseline gap-x-3 font-mono text-sm">
            {file.path}
            {secondsPerFile[file.id] !== undefined && (
              <span className="text-xs text-muted-foreground">time spent {clock(secondsPerFile[file.id])}</span>
            )}
          </h2>

          {file.hunks.map((h) => {
            const sub = h.submission;
            const outcome = OUTCOMES[outcomeOf(h.truth.severity, sub?.verdict ?? null, sub?.points ?? 0, sub?.isFalsePositive ?? false)];
            const policy = policies.find((p) => p.id === h.truth.policyId);
            return (
              <article key={h.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                  <h3 className="font-mono text-xs font-semibold">
                    {h.label}
                    <span className="ml-2 font-normal text-muted-foreground">
                      L{h.startLine}–{h.endLine}
                    </span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("gap-1", outcome.tone)}>
                      <outcome.Icon className="size-3" aria-hidden />
                      {outcome.label}
                    </Badge>
                    <span className="font-mono text-xs tabular-nums">
                      {sub?.points ?? 0} / {MAX_POINTS[h.truth.severity]}
                    </span>
                  </div>
                </header>

                <div
                  className="hunk-code overflow-x-auto bg-[#0d1117] text-[13px] leading-5"
                  style={{ "--line-start": h.startLine - 1 } as CSSProperties}
                  dangerouslySetInnerHTML={{ __html: h.html }}
                />

                <div className="grid border-t border-border md:grid-cols-2">
                  <dl className="space-y-2 p-3 text-sm">
                    <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Your call</p>
                    <Field term="Verdict" value={sub?.verdict ? VERDICT_LABEL[sub.verdict] : "No answer"} />
                    <Field term="Defect" value={sub?.defectSummary} />
                    <Field term="Blast radius" value={sub?.blastRadius} />
                    <Field term="Fix" value={sub?.oneLineFix} mono />
                  </dl>
                  <dl className="space-y-2 border-t border-border p-3 text-sm md:border-t-0 md:border-l">
                    <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Answer key</p>
                    <Field term="Severity" value={`${TRUTH_LABEL[h.truth.severity]} · ${h.truth.category}`} />
                    {h.truth.severity === "CLEAN" || h.truth.severity === "INTENTIONAL" ? (
                      <>
                        {policy && <Field term={`Policy ${policy.id}`} value={policy.rule} />}
                        <Field term="Why it looks wrong" value={h.truth.decoyReason} />
                      </>
                    ) : (
                      <>
                        <Field term="Defect" value={h.truth.defect} />
                        <Field term="Blast radius" value={h.truth.blastRadius} />
                        <Field term="Fix" value={h.truth.canonicalFix} mono />
                      </>
                    )}
                  </dl>
                </div>

                {sub?.graderFeedback && (
                  <p className="border-t border-border bg-muted/20 px-3 py-2 text-sm">
                    <span className="font-semibold">Feedback: </span>
                    {sub.graderFeedback}
                  </p>
                )}
              </article>
            );
          })}
        </section>
      ))}

      {/* ── Progress over time ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Recent attempts</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 text-right font-medium">Score</th>
                <th className="px-3 py-2 text-right font-medium">False-positive rate</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.sessionId} className={cn("border-t border-border", r.sessionId === id && "bg-primary/5")}>
                  <td className="px-3 py-2">
                    <Link href={`/session/${r.sessionId}/results`} className="hover:underline">
                      {r.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.session.domain}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.session.pacing} · {r.session.stackMode}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.maxScore > 0 ? Math.round((Math.max(0, r.totalScore) / r.maxScore) * 100) : 0}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Math.round(r.falsePositiveRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Field({ term, value, mono }: { term: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className={cn("whitespace-pre-wrap", mono && "font-mono text-xs", !value && "text-muted-foreground italic")}>
        {value || "—"}
      </dd>
    </div>
  );
}
