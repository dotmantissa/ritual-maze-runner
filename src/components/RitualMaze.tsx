import { useEffect, useRef, useState, useCallback } from "react";
import logoUrl from "@/assets/ritual-logo.jpg";

type Phase = "loading" | "ready" | "playing" | "done";

const SIZE = 480;
const PLAYER_R = 4;
const STEP = 1.6;
const BEST_KEY = "ritual-knot-best-time";

type Arrow = { x: number; y: number; angle: number };

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

const fmtClock = (t: number) => {
  const m = Math.floor(t / 60).toString().padStart(2, "0");
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

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

  const [wallet, setWallet] = useState<string | null>(null);
  const [mintState, setMintState] = useState<"idle" | "minting" | "minted">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  const connectWallet = async () => {
    try {
      const eth = (window as any).ethereum;
      if (eth?.request) {
        const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
        if (accounts?.[0]) {
          setWallet(accounts[0]);
          try { localStorage.setItem("ritual-wallet", accounts[0]); } catch {}
          return;
        }
      }
      // Fallback: simulated wallet for environments without an injected provider
      const sim = "0xR1" + Math.random().toString(16).slice(2, 10).padEnd(8, "0") + "Ritual" + Math.random().toString(16).slice(2, 6);
      const addr = "0x" + sim.replace(/[^0-9a-fA-F]/g, "").slice(0, 40).padEnd(40, "0");
      setWallet(addr);
      try { localStorage.setItem("ritual-wallet", addr); } catch {}
    } catch (e) {
      console.warn("Wallet connect failed", e);
    }
  };

  const disconnectWallet = () => {
    setWallet(null);
    try { localStorage.removeItem("ritual-wallet"); } catch {}
  };

  useEffect(() => {
    try {
      const w = localStorage.getItem("ritual-wallet");
      if (w) setWallet(w);
    } catch {}
  }, []);

  const mintNft = async () => {
    if (!wallet || mintState === "minting") return;
    setMintState("minting");
    const payload = {
      score,
      time: finalTime,
      moves,
      completed: true,
      timestamp: Date.now(),
      wallet,
      chain: "Ritual",
    };
    // Simulated Ritual Chain mint — replace with real contract call when available.
    await new Promise((r) => setTimeout(r, 1600));
    const hash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    setTxHash(hash);
    setMintState("minted");
    console.log("Ritual NFT minted (simulated)", { hash, payload });
  };

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
      ctx.fillStyle = "#06160f";
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
    ctx.fillStyle = "#06160f";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);

    for (const a of flowArrowsRef.current) {
      drawArrow(ctx, a.x, a.y, a.angle, 5, "#4ade80", 0.85);
    }

    // START
    const s = startRef.current;
    const sd = startDirRef.current;
    const outAngleS = Math.atan2(-sd.y, -sd.x);
    const sox = s.x - sd.x * 18;
    const soy = s.y - sd.y * 18;
    drawArrow(ctx, sox, soy, outAngleS, 13, "#4ade80");
    ctx.save();
    ctx.shadowColor = "#4ade80";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // EXIT
    const f = finishRef.current;
    const fd = finishDirRef.current;
    const outAngleF = Math.atan2(fd.y, fd.x);
    const fox = f.x + fd.x * 18;
    const foy = f.y + fd.y * 18;
    drawArrow(ctx, fox, foy, outAngleF, 13, "#f5d68a");
    ctx.save();
    ctx.shadowColor = "#f5d68a";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#f5d68a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // player
    const p = playerRef.current;
    ctx.save();
    ctx.shadowColor = "#f5d68a";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#f5d68a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    if (phase === "ready") start();
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
    setMintState("idle");
    setTxHash(null);
    setPhase("playing");
  };

  const score = Math.max(0, Math.round(10000 - finalTime * 50 - moves * 2));
  const liveTime = phase === "done" ? finalTime : elapsed;
  const liveScore = phase === "ready" ? 0 : Math.max(0, Math.round(10000 - liveTime * 50 - moves * 2));

  const stars = liveScore > 7500 ? 3 : liveScore > 4000 ? 2 : liveScore > 0 ? 1 : 0;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 lg:py-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <KnotIcon />
          <div>
            <h1 className="font-display text-3xl md:text-4xl text-[var(--ritual-cream)] leading-none">
              Ritual Knot Maze
            </h1>
            <p className="text-xs md:text-sm text-[var(--ritual-cream)]/55 mt-1.5">
              Find the path. Follow the arrows. Reach the exit.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <div className="flex justify-end">
            {wallet ? (
              <button
                onClick={disconnectWallet}
                className="ritual-btn-ghost flex items-center gap-2"
                title="Click to disconnect"
              >
                <WalletIcon />
                <span className="font-mono text-xs">{shortAddr(wallet)}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ritual-glow)] shadow-[0_0_8px_var(--ritual-glow)]" />
              </button>
            ) : (
              <button onClick={connectWallet} className="ritual-btn-ghost flex items-center gap-2">
                <WalletIcon /> Connect Wallet
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 md:gap-3 md:w-auto w-full">
            <StatCard icon={<ClockIcon />} label="Time" value={fmtClock(liveTime)} />
            <StatCard icon={<StarIcon />} label="Moves" value={moves.toString()} accent="gold" />
            <StatCard icon={<TrophyIcon />} label="Best" value={bestTime != null ? fmtClock(bestTime) : "--:--"} accent="gold" />
          </div>
        </div>
      </header>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_260px] gap-4 lg:gap-6">
        {/* Left card */}
        <aside className="order-2 lg:order-1">
          <Panel>
            <PanelTitle className="text-[var(--ritual-glow)]">How to Play</PanelTitle>
            <ul className="space-y-4 mt-3">
              <Instr icon={<ArrowRightIcon />} title="Follow the arrows" desc="The arrows show the correct direction." />
              <Instr icon={<MoveIcon />} title="Stay on the path" desc="The path is always clear. No guesswork." />
              <Instr icon={<FlagIcon />} title="Reach the exit" desc="Green is start. Gold is exit." />
            </ul>
          </Panel>
        </aside>

        {/* Center maze */}
        <section className="order-1 lg:order-2 flex flex-col items-center">
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--ritual-glow)] mb-2 drop-shadow-[0_0_8px_rgba(74,222,128,0.6)]">
            Start
          </div>
          <div className="relative w-full max-w-[520px] aspect-square">
            <div className="absolute -inset-6 rounded-[40px] bg-[radial-gradient(closest-side,rgba(74,222,128,0.18),transparent_70%)] pointer-events-none" />
            <canvas
              ref={canvasRef}
              width={SIZE}
              height={SIZE}
              className="relative w-full h-full touch-none block rounded-2xl bg-[#06160f]"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {phase === "ready" && (
              <Overlay>
                <h2 className="font-display text-2xl md:text-3xl text-center">Navigate the Knot</h2>
                <p className="text-sm opacity-75 max-w-xs text-center">
                  Trace the glowing path from start to exit.
                </p>
                <button onClick={start} className="ritual-btn mt-2">Begin</button>
              </Overlay>
            )}
            {phase === "done" && (
              <Overlay>
                <h2 className="font-display text-3xl">Path Complete</h2>
                <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-center mt-2">
                  <Result label="Score" value={score.toLocaleString()} />
                  <Result label="Time" value={fmtClock(finalTime)} />
                  <Result label="Moves" value={moves.toString()} />
                </div>
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
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--ritual-gold)] mt-2 drop-shadow-[0_0_8px_rgba(245,214,138,0.6)]">
            Exit
          </div>
        </section>

        {/* Right card */}
        <aside className="order-3">
          <Panel>
            <div className="flex items-center gap-2">
              <BulbIcon />
              <PanelTitle className="text-[var(--ritual-glow)] !mb-0">Designed for clarity</PanelTitle>
            </div>
            <ul className="space-y-2.5 mt-4 text-sm text-[var(--ritual-cream)]/85">
              <Check>Start arrow points outward</Check>
              <Check>Exit arrow points outward</Check>
              <Check>Clear path, no confusion</Check>
              <Check>Relaxing and stress-free</Check>
            </ul>
          </Panel>
        </aside>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-4 lg:gap-6 mt-6">
        <Panel>
          <PanelTitle className="text-[var(--ritual-glow)]">Controls</PanelTitle>
          <p className="text-xs text-[var(--ritual-cream)]/55 -mt-2 mb-4">Choose your way to move</p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-2">
              <Key>←</Key><Key>↑</Key><Key>→</Key>
              <span className="text-sm text-[var(--ritual-cream)]/75 ml-1">Arrow Keys</span>
            </div>
            <div className="flex items-center gap-2">
              <Key>W</Key><Key>A</Key><Key>S</Key><Key>D</Key>
              <span className="text-sm text-[var(--ritual-cream)]/75 ml-1">WASD</span>
            </div>
            <div className="flex items-center gap-2">
              <Key><MouseIcon /></Key>
              <span className="text-sm text-[var(--ritual-cream)]/75 ml-1">Drag / Touch</span>
            </div>
          </div>
          <div className="flex justify-center mt-5">
            <button onClick={start} className="ritual-btn-ghost flex items-center gap-2">
              <RestartIcon /> Restart
            </button>
          </div>
        </Panel>

        <Panel className="text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--ritual-glow)]">Score</div>
          <div className="font-display text-5xl text-[var(--ritual-cream)] mt-1">{liveScore.toLocaleString()}</div>
          <div className="flex justify-center gap-1.5 mt-2">
            {[0, 1, 2].map((i) => (
              <StarShape key={i} filled={i < stars} />
            ))}
          </div>
          <div className="text-xs text-[var(--ritual-cream)]/60 mt-2 tracking-widest">
            {bestTime != null ? fmtClock(bestTime) : "--:--"}
          </div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--ritual-cream)]/45 mt-0.5">Best Time</div>
        </Panel>
      </div>

      <style>{`
        .ritual-btn {
          background: var(--ritual-cream);
          color: #0a3d24;
          padding: 0.65rem 1.5rem;
          border-radius: 999px;
          font-weight: 500;
          letter-spacing: 0.02em;
          transition: transform .15s ease, background .15s ease, box-shadow .2s ease;
          box-shadow: 0 0 24px -6px rgba(245,214,138,0.55);
        }
        .ritual-btn:hover { background: var(--ritual-gold); box-shadow: 0 0 32px -4px rgba(245,214,138,0.75); }
        .ritual-btn:active { transform: scale(0.97); }
        .ritual-btn-ghost {
          background: transparent;
          color: var(--ritual-cream);
          border: 1px solid rgba(245,241,232,0.25);
          padding: 0.55rem 1.4rem;
          border-radius: 999px;
          font-size: 0.875rem;
          transition: border-color .15s ease, background .15s ease;
        }
        .ritual-btn-ghost:hover:not(:disabled) {
          border-color: rgba(245,241,232,0.5);
          background: rgba(245,241,232,0.05);
        }
      `}</style>
    </div>
  );
}

