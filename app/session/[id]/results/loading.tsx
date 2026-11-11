export default function GradingLoading() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden />
      <h1 className="font-mono text-lg font-semibold">Grading…</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Comparing your verdicts against the hidden answer key. This takes about 10–20 seconds the first time.
      </p>
    </main>
  );
}
