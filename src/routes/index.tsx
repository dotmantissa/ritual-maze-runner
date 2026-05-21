import { createFileRoute } from "@tanstack/react-router";
import RitualMaze from "@/components/RitualMaze";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Ritual Knot Maze" },
      { name: "description", content: "Trace the Ritual knot — a minimal browser maze game." },
    ],
  }),
});

function Index() {
  return (
    <main className="min-h-screen w-full">
      <RitualMaze />
    </main>
  );
}
