"use client";

import { useEffect, useState } from "react";

/**
 * Milliseconds left until `deadlineAt`, re-computed every 250ms.
 * The deadline comes from the server; `clockOffsetMs` corrects for a wrong
 * local clock. Returns null until mounted (avoids a hydration mismatch) and
 * for a stale value while a new deadline is being picked up.
 */
export function useStageTimer(deadlineAt: string | null, clockOffsetMs: number): number | null {
  const [state, setState] = useState<{ deadlineAt: string; remainingMs: number } | null>(null);

  useEffect(() => {
    if (!deadlineAt) return;
    const deadline = Date.parse(deadlineAt);
    const tick = () => setState({ deadlineAt, remainingMs: Math.max(0, deadline - (Date.now() + clockOffsetMs)) });
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [deadlineAt, clockOffsetMs]);

  // Tying the value to its deadline means a stage that just started can never
  // see the previous stage's 0 and auto-lock itself.
  return state && state.deadlineAt === deadlineAt ? state.remainingMs : null;
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
