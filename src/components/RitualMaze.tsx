import { useEffect, useRef, useState, useCallback } from "react";
import logoUrl from "@/assets/ritual-logo.jpg";

type Phase = "loading" | "ready" | "playing" | "done";

const SIZE = 480; // canvas px
const PLAYER_R = 4;
const STEP = 1.6;

type Arrow = { x: number; y: number; angle: number };

export default function RitualMaze() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<Uint8ClampedArray | null>(null); // 1 = walkable
  const imgRef = useRef<HTMLImageElement | null>(null);
  const playerRef = useRef({ x: 0, y: 0 });
  const startRef = useRef({ x: 0, y: 0 });
  const finishRef = useRef({ x: 0, y: 0 });
  const startDirRef = useRef({ x: 0, y: 1 }); // direction INTO the maze from start
  const finishDirRef = useRef({ x: 0, y: 1 }); // direction OUT of the maze at finish
  const flowArrowsRef = useRef<Arrow[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const startTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState(0);

  // Load logo and build walkable mask
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = logoUrl;
    img.onload = () => {
      imgRef.current = img;
      const off = document.createElement("canvas");
      off.width = SIZE;
      off.height = SIZE;
      const ctx = off.getContext("2d")!;
      ctx.fillStyle = "#1f6b48";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
      const mask = new Uint8ClampedArray(SIZE * SIZE);
      for (let i = 0; i < SIZE * SIZE; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        // White-ish pixels = walkable path
        mask[i] = r > 200 && g > 200 && b > 200 ? 1 : 0;
      }
      maskRef.current = mask;

      // Find start (top-most walkable) and finish (bottom-most walkable)
      let start = { x: 0, y: 0 };
      outer1: for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if (mask[y * SIZE + x]) { start = { x, y }; break outer1; }
        }
      }
      let finish = { x: 0, y: 0 };
      outer2: for (let y = SIZE - 1; y >= 0; y--) {
        for (let x = 0; x < SIZE; x++) {
          if (mask[y * SIZE + x]) { finish = { x, y }; break outer2; }
        }
      }
      startRef.current = start;
      finishRef.current = finish;
      playerRef.current = { ...start };
      setPhase("ready");
      draw();
    };
  }, []);

  const canMove = (x: number, y: number) => {
    const mask = maskRef.current;
    if (!mask) return false;
    const r = PLAYER_R - 1;
    // sample a few points around player
    for (let dx = -r; dx <= r; dx += r) {
      for (let dy = -r; dy <= r; dy += r) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) return false;
        if (!mask[py * SIZE + px]) return false;
      }
    }
    return true;
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1f6b48";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);

    // start marker
    const s = startRef.current;
    ctx.fillStyle = "#d4b878";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // finish marker (pulsing ring)
    const f = finishRef.current;
    ctx.strokeStyle = "#d4b878";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 8, 0, Math.PI * 2);
    ctx.stroke();

    // player
    const p = playerRef.current;
    ctx.fillStyle = "#d4b878";
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#154d34";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, []);

  // Game loop
  useEffect(() => {
    if (phase !== "playing") return;
    const loop = () => {
      const keys = keysRef.current;
      let dx = 0, dy = 0;
      if (keys["ArrowUp"] || keys["w"]) dy -= 1;
      if (keys["ArrowDown"] || keys["s"]) dy += 1;
      if (keys["ArrowLeft"] || keys["a"]) dx -= 1;
      if (keys["ArrowRight"] || keys["d"]) dx += 1;
      if (dragRef.current.active) {
        dx = dragRef.current.x;
        dy = dragRef.current.y;
      }
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        dx = (dx / len) * STEP;
        dy = (dy / len) * STEP;
        const p = playerRef.current;
        // try x then y independently for wall sliding
        if (canMove(p.x + dx, p.y)) p.x += dx;
        if (canMove(p.x, p.y + dy)) p.y += dy;
      }

      const p = playerRef.current;
      const f = finishRef.current;
      if (Math.hypot(p.x - f.x, p.y - f.y) < 8) {
        const t = (performance.now() - startTimeRef.current) / 1000;
        setFinalTime(t);
        setPhase("done");
        draw();
        return;
      }

      setElapsed((performance.now() - startTimeRef.current) / 1000);
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase, draw]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keysRef.current[e.key] = true; };
    const up = (e: KeyboardEvent) => { keysRef.current[e.key] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Touch / drag controls on canvas
  const onPointerDown = (e: React.PointerEvent) => {
    if (phase !== "playing") return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { active: true, x: 0, y: 0 };
    updateDrag(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    updateDrag(e);
  };
  const onPointerUp = () => { dragRef.current = { active: false, x: 0, y: 0 }; };
  const updateDrag = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = SIZE / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;
    const p = playerRef.current;
    dragRef.current.x = px - p.x;
    dragRef.current.y = py - p.y;
  };

  const start = () => {
    playerRef.current = { ...startRef.current };
    startTimeRef.current = performance.now();
    setElapsed(0);
    setPhase("playing");
  };

  const score = Math.max(0, Math.round(10000 - finalTime * 50));

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[520px]">
      <div className="flex justify-between items-baseline w-full px-1 text-[var(--ritual-cream)]">
        <div className="font-display text-2xl tracking-wide">Ritual Knot Maze</div>
        <div className="font-mono text-sm opacity-80 tabular-nums">
          {elapsed.toFixed(1)}s
        </div>
      </div>

      <div className="relative w-full aspect-square rounded-lg overflow-hidden ring-1 ring-[var(--ritual-cream)]/15 shadow-2xl">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className="w-full h-full touch-none block bg-[var(--ritual-green)]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {phase === "ready" && (
          <Overlay>
            <h2 className="font-display text-3xl">Navigate the Knot</h2>
            <p className="text-sm opacity-80 max-w-xs text-center">
              Trace the path from the marker to the ring. Use arrow keys, WASD,
              or drag.
            </p>
            <button onClick={start} className="ritual-btn">Begin</button>
          </Overlay>
        )}

        {phase === "done" && (
          <Overlay>
            <h2 className="font-display text-3xl">Path Complete</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-center mt-2">
              <div>
                <div className="text-xs uppercase tracking-widest opacity-70">Your Score</div>
                <div className="font-display text-3xl text-[var(--ritual-gold)]">{score}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest opacity-70">Time Taken</div>
                <div className="font-display text-3xl text-[var(--ritual-gold)]">{finalTime.toFixed(2)}s</div>
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs mt-4">
              <button onClick={start} className="ritual-btn">Play Again</button>
              <button disabled className="ritual-btn-ghost opacity-60 cursor-not-allowed">
                Mint Score NFT (Coming Soon)
              </button>
            </div>
          </Overlay>
        )}

        {phase === "loading" && (
          <Overlay><div className="opacity-80">Loading…</div></Overlay>
        )}
      </div>

      <p className="text-xs opacity-60 text-[var(--ritual-cream)] text-center">
        Arrow keys · WASD · Drag on touch
      </p>

      <style>{`
        .ritual-btn {
          background: var(--ritual-cream);
          color: var(--ritual-green-deep);
          padding: 0.65rem 1.25rem;
          border-radius: 999px;
          font-weight: 500;
          letter-spacing: 0.02em;
          transition: transform .15s ease, background .15s ease;
        }
        .ritual-btn:hover { background: var(--ritual-gold); }
        .ritual-btn:active { transform: scale(0.97); }
        .ritual-btn-ghost {
          background: transparent;
          color: var(--ritual-cream);
          border: 1px solid var(--ritual-cream);
          padding: 0.55rem 1.1rem;
          border-radius: 999px;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 bg-[color:var(--ritual-green-deep)]/85 text-[var(--ritual-cream)] backdrop-blur-sm">
      {children}
    </div>
  );
}