/* ---------- UI atoms ---------- */

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-[var(--ritual-glow)]/15 bg-[#0a2418]/70 backdrop-blur-sm p-5 shadow-[0_0_30px_-12px_rgba(74,222,128,0.25),inset_0_1px_0_rgba(255,255,255,0.03)] h-full ${className}`}
    >
      {children}
    </div>
  );
}

function PanelTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] uppercase tracking-[0.3em] font-semibold mb-3 ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ icon, label, value, accent = "green" }: { icon: React.ReactNode; label: string; value: string; accent?: "green" | "gold" }) {
  const color = accent === "gold" ? "var(--ritual-gold)" : "var(--ritual-glow)";
  return (
    <div className="rounded-xl border border-[var(--ritual-glow)]/15 bg-[#0a2418]/70 backdrop-blur-sm px-3 py-2.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[var(--ritual-cream)]/60">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="font-mono text-lg tabular-nums text-[var(--ritual-cream)] mt-1 leading-none">{value}</div>
    </div>
  );
}

function Instr({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex-none w-9 h-9 rounded-full border border-[var(--ritual-glow)]/40 bg-[var(--ritual-glow)]/10 flex items-center justify-center text-[var(--ritual-glow)]">
        {icon}
      </span>
      <div>
        <div className="text-sm font-medium text-[var(--ritual-cream)]">{title}</div>
        <div className="text-xs text-[var(--ritual-cream)]/55 mt-0.5 leading-snug">{desc}</div>
      </div>
    </li>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mt-1 flex-none text-[var(--ritual-glow)]">
        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[34px] h-9 px-2 rounded-md border border-[var(--ritual-cream)]/20 bg-[#0a2418] text-[var(--ritual-cream)] text-sm font-mono">
      {children}
    </span>
  );
}

function Result({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="font-display text-2xl text-[var(--ritual-gold)]">{value}</div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 bg-[#06160f]/85 text-[var(--ritual-cream)] backdrop-blur-md rounded-2xl">
      {children}
    </div>
  );
}

/* ---------- Icons ---------- */

function KnotIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="text-[var(--ritual-cream)] drop-shadow-[0_0_8px_rgba(74,222,128,0.4)]">
      <path d="M20 4l16 16-16 16L4 20 20 4z" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <path d="M12 12h6v4h4v-4h6v6h-4v4h4v6h-6v-4h-4v4h-6v-6h4v-4h-4v-6z" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3 7 7 .6-5.3 4.6L18.5 22 12 18l-6.5 4 1.8-7.8L2 9.6 9 9l3-7z" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M7 4h10v4a5 5 0 11-10 0V4z" stroke="currentColor" strokeWidth="2" />
      <path d="M5 6H3a3 3 0 003 3M19 6h2a3 3 0 01-3 3M10 14h4l-1 4h-2l-1-4zM8 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 2v6m0 8v6M2 12h6m8 0h6M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M5 21V4m0 0h11l-2 4 2 4H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[var(--ritual-glow)] drop-shadow-[0_0_6px_rgba(74,222,128,0.6)]">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.7.6 1 1.5 1 2.3v1h6v-1c0-.8.3-1.7 1-2.3A7 7 0 0012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MouseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="7" y="3" width="10" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M3 12a9 9 0 0115.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 01-15.5 6.3L3 16M3 21v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarShape({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "var(--ritual-glow)" : "none"} className="text-[var(--ritual-glow)]">
      <path d="M12 2l3 7 7 .6-5.3 4.6L18.5 22 12 18l-6.5 4 1.8-7.8L2 9.6 9 9l3-7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
