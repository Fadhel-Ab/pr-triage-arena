"use client";

import { Textarea } from "@/components/ui/textarea";
import { FIELD_CHAR_CAP, WORD_CAP } from "@/lib/arena/pacing";
import { countWords, truncateToWords } from "@/lib/word-cap";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onCapHit: () => void;
};

export function WordCappedTextarea({ id, label, placeholder, value, disabled, onChange, onCapHit }: Props) {
  const words = countWords(value);

  function handleChange(next: string) {
    if (countWords(next) <= WORD_CAP) return onChange(next);

    onCapHit();
    // Already full: refuse the extra word rather than silently cutting text off the end.
    if (words >= WORD_CAP) return;
    // Below the cap but a paste pushed it over: keep the first 40 words.
    onChange(truncateToWords(next, WORD_CAP));
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <label htmlFor={id} className="font-medium text-muted-foreground">
          {label}
        </label>
        <span
          id={`${id}-count`}
          className={cn(
            "font-mono tabular-nums",
            words >= WORD_CAP ? "text-red-400" : words >= WORD_CAP - 5 ? "text-amber-400" : "text-muted-foreground",
          )}
        >
          {words}/{WORD_CAP}
        </span>
      </div>
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={FIELD_CHAR_CAP}
        aria-describedby={`${id}-count`}
        className="min-h-14 resize-none font-mono text-xs"
        onChange={(e) => handleChange(e.target.value)}
      />
      <span className="sr-only" aria-live="polite">
        {words >= WORD_CAP ? `${label}: word limit reached` : ""}
      </span>
    </div>
  );
}
