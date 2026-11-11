import { notFound } from "next/navigation";
import { SessionArena } from "@/components/arena/session-arena";
import { getArenaView } from "@/lib/arena/session-state";

// Timer state is server-authoritative; never cache this page.
export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getArenaView(id);
  if (!view) notFound();

  return <SessionArena initialView={view} />;
}
