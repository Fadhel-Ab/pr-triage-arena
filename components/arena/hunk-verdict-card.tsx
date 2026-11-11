"use client";

import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ArenaHunk, Draft, VerdictValue } from "@/lib/arena/types";
import { WordCappedTextarea } from "./word-capped-textarea";

export const VERDICT_OPTIONS: { value: VerdictValue; label: string }[] = [
  { value: "P0", label: "P0 · Ship-blocking" },
  { value: "P1", label: "P1 · This sprint" },
  { value: "P2", label: "P2 · Backlog" },
  { value: "CLEAN_OR_INTENTIONAL", label: "Clean / Intentional" },
  { value: "STRATEGIC_SKIP", label: "N/A · Strategic skip" },
];

const VERDICT_TONE: Record<VerdictValue, string> = {
  P0: "border-red-500/60 bg-red-500/10 text-red-300",
  P1: "border-amber-500/60 bg-amber-500/10 text-amber-300",
  P2: "border-sky-500/60 bg-sky-500/10 text-sky-300",
  CLEAN_OR_INTENTIONAL: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300",
  STRATEGIC_SKIP: "border-zinc-500/60 bg-zinc-500/10 text-zinc-300",
};

const FIELDS = [
  { key: "defectSummary", label: "Defect summary", placeholder: "What is wrong, citing lines" },
  { key: "blastRadius", label: "Blast radius", placeholder: "Who is affected and how badly" },
  { key: "oneLineFix", label: "One-line fix", placeholder: "The smallest correct change" },
] as const;

type Props = {
  hunk: ArenaHunk;
  draft: Draft;
  disabled: boolean;
  onChange: (draft: Draft) => void;
  onCapHit: (field: string) => void;
  onFocus: () => void;
};

export function HunkVerdictCard({ hunk, draft, disabled, onChange, onCapHit, onFocus }: Props) {
  return (
    <section
      aria-labelledby={`${hunk.id}-title`}
      onFocusCapture={onFocus}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
        <h3 id={`${hunk.id}-title`} className="font-mono text-xs font-semibold tracking-wide">
          {hunk.label}
          <span className="ml-2 font-normal text-muted-foreground">
            L{hunk.startLine}–{hunk.endLine}
          </span>
        </h3>
        {draft.verdict ? (
          <Badge variant="outline" className={VERDICT_TONE[draft.verdict]}>
            {VERDICT_OPTIONS.find((o) => o.value === draft.verdict)?.label}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Unanswered
          </Badge>
        )}
      </header>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div
          className="hunk-code overflow-x-auto bg-[#0d1117] text-[13px] leading-5"
          style={{ "--line-start": hunk.startLine - 1 } as CSSProperties}
          // Shiki escapes the code, and the HTML is produced on our server.
          dangerouslySetInnerHTML={{ __html: hunk.html }}
        />

        <div className="space-y-3 border-t border-border p-3 xl:border-t-0 xl:border-l">
          <div className="space-y-1">
            <label htmlFor={`${hunk.id}-verdict`} className="text-xs font-medium text-muted-foreground">
              Verdict
            </label>
            <Select
              value={draft.verdict ?? ""}
              disabled={disabled}
              onValueChange={(value) => onChange({ ...draft, verdict: value as VerdictValue })}
            >
              <SelectTrigger id={`${hunk.id}-verdict`} className="w-full">
                <SelectValue placeholder="Choose a verdict…" />
              </SelectTrigger>
              <SelectContent>
                {VERDICT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {FIELDS.map((field) => (
            <WordCappedTextarea
              key={field.key}
              id={`${hunk.id}-${field.key}`}
              label={field.label}
              placeholder={field.placeholder}
              value={draft[field.key]}
              disabled={disabled}
              onChange={(value) => onChange({ ...draft, [field.key]: value })}
              onCapHit={() => onCapHit(field.key)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
