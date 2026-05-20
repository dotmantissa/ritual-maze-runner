import { useEffect, useRef, useState, useCallback } from "react";
import logoUrl from "@/assets/ritual-logo.jpg";

type Phase = "loading" | "ready" | "playing" | "done";

const SIZE = 480; // canvas px
const PLAYER_R = 4;
const STEP = 1.6;
const BEST_KEY = "ritual-knot-best-time";

type Arrow = { x: number; y: number; angle: number };

// BFS over walkable mask from start toward finish. Coarse grid (step 4).
// Declared before component so it is unambiguously in scope for the bundler.
function bfsPath(
  mask: Uint8ClampedArray,
  start: { x: number; y: number },
  finish: { x: number; y: number },
): { x: number; y: number }[] {
  const STEPB = 4;
  const W = Math.floor(SIZE / STEPB);
  const idx = (cx: number, cy: number) => cy * W + cx;
  const walkable = (cx: number, cy: number) => {
    const x = cx * STEPB, y = cy * STEPB;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
    return mask[y * SIZE + x] === 1;
  };
  const sx = Math.floor(start.x / STEPB), sy = Math.floor(start.y / STEPB);
  const fx = Math.floor(finish.x / STEPB), fy = Math.floor(finish.y / STEPB);
  const prev = new Int32Array(W * W).fill(-1);
  const visited = new Uint8Array(W * W);
  const queue: number[] = [idx(sx, sy)];
  visited[idx(sx, sy)] = 1;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = false;
  while (queue.length) {
    const cur = queue.shift()!;
    const cx = cur % W, cy = Math.floor(cur / W);
    if (cx === fx && cy === fy) { found = true; break; }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
      const ni = idx(nx, ny);
      if (visited[ni] || !walkable(nx, ny)) continue;
      visited[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (!found) return [];
  const path: { x: number; y: number }[] = [];
  let cur = idx(fx, fy);
  while (cur !== -1) {
    const cx = cur % W, cy = Math.floor(cur / W);
    path.push({ x: cx * STEPB, y: cy * STEPB });
    if (cx === sx && cy === sy) break;
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

export default function RitualMaze() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<Uint8ClampedArray | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const playerRef = useRef({ x: 0, y: 0 });
  const startRef = useRef({ x: 0, y: 0 });
  const finishRef = useRef({ x: 0, y: 0 });
  const startDirRef = useRef({ x: 0, y: 1 });
  const finishDirRef = useRef({ x: 0, y: 1 });
  const flowArrowsRef = useRef<Arrow[]>([]);
  const pathRef = useRef<{ x: number; y: number }[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const startTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const movesAccumRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("loading");
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState(0);
  const [moves, setMoves] = useState(0);
  const [bestTime, setBestTime] = useState<number | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(BEST_KEY);
      if (v) setBestTime(parseFloat(v));
    } catch {}
  }, []);

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
      ctx.fillStyle = "#0f3826";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
      const mask = new Uint8ClampedArray(SIZE * SIZE);
      for (let i = 0; i < SIZE * SIZE; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        mask[i] = r > 200 && g > 200 && b > 200 ? 1 : 0;
      }
      maskRef.current = mask;

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
      lastPosRef.current = { ...start };

      const path = bfsPath(mask, start, finish);
      pathRef.current = path;
      if (path.length > 2) {
        const a = path[Math.min(8, path.length - 1)];
        const dxs = a.x - start.x, dys = a.y - start.y;
        const ls = Math.hypot(dxs, dys) || 1;
        startDirRef.current = { x: dxs / ls, y: dys / ls };
        const b = path[Math.max(0, path.length - 9)];
        const dxf = finish.x - b.x, dyf = finish.y - b.y;
        const lf = Math.hypot(dxf, dyf) || 1;
        finishDirRef.current = { x: dxf / lf, y: dyf / lf };

        const arrows: Arrow[] = [];
        const spacing = 22;
        for (let i = spacing; i < path.length - spacing; i += spacing) {
          const p0 = path[Math.max(0, i - 6)];
          const p1 = path[Math.min(path.length - 1, i + 6)];
          const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
          arrows.push({ x: path[i].x, y: path[i].y, angle: ang });
        }
        flowArrowsRef.current = arrows;
      }

      setPhase("ready");
      draw();
    };
  }, []);

  const canMove = (x: number, y: number) => {
    const mask = maskRef.current;
    if (!mask) return false;
    const r = PLAYER_R - 1;
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

  const drawArrow = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, color: string, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, size * 0.55);
    ctx.lineTo(-size * 0.25, 0);
    ctx.lineTo(-size * 0.6, -size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d")!;
    // deep green background
    ctx.fillStyle = "#0f3826";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);

    // soft golden glow along the path for guidance
    const path = pathRef.current;
    if (path.length > 1) {
      ctx.save();
      ctx.strokeStyle = "rgba(212, 184, 120, 0.18)";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(212, 184, 120, 0.32)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // directional arrows along the path
    for (const a of flowArrowsRef.current) {
      drawArrow(ctx, a.x, a.y, a.angle, 4.5, "#d4b878", 0.7);
    }

    // START — green dot with outward arrow + glow
    const s = startRef.current;
    const sd = startDirRef.current;
    const outAngleS = Math.atan2(-sd.y, -sd.x);
    const sox = s.x - sd.x * 16;
    const soy = s.y - sd.y * 16;
    drawArrow(ctx, sox, soy, outAngleS, 12, "#86efac");
    ctx.save();
    ctx.shadowColor = "#4ade80";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#0a3d24";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.stroke();

    // EXIT — gold ring with outward arrow + glow
    const f = finishRef.current;
    const fd = finishDirRef.current;
    const outAngleF = Math.atan2(fd.y, fd.x);
    const fox = f.x + fd.x * 16;
    const foy = f.y + fd.y * 16;
    drawArrow(ctx, fox, foy, outAngleF, 12, "#f5d68a");
    ctx.save();
    ctx.shadowColor = "#d4b878";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = "#f5d68a";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // player with soft glow
    const p = playerRef.current;
    ctx.save();
    ctx.shadowColor = "#f5d68a";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#f5d68a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#154d34";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }, []);

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
        if (canMove(p.x + dx, p.y)) p.x += dx;
        if (canMove(p.x, p.y + dy)) p.y += dy;
        // accumulate distance → moves
        const lp = lastPosRef.current;
        movesAccumRef.current += Math.hypot(p.x - lp.x, p.y - lp.y);
        lastPosRef.current = { x: p.x, y: p.y };
        if (movesAccumRef.current >= 8) {
          const inc = Math.floor(movesAccumRef.current / 8);
          movesAccumRef.current -= inc * 8;
          setMoves((m) => m + inc);
        }
      }

      const p = playerRef.current;
      const f = finishRef.current;
      if (Math.hypot(p.x - f.x, p.y - f.y) < 8) {
        const t = (performance.now() - startTimeRef.current) / 1000;
        setFinalTime(t);
        try {
          const prev = parseFloat(localStorage.getItem(BEST_KEY) || "");
          if (isNaN(prev) || t < prev) {
            localStorage.setItem(BEST_KEY, t.toFixed(2));
            setBestTime(t);
          }
        } catch {}
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
    lastPosRef.current = { ...startRef.current };
    movesAccumRef.current = 0;
    setMoves(0);
    startTimeRef.current = performance.now();
    setElapsed(0);
    setPhase("playing");
  };

  const score = Math.max(0, Math.round(10000 - finalTime * 50 - moves * 2));

  const liveTime = phase === "done" ? finalTime : elapsed;
  const liveScore = Math.max(0, Math.round(10000 - liveTime * 50 - moves * 2));

  const fmtTime = (t: number | null) =>
    t == null ? "—" : `${t.toFixed(2)}s`;

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[560px]">
      {/* Header */}
      <div className="w-full flex items-center justify-between">
        <div>
          <div className="font-display text-2xl tracking-wide text-[var(--ritual-cream)] leading-none">
            Ritual Knot Maze
          </div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--ritual-cream)]/50 mt-1">
            A guided puzzle
          </div>
        </div>
        <div className="rounded-xl px-3 py-2 bg-[var(--ritual-green)]/40 border border-[var(--ritual-cream)]/10 backdrop-blur-sm shadow-[0_0_20px_-8px_rgba(245,214,138,0.4)]">
          <div className="text-[10px] uppercase tracking-widest text-[var(--ritual-cream)]/60">Time</div>
          <div className="font-mono text-lg tabular-nums text-[var(--ritual-gold)] leading-none mt-0.5">
            {liveTime.toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-3 gap-2 w-full">
        <Stat label="Score" value={liveScore.toLocaleString()} />
        <Stat label="Moves" value={moves.toString()} />
        <Stat label="Best Time" value={fmtTime(bestTime)} />
      </div>

      {/* START label */}
      <div className="w-full flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[#86efac]/80">
        <span className="h-px w-10 bg-[#86efac]/40" />
        <span>Start</span>
        <span className="h-px w-10 bg-[#86efac]/40" />
      </div>

      {/* Canvas */}
      <div className="relative w-full aspect-square rounded-2xl overflow-hidden ring-1 ring-[var(--ritual-cream)]/10 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6),0_0_40px_-10px_rgba(245,214,138,0.15)]">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className="w-full h-full touch-none block bg-[#0f3826]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {phase === "ready" && (
          <Overlay>
            <h2 className="font-display text-3xl text-center">Navigate the Knot</h2>
            <p className="text-sm opacity-80 max-w-xs text-center">
              Trace the glowing path from start to exit. Arrow keys, WASD, or drag.
            </p>
            <button onClick={start} className="ritual-btn mt-2">Begin</button>
          </Overlay>
        )}

        {phase === "done" && (
          <Overlay>
            <h2 className="font-display text-3xl">Path Complete</h2>
            <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-center mt-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest opacity-70">Score</div>
                <div className="font-display text-2xl text-[var(--ritual-gold)]">{score.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest opacity-70">Time</div>
                <div className="font-display text-2xl text-[var(--ritual-gold)]">{finalTime.toFixed(2)}s</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest opacity-70">Moves</div>
                <div className="font-display text-2xl text-[var(--ritual-gold)]">{moves}</div>
              </div>
            </div>
            {bestTime != null && (
              <div className="text-xs opacity-70 mt-1">
                Best Time: <span className="text-[var(--ritual-gold)]">{bestTime.toFixed(2)}s</span>
              </div>
            )}
            <div className="flex flex-col gap-2 w-full max-w-xs mt-3">
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

      {/* EXIT label */}
      <div className="w-full flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[var(--ritual-gold)]/80">
        <span className="h-px w-10 bg-[var(--ritual-gold)]/40" />
        <span>Exit</span>
        <span className="h-px w-10 bg-[var(--ritual-gold)]/40" />
      </div>

      {/* How to play */}
      <div className="w-full rounded-xl border border-[var(--ritual-cream)]/10 bg-[var(--ritual-green)]/30 backdrop-blur-sm p-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--ritual-cream)]/60 mb-2">
          How to Play
        </div>
        <ul className="space-y-1.5 text-sm text-[var(--ritual-cream)]/85">
          <li className="flex items-center gap-2">
            <Dot /> Follow the arrows
          </li>
          <li className="flex items-center gap-2">
            <Dot /> Stay on the path
          </li>
          <li className="flex items-center gap-2">
            <Dot /> Reach the exit
          </li>
        </ul>
      </div>

      <p className="text-[11px] opacity-50 text-[var(--ritual-cream)] text-center">
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
          transition: transform .15s ease, background .15s ease, box-shadow .2s ease;
          box-shadow: 0 0 24px -6px rgba(245,214,138,0.5);
        }
        .ritual-btn:hover { background: var(--ritual-gold); box-shadow: 0 0 32px -4px rgba(245,214,138,0.7); }
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-2 bg-[var(--ritual-green)]/30 border border-[var(--ritual-cream)]/10 backdrop-blur-sm text-center">
      <div className="text-[10px] uppercase tracking-widest text-[var(--ritual-cream)]/55">{label}</div>
      <div className="font-mono text-base tabular-nums text-[var(--ritual-cream)] mt-0.5">{value}</div>
    </div>
  );
}

function Dot() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ritual-gold)] shadow-[0_0_8px_rgba(245,214,138,0.7)]" />;
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 bg-[color:var(--ritual-green-deep)]/88 text-[var(--ritual-cream)] backdrop-blur-md">
      {children}
    </div>
  );
}
