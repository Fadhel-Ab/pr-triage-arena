"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, FileCode2, Lock, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArenaErrorCode, ArenaView, Draft, TelemetryInput } from "@/lib/arena/types";
import { cn } from "@/lib/utils";
import { HunkVerdictCard } from "./hunk-verdict-card";
import { formatClock, useStageTimer } from "./use-stage-timer";

const EMPTY_DRAFT: Draft = { verdict: null, defectSummary: "", blastRadius: "", oneLineFix: "" };

const CONFLICT_MESSAGES: Record<ArenaErrorCode, string> = {
  STALE_STAGE: "That stage was already locked (another tab, or time ran out). You're now on the current stage.",
  LATE: "Time ran out before your answers reached the server, so that stage was locked without them.",
  NOT_IN_PROGRESS: "This session is no longer in progress.",
};

export function SessionArena({ initialView }: { initialView: ArenaView }) {
  const [view, setView] = useState(initialView);
  const [clockOffset, setClockOffset] = useState(() => Date.parse(initialView.serverNow) - Date.now());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [briefOpen, setBriefOpen] = useState(true);

  const busyRef = useRef(false); // sync guard: state updates are too slow to stop a double click
  const telemetryRef = useRef<TelemetryInput[]>([]);
  const lastFocusedHunk = useRef<string | null>(null);
  const autoLockedStage = useRef<number | null>(null);
  const draftsLoaded = useRef(false);

  const inProgress = view.status === "IN_PROGRESS";
  const stage = inProgress ? view.stages[view.currentStageIndex] : undefined;
  const isLastStage = view.currentStageIndex === view.stages.length - 1;
  const remainingMs = useStageTimer(stage?.deadlineAt ?? null, clockOffset);
  const storageKey = `pta:drafts:${view.sessionId}`;

  // ── Telemetry ──────────────────────────────────────────────
  const track = useCallback(
    (type: TelemetryInput["type"], extra?: Pick<TelemetryInput, "hunkId" | "payload">) => {
      telemetryRef.current.push({ type, stageIndex: view.currentStageIndex, clientAt: new Date().toISOString(), ...extra });
    },
    [view.currentStageIndex],
  );

  useEffect(() => {
    if (!inProgress) return;
    const onVisibility = () => track(document.hidden ? "TAB_HIDDEN" : "TAB_VISIBLE");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [inProgress, track]);

  // ── Drafts survive a refresh (per browser only; the server copy is written on lock) ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setDrafts(JSON.parse(saved));
    } catch {
      // storage blocked or corrupt: start empty
    }
    draftsLoaded.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!draftsLoaded.current) return;
    try {
      if (view.status === "READY" || view.status === "IN_PROGRESS") localStorage.setItem(storageKey, JSON.stringify(drafts));
      else localStorage.removeItem(storageKey);
    } catch {
      // non-critical
    }
  }, [storageKey, drafts, view.status]);

  // ── Server calls ───────────────────────────────────────────
  const applyView = useCallback((next: ArenaView) => {
    setView(next);
    setClockOffset(Date.parse(next.serverNow) - Date.now());
    setConfirmArmed(false);
    lastFocusedHunk.current = null;
  }, []);

  const postToArena = useCallback(
    async (action: "start" | "lock", body: object = {}) => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setIsBusy(true);
      setNotice(null);
      try {
        const res = await fetch(`/api/session/${view.sessionId}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data: { view?: ArenaView; error?: string } = await res.json();
        if (data.view) applyView(data.view);
        // A 409 still counts as delivered: the server kept our telemetry and sent a fresh view.
        if (res.status === 409) setNotice(CONFLICT_MESSAGES[data.error as ArenaErrorCode] ?? data.error ?? null);
        else if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "network error";
        setNotice(`Request failed (${reason}). Your answers are kept in this browser. Try again.`);
        return false;
      } finally {
        busyRef.current = false;
        setIsBusy(false);
      }
    },
    [view.sessionId, applyView],
  );

  const lockStage = useCallback(async () => {
    if (!stage) return;
    const answers = (view.activeFile?.hunks ?? []).map((h) => ({ hunkId: h.id, ...(drafts[h.id] ?? EMPTY_DRAFT) }));
    const telemetry = telemetryRef.current;
    telemetryRef.current = [];

    const sent = await postToArena("lock", { stageIndex: stage.index, answers, telemetry });
    if (!sent) telemetryRef.current = [...telemetry, ...telemetryRef.current]; // retry with the next attempt
  }, [stage, view.activeFile, drafts, postToArena]);

  // Auto-lock once per stage when the clock hits zero. If that request fails,
  // the user gets a Retry button instead of a request every 250ms.
  useEffect(() => {
    if (remainingMs !== 0 || !stage || autoLockedStage.current === stage.index) return;
    autoLockedStage.current = stage.index;
    void lockStage();
  }, [remainingMs, stage, lockStage]);

  // Locking is irreversible, so it takes two clicks. The confirm state clears after 4s.
  useEffect(() => {
    if (!confirmArmed) return;
    const t = window.setTimeout(() => setConfirmArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmArmed]);

  function onLockClick() {
    if (!confirmArmed) return setConfirmArmed(true);
    void lockStage();
  }

  function updateDraft(hunkId: string, next: Draft) {
    const prev = drafts[hunkId] ?? EMPTY_DRAFT;
    if (prev.verdict !== next.verdict) track("VERDICT_CHANGED", { hunkId, payload: { from: prev.verdict, to: next.verdict } });
    setDrafts((d) => ({ ...d, [hunkId]: next }));
  }

  function onHunkFocus(hunkId: string) {
    if (lastFocusedHunk.current === hunkId) return;
    lastFocusedHunk.current = hunkId;
    track("HUNK_FOCUSED", { hunkId });
  }

  function toggleBrief() {
    setBriefOpen((open) => !open);
    track("BRIEF_TOGGLED", { payload: { open: !briefOpen } });
  }

  // ── Render ─────────────────────────────────────────────────
  const unanswered = (view.activeFile?.hunks ?? []).filter((h) => !drafts[h.id]?.verdict).length;
  const lockLabel = stage?.kind === "BRIEF" ? "Start file review" : isLastStage ? "Lock & Submit" : "Lock & Next Session";
  const confirmLabel =
    unanswered > 0 ? `Confirm: ${unanswered} unanswered will be recorded blank` : "Confirm: lock this session for good";

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-mono text-sm font-semibold">{view.title}</h1>
          <p className="text-xs text-muted-foreground">
            {view.stackLabel} · {view.pacingLabel}
          </p>
        </div>

        <StageRail view={view} />

        {stage && (
          <div
            role="timer"
            aria-label="Time left in this session"
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-lg tabular-nums",
              remainingMs !== null && remainingMs <= 15_000
                ? "animate-pulse border-red-500/70 text-red-400"
                : remainingMs !== null && remainingMs <= 60_000
                  ? "border-amber-500/60 text-amber-400"
                  : "border-border",
            )}
          >
            <Timer className="size-4" aria-hidden />
            {remainingMs === null ? "--:--" : formatClock(remainingMs)}
          </div>
        )}

        {stage && (
          <Button
            onClick={onLockClick}
            disabled={isBusy}
            variant={confirmArmed ? "destructive" : "default"}
            className="min-w-44"
          >
            <Lock aria-hidden />
            {isBusy ? "Locking…" : confirmArmed ? confirmLabel : lockLabel}
          </Button>
        )}
      </header>

      {notice && (
        <div role="status" className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          <span className="flex-1">{notice}</span>
          {stage && remainingMs === 0 && (
            <Button size="sm" variant="outline" onClick={() => void lockStage()} disabled={isBusy}>
              Retry
            </Button>
          )}
        </div>
      )}

      {view.status === "READY" ? (
        <StartScreen view={view} busy={isBusy} onStart={() => void postToArena("start")} />
      ) : !inProgress ? (
        <FinishedScreen sessionId={view.sessionId} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ── Left: brief + file tree ── */}
          <aside className="max-h-[40dvh] shrink-0 overflow-y-auto border-b border-border lg:max-h-none lg:w-96 lg:border-r lg:border-b-0">
            <button
              type="button"
              onClick={toggleBrief}
              aria-expanded={briefOpen}
              aria-controls="handover-brief"
              className="flex w-full items-center justify-between px-4 py-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase hover:bg-muted/40"
            >
              Handover brief
              <ChevronDown className={cn("size-4 transition-transform", !briefOpen && "-rotate-90")} aria-hidden />
            </button>
            {briefOpen && <BriefPanel view={view} />}

            <div className="border-t border-border px-4 py-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Files
            </div>
            <ul className="pb-3">
              {view.files.map((file) => (
                <li
                  key={file.id}
                  title={file.purpose}
                  aria-current={file.state === "active" ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 px-4 py-1.5 font-mono text-xs",
                    file.state === "active" && "bg-primary/10 text-foreground",
                    file.state === "locked" && "text-muted-foreground line-through decoration-muted-foreground/40",
                    file.state === "upcoming" && "text-muted-foreground/60",
                  )}
                >
                  {file.state === "locked" ? (
                    <Check className="size-3.5 shrink-0 text-emerald-400" aria-label="Locked" />
                  ) : file.state === "upcoming" ? (
                    <Lock className="size-3.5 shrink-0" aria-label="Not yet unlocked" />
                  ) : (
                    <FileCode2 className="size-3.5 shrink-0 text-primary" aria-hidden />
                  )}
                  <span className="truncate">{file.path}</span>
                </li>
              ))}
            </ul>
          </aside>

          {/* ── Right: code + verdicts ── */}
          <main className="min-h-0 flex-1 overflow-y-auto p-4">
            {stage?.kind === "BRIEF" || !view.activeFile ? (
              <div className="mx-auto max-w-2xl space-y-4 py-6">
                <h2 className="text-lg font-semibold">Session 1 · Brief reading</h2>
                <p className="text-sm text-muted-foreground">
                  Read the handover brief on the left. Code unlocks when you start file review or when this timer runs
                  out. The brief stays available for the whole assessment.
                </p>
                <div className="rounded-lg border border-border bg-card p-4">
                  <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">PR description</h3>
                  <p className="text-sm whitespace-pre-line">{view.prSummary}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <h2 className="font-mono text-sm">
                  <span className="text-muted-foreground">Session {view.currentStageIndex + 1} · </span>
                  {view.activeFile.path}
                </h2>
                {view.activeFile.hunks.map((hunk) => (
                  <HunkVerdictCard
                    key={hunk.id}
                    hunk={hunk}
                    draft={drafts[hunk.id] ?? EMPTY_DRAFT}
                    disabled={isBusy}
                    onChange={(next) => updateDraft(hunk.id, next)}
                    onCapHit={(field) => track("WORD_CAP_HIT", { hunkId: hunk.id, payload: { field } })}
                    onFocus={() => onHunkFocus(hunk.id)}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function StageRail({ view }: { view: ArenaView }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Sessions">
      {view.stages.map((s) => {
        const state = s.lockedAt ? "locked" : s.index === view.currentStageIndex ? "active" : "upcoming";
        return (
          <li
            key={s.index}
            aria-current={state === "active" ? "step" : undefined}
            className={cn(
              "flex h-6 items-center gap-1 rounded px-2 font-mono text-[11px]",
              state === "locked" && "bg-muted text-muted-foreground",
              state === "active" && "bg-primary text-primary-foreground",
              state === "upcoming" && "border border-dashed border-border text-muted-foreground/70",
            )}
          >
            {state === "locked" && <Check className="size-3" aria-hidden />}
            {s.kind === "BRIEF" ? "Brief" : `F${s.index}`}
            <span className="sr-only"> ({state})</span>
          </li>
        );
      })}
    </ol>
  );
}

function BriefPanel({ view }: { view: ArenaView }) {
  return (
    <div id="handover-brief" className="space-y-4 px-4 pb-4 text-sm">
      <p className="leading-relaxed whitespace-pre-line">{view.brief.context}</p>
      <div>
        <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Rules</h3>
        <ul className="list-disc space-y-1 pl-4">
          {view.brief.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Product policies</h3>
        <ul className="space-y-2">
          {view.brief.policies.map((p) => (
            <li key={p.id} className="rounded-md border border-border bg-muted/30 p-2">
              <span className="font-mono text-xs text-primary">{p.id}</span> {p.rule}
              <p className="mt-1 text-xs text-muted-foreground">{p.rationale}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StartScreen({ view, busy, onStart }: { view: ArenaView; busy: boolean; onStart: () => void }) {
  const total = view.stages.reduce((sum, s) => sum + s.durationSec, 0);
  return (
    <div className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-5 p-6">
      <h2 className="text-xl font-semibold">Ready when you are</h2>
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li>
          {view.stages.length} timed sessions, {Math.round(total / 60)} minutes total. Session 1 is brief reading.
        </li>
        <li>Sessions are forward-only. Once locked (by you or the clock), you can&apos;t go back.</li>
        <li>Each text box is capped at 40 words. Unanswered hunks are recorded blank; a strategic skip is cheaper than a wrong guess.</li>
        <li>The clock keeps running if you close the tab.</li>
      </ul>
      <Button onClick={onStart} disabled={busy} size="lg" className="self-start">
        {busy ? "Starting…" : "Start the clock"}
      </Button>
    </div>
  );
}

function FinishedScreen({ sessionId }: { sessionId: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-4 p-6">
      <h2 className="text-xl font-semibold">All sessions locked</h2>
      <p className="text-sm text-muted-foreground">Your verdicts are saved. Grading compares them against the hidden answer key.</p>
      <Button asChild className="self-start">
        <Link href={`/session/${sessionId}/results`}>View results</Link>
      </Button>
    </div>
  );
}
