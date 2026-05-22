import { createFileRoute } from "@tanstack/react-router";
import RitualMaze from "@/components/RitualMaze";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen w-full">
      <RitualMaze />
    </main>
  );
}
