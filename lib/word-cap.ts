// Shared by the textarea (live cap) and the lock API (server re-check).

const WORD = /\S+/g;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

// Keeps everything up to the end of the `max`-th word.
export function truncateToWords(text: string, max: number): string {
  let count = 0;
  for (const match of text.matchAll(WORD)) {
    count++;
    if (count === max) return text.slice(0, match.index + match[0].length);
  }
  return text;
}
