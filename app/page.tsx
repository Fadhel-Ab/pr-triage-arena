"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Minimal lobby so the arena is reachable. Styling pass comes later.
const OPTIONS = {
  domain: [
    ["FULL_STACK", "Full-Stack"],
    ["BACKEND_API", "Backend API"],
    ["FRONTEND_STATE_UI", "Frontend State / UI"],
    ["DATABASE_SECURITY", "Database / Security"],
    ["MOBILE_FLUTTER", "Mobile (Flutter / Dart)"],
  ],
  stackMode: [
    ["CORE", "My Core Stack"],
    ["CURVEBALL", "Curveball Mode"],
  ],
  pacing: [
    ["SPRINT", "Sprint · 15 min · 2 files"],
    ["FULL_SIMULATION", "Full Simulation · 38 min · 4 files"],
  ],
} as const;

type Config = { domain: string; stackMode: string; pacing: string };

export default function Lobby() {
  const router = useRouter();
  const [config, setConfig] = useState<Config>({ domain: "BACKEND_API", stackMode: "CORE", pacing: "SPRINT" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/session/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold">PR Triage Arena</h1>
        <p className="text-sm text-muted-foreground">Timed code review against a hidden answer key.</p>
      </div>

      {(Object.keys(OPTIONS) as (keyof Config)[]).map((key) => (
        <div key={key} className="space-y-1">
          <label htmlFor={key} className="text-xs font-medium text-muted-foreground">
            {{ domain: "Domain", stackMode: "Stack mode", pacing: "Difficulty & pacing" }[key]}
          </label>
          <Select value={config[key]} onValueChange={(v) => setConfig((c) => ({ ...c, [key]: v }))}>
            <SelectTrigger id={key} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPTIONS[key].map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      <Button size="lg" onClick={generate} disabled={loading}>
        {loading ? "Generating scenario… (up to a minute)" : "Generate PR"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </main>
  );
}
