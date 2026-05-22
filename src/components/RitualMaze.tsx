import { useEffect, useRef, useState, useCallback } from "react";
import logoUrl from "@/assets/ritual-logo.jpg";

type Phase = "loading" | "ready" | "playing" | "done";
type Dir = "up" | "down" | "left" | "right";
type NodeId = string;

type MazeNode = {
  id: NodeId;
  x: number;
  y: number;
  edges: NodeId[];
  isDeadEnd?: boolean;
};

type MazeGraph = {
  nodes: Record<NodeId, MazeNode>;
  startId: NodeId;
  exitId: NodeId;
  solutionPath: NodeId[];
};

type HintArrow = {
  id: string;
  fromId: NodeId;
  toId: NodeId;
  x: number;
  y: number;
  angle: number;
};

type EthereumProvider = {
  request: (args: { method: "eth_requestAccounts" }) => Promise<string[]>;
};

const SIZE = 480;
const PLAYER_R = 6;
const BEST_KEY = "ritual-knot-best-time";
const SWIPE_THRESHOLD = 20;
const NODE_STEP = 16;

const STATIC_MAZE_NODES: MazeNode[] = [
  { id: "START", x: 240, y: 18, edges: ["A"] },
  { id: "A", x: 240, y: 64, edges: ["START", "B", "D1"] },
  { id: "B", x: 300, y: 64, edges: ["A", "C"] },
  { id: "C", x: 300, y: 124, edges: ["B", "D", "D2"] },
  { id: "D", x: 188, y: 124, edges: ["C", "E"] },
  { id: "E", x: 188, y: 190, edges: ["D", "F", "D3"] },
  { id: "F", x: 330, y: 190, edges: ["E", "G"] },
  { id: "G", x: 330, y: 258, edges: ["F", "H", "D4"] },
  { id: "H", x: 150, y: 258, edges: ["G", "I"] },
  { id: "I", x: 150, y: 326, edges: ["H", "J", "D5"] },
  { id: "J", x: 288, y: 326, edges: ["I", "K"] },
  { id: "K", x: 288, y: 392, edges: ["J", "L", "D6"] },
  { id: "L", x: 240, y: 392, edges: ["K", "EXIT"] },
  { id: "EXIT", x: 240, y: 462, edges: ["L"] },
  { id: "D1", x: 190, y: 64, edges: ["A", "D1_END"], isDeadEnd: true },
  { id: "D1_END", x: 160, y: 100, edges: ["D1"], isDeadEnd: true },
  { id: "D2", x: 360, y: 124, edges: ["C"], isDeadEnd: true },
  { id: "D3", x: 130, y: 190, edges: ["E"], isDeadEnd: true },
  { id: "D4", x: 382, y: 258, edges: ["G"], isDeadEnd: true },
  { id: "D5", x: 92, y: 326, edges: ["I"], isDeadEnd: true },
  { id: "D6", x: 348, y: 392, edges: ["K"], isDeadEnd: true },
];

const STATIC_SOLUTION_PATH = [
  "START",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "EXIT",
];

function createStaticMazeGraph(): MazeGraph {
  return {
    nodes: Object.fromEntries(STATIC_MAZE_NODES.map((node) => [node.id, { ...node }])),
    startId: "START",
    exitId: "EXIT",
    solutionPath: STATIC_SOLUTION_PATH,
  };
}

function isUsableGraph(graph: MazeGraph) {
  return (
    graph.solutionPath.length >= 2 &&
    Boolean(graph.nodes[graph.startId]) &&
    Boolean(graph.nodes[graph.exitId])
  );
}

function bfsPath(
  mask: Uint8ClampedArray,
  start: { x: number; y: number },
  finish: { x: number; y: number },
): { x: number; y: number }[] {
  const STEPB = 4;
  const W = Math.floor(SIZE / STEPB);
  const idx = (cx: number, cy: number) => cy * W + cx;
  const walkable = (cx: number, cy: number) => {
    const x = cx * STEPB;
    const y = cy * STEPB;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
    return mask[y * SIZE + x] === 1;
  };
  const sx = Math.floor(start.x / STEPB);
  const sy = Math.floor(start.y / STEPB);
  const fx = Math.floor(finish.x / STEPB);
  const fy = Math.floor(finish.y / STEPB);
  const prev = new Int32Array(W * W).fill(-1);
  const visited = new Uint8Array(W * W);
  const queue: number[] = [idx(sx, sy)];
  visited[idx(sx, sy)] = 1;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let found = false;
  while (queue.length) {
    const cur = queue.shift()!;
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    if (cx === fx && cy === fy) {
      found = true;
      break;
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
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
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    path.push({ x: cx * STEPB, y: cy * STEPB });
    if (cx === sx && cy === sy) break;
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

const fmtClock = (t: number) => {
  const m = Math.floor(t / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
};

function isWalkable(mask: Uint8ClampedArray, x: number, y: number) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= SIZE || yi >= SIZE) return false;
  return mask[yi * SIZE + xi] === 1;
}

function sampleSolutionNodes(path: { x: number; y: number }[]) {
  if (path.length === 0) return [] as { x: number; y: number }[];
  const nodes = [path[0]];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    const d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    acc += d;
    if (acc >= NODE_STEP) {
      nodes.push(cur);
      acc = 0;
    }
  }
  const last = path[path.length - 1];
  const tail = nodes[nodes.length - 1];
  if (!tail || Math.hypot(tail.x - last.x, tail.y - last.y) > 2) nodes.push(last);
  return nodes;
}

function buildMazeGraph(mask: Uint8ClampedArray, path: { x: number; y: number }[]): MazeGraph {
  const sampled = sampleSolutionNodes(path);
  if (sampled.length < 2) return createStaticMazeGraph();

  const nodes: Record<NodeId, MazeNode> = {};
  const solutionPath: NodeId[] = sampled.map((_, idx) => `N${idx}`);

  sampled.forEach((p, idx) => {
    const id = `N${idx}`;
    nodes[id] = { id, x: p.x, y: p.y, edges: [] };
  });

  for (let i = 0; i < solutionPath.length - 1; i++) {
    const a = solutionPath[i];
    const b = solutionPath[i + 1];
    nodes[a].edges.push(b);
    nodes[b].edges.push(a);
  }

  let branchCount = 0;
  for (let i = 3; i < solutionPath.length - 3; i += 5) {
    const anchorId = solutionPath[i];
    const prev = nodes[solutionPath[i - 1]];
    const anchor = nodes[anchorId];
    const next = nodes[solutionPath[i + 1]];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const perp = [
      { x: -dy / len, y: dx / len },
      { x: dy / len, y: -dx / len },
    ];

    let built = false;
    for (const d of perp) {
      const candidate: { x: number; y: number }[] = [];
      for (let step = 1; step <= 3; step++) {
        const x = anchor.x + d.x * NODE_STEP * step;
        const y = anchor.y + d.y * NODE_STEP * step;
        if (!isWalkable(mask, x, y)) break;
        const tooClose = solutionPath.some((sid) => {
          const s = nodes[sid];
          return Math.hypot(s.x - x, s.y - y) < NODE_STEP * 0.75;
        });
        if (tooClose) break;
        candidate.push({ x, y });
      }
      if (candidate.length >= 2) {
        let parent = anchorId;
        candidate.forEach((point, idx) => {
          const id = `B${branchCount}_${idx}`;
          nodes[id] = { id, x: point.x, y: point.y, edges: [], isDeadEnd: true };
          nodes[parent].edges.push(id);
          nodes[id].edges.push(parent);
          parent = id;
        });
        branchCount += 1;
        built = true;
        break;
      }
    }
    if (built && branchCount >= 6) break;
  }

  const generated = {
    nodes,
    startId: solutionPath[0],
    exitId: solutionPath[solutionPath.length - 1],
    solutionPath,
  };

  return isUsableGraph(generated) ? generated : createStaticMazeGraph();
}

function createHintArrows(graph: MazeGraph) {
  const arrows: HintArrow[] = [];
  for (let i = 0; i < graph.solutionPath.length - 1; i++) {
    const fromId = graph.solutionPath[i];
    const toId = graph.solutionPath[i + 1];
    const from = graph.nodes[fromId];
    const to = graph.nodes[toId];
    if (!from || !to) continue;
    if (from.edges.length <= 1) continue;
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    arrows.push({ id: `${fromId}->${toId}`, fromId, toId, x: from.x, y: from.y, angle });
  }
  return arrows;
}

function directionVector(dir: Dir) {
  if (dir === "up") return { x: 0, y: -1 };
  if (dir === "down") return { x: 0, y: 1 };
  if (dir === "left") return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function getLocalStorageItem(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setLocalStorageItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return false;
  }
  return true;
}

function removeLocalStorageItem(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    return false;
  }
  return true;
}

export default function RitualMaze() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<HTMLDivElement | null>(null);
  const maskRef = useRef<Uint8ClampedArray | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const graphRef = useRef<MazeGraph | null>(null);
  const playerPosRef = useRef({ x: 0, y: 0 });
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const isAnimatingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("loading");
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState(0);
  const [moves, setMoves] = useState(0);
  const [bestTime, setBestTime] = useState<number | null>(null);
  const [currentNodeId, setCurrentNodeId] = useState<NodeId | null>(null);
  const [playerRender, setPlayerRender] = useState({ x: 0, y: 0 });
  const [hints, setHints] = useState<HintArrow[]>([]);
  const [hintsEnabled, setHintsEnabled] = useState(false);
  const [hoveredHintId, setHoveredHintId] = useState<string | null>(null);
  const [invalidPulse, setInvalidPulse] = useState(0);

  const [wallet, setWallet] = useState<string | null>(null);
  const [mintState, setMintState] = useState<"idle" | "minting" | "minted">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  const connectWallet = async () => {
    try {
      const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum;
      if (eth?.request) {
        const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
        if (accounts?.[0]) {
          setWallet(accounts[0]);
          setLocalStorageItem("ritual-wallet", accounts[0]);
          return;
        }
      }
      const sim =
        "0xR1" +
        Math.random().toString(16).slice(2, 10).padEnd(8, "0") +
        "Ritual" +
        Math.random().toString(16).slice(2, 6);
      const addr =
        "0x" +
        sim
          .replace(/[^0-9a-fA-F]/g, "")
          .slice(0, 40)
          .padEnd(40, "0");
      setWallet(addr);
      setLocalStorageItem("ritual-wallet", addr);
    } catch (e) {
      console.warn("Wallet connect failed", e);
    }
  };

  const disconnectWallet = () => {
    setWallet(null);
    removeLocalStorageItem("ritual-wallet");
  };

  useEffect(() => {
    const w = getLocalStorageItem("ritual-wallet");
    if (w) setWallet(w);
  }, []);

  useEffect(() => {
    const v = getLocalStorageItem(BEST_KEY);
    if (v) setBestTime(parseFloat(v));
  }, []);

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    size: number,
    color: string,
    alpha = 1,
  ) => {
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
    const graph = graphRef.current;
    if (!canvas || !img || !graph) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#06160f";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);

    const start = graph.nodes[graph.startId];
    const startNext = graph.nodes[graph.solutionPath[1]] ?? start;
    const sdx = startNext.x - start.x;
    const sdy = startNext.y - start.y;
    const sl = Math.hypot(sdx, sdy) || 1;
    drawArrow(
      ctx,
      start.x - (sdx / sl) * 18,
      start.y - (sdy / sl) * 18,
      Math.atan2(-sdy, -sdx),
      13,
      "#4ade80",
    );

    ctx.save();
    ctx.shadowColor = "#4ade80";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const exit = graph.nodes[graph.exitId];
    const exitPrev = graph.nodes[graph.solutionPath[graph.solutionPath.length - 2]] ?? exit;
    const edx = exit.x - exitPrev.x;
    const edy = exit.y - exitPrev.y;
    const el = Math.hypot(edx, edy) || 1;
    drawArrow(
      ctx,
      exit.x + (edx / el) * 18,
      exit.y + (edy / el) * 18,
      Math.atan2(edy, edx),
      13,
      "#f5d68a",
    );

    ctx.save();
    ctx.shadowColor = "#f5d68a";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#f5d68a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(exit.x, exit.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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
          if (mask[y * SIZE + x]) {
            start = { x, y };
            break outer1;
          }
        }
      }
      let finish = { x: 0, y: 0 };
      outer2: for (let y = SIZE - 1; y >= 0; y--) {
        for (let x = 0; x < SIZE; x++) {
          if (mask[y * SIZE + x]) {
            finish = { x, y };
            break outer2;
          }
        }
      }

      const path = bfsPath(mask, start, finish);
      const graph = buildMazeGraph(mask, path);
      graphRef.current = graph;
      setHints(createHintArrows(graph));
      const startNode = graph.nodes[graph.startId];
      if (!startNode) {
        setPhase("loading");
        return;
      }
      playerPosRef.current = { x: startNode.x, y: startNode.y };
      setPlayerRender({ x: startNode.x, y: startNode.y });
      setCurrentNodeId(graph.startId);
      setPhase("ready");
      draw();
    };
  }, [draw]);

  const start = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const startNode = graph.nodes[graph.startId];
    playerPosRef.current = { x: startNode.x, y: startNode.y };
    setPlayerRender({ x: startNode.x, y: startNode.y });
    setCurrentNodeId(graph.startId);
    setMoves(0);
    setElapsed(0);
    setFinalTime(0);
    setMintState("idle");
    setTxHash(null);
    if (timerRef.current) window.clearInterval(timerRef.current);
    startTimeRef.current = performance.now();
    timerRef.current = window.setInterval(() => {
      setElapsed((performance.now() - startTimeRef.current) / 1000);
    }, 100);
    setPhase("playing");
    draw();
    gameRef.current?.focus();
  }, [draw]);

  const restart = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    isAnimatingRef.current = false;
    setHoveredHintId(null);
    start();
  }, [start]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const finishRun = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const t = (performance.now() - startTimeRef.current) / 1000;
    setFinalTime(t);
    const prev = parseFloat(getLocalStorageItem(BEST_KEY) || "");
    if (isNaN(prev) || t < prev) {
      setLocalStorageItem(BEST_KEY, t.toFixed(2));
      setBestTime(t);
    }
    setPhase("done");
  }, []);

  const animateToNode = useCallback(
    (toId: NodeId) => {
      const graph = graphRef.current;
      const fromId = currentNodeId;
      if (!graph || !fromId) return;
      const from = graph.nodes[fromId];
      const to = graph.nodes[toId];
      if (!from || !to) return;
      isAnimatingRef.current = true;
      const startMs = performance.now();
      const duration = 180;

      const step = (ts: number) => {
        const t = Math.min(1, (ts - startMs) / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        playerPosRef.current = {
          x: from.x + (to.x - from.x) * eased,
          y: from.y + (to.y - from.y) * eased,
        };
        setPlayerRender(playerPosRef.current);
        draw();
        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }

        playerPosRef.current = { x: to.x, y: to.y };
        setPlayerRender({ x: to.x, y: to.y });
        setCurrentNodeId(toId);
        setMoves((m) => m + 1);
        isAnimatingRef.current = false;
        if (toId === graph.exitId) finishRun();
      };

      requestAnimationFrame(step);
    },
    [currentNodeId, draw, finishRun],
  );

  const invalidMoveFeedback = useCallback(() => {
    setInvalidPulse((v) => v + 1);
  }, []);

  const tryMove = useCallback(
    (dir: Dir) => {
      if (phase === "ready") {
        start();
        return;
      }
      if (phase !== "playing" || isAnimatingRef.current) return;
      const graph = graphRef.current;
      if (!graph || !currentNodeId) return;
      const cur = graph.nodes[currentNodeId];
      const vec = directionVector(dir);

      let bestId: NodeId | null = null;
      let bestDot = 0.45;
      for (const edgeId of cur.edges) {
        const n = graph.nodes[edgeId];
        const dx = n.x - cur.x;
        const dy = n.y - cur.y;
        const len = Math.hypot(dx, dy) || 1;
        const dot = (dx / len) * vec.x + (dy / len) * vec.y;
        if (dot > bestDot) {
          bestDot = dot;
          bestId = edgeId;
        }
      }

      if (!bestId) {
        invalidMoveFeedback();
        return;
      }
      animateToNode(bestId);
    },
    [animateToNode, currentNodeId, invalidMoveFeedback, phase, start],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (phase === "ready") start();
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gameRef.current?.focus();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const origin = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!origin) return;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      tryMove(dx > 0 ? "right" : "left");
    } else {
      tryMove(dy > 0 ? "down" : "up");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const key = e.key.toLowerCase();
    const map: Record<string, Dir> = {
      arrowup: "up",
      w: "up",
      arrowdown: "down",
      s: "down",
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
    };
    const dir = map[key];
    if (!dir) return;
    e.preventDefault();
    tryMove(dir);
  };

  useEffect(() => {
    draw();
  }, [draw, currentNodeId, phase]);

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
    await new Promise((r) => setTimeout(r, 1600));
    const hash =
      "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    setTxHash(hash);
    setMintState("minted");
    console.log("Ritual NFT minted (simulated)", { hash, payload });
  };

  const score = Math.max(0, Math.round(10000 - finalTime * 50 - moves * 2));
  const liveTime = phase === "done" ? finalTime : elapsed;
  const liveScore =
    phase === "ready" ? 0 : Math.max(0, Math.round(10000 - liveTime * 50 - moves * 2));

  const stars = liveScore > 7500 ? 3 : liveScore > 4000 ? 2 : liveScore > 0 ? 1 : 0;

  return (
    <div
      ref={gameRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="w-full max-w-6xl mx-auto px-4 py-6 lg:py-8 outline-none"
    >
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
            <StatCard
              icon={<TrophyIcon />}
              label="Best"
              value={bestTime != null ? fmtClock(bestTime) : "--:--"}
              accent="gold"
            />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_260px] gap-4 lg:gap-6">
        <aside className="order-2 lg:order-1">
          <Panel>
            <PanelTitle className="text-[var(--ritual-glow)]">How to Play</PanelTitle>
            <ul className="space-y-4 mt-3">
              <Instr
                icon={<ArrowRightIcon />}
                title="Read the knot"
                desc="Move one waypoint at a time."
              />
              <Instr
                icon={<MoveIcon />}
                title="Pick a direction"
                desc="Invalid turns flash the token."
              />
              <Instr
                icon={<FlagIcon />}
                title="Reach the exit"
                desc="Green is start. Gold is exit."
              />
            </ul>
          </Panel>
        </aside>

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
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                pointerStartRef.current = null;
              }}
            />
            <svg
              className={`absolute inset-0 w-full h-full rounded-2xl transition-opacity duration-200 ${
                hintsEnabled ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
              }`}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              aria-hidden="true"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                pointerStartRef.current = null;
              }}
            >
              {hints.map((hint) => {
                const active = hint.fromId === currentNodeId || hint.id === hoveredHintId;
                return (
                  <g
                    key={hint.id}
                    transform={`translate(${hint.x} ${hint.y}) rotate(${hint.angle})`}
                    className="pointer-events-auto cursor-help transition-opacity duration-150"
                    opacity={active ? 1 : 0.35}
                    onMouseEnter={() => setHoveredHintId(hint.id)}
                    onMouseLeave={() => setHoveredHintId(null)}
                  >
                    <path
                      d="M8 0 L-5 6 L-2 0 L-5 -6 Z"
                      fill="#4ade80"
                      stroke="#06160f"
                      strokeWidth="1.5"
                    />
                  </g>
                );
              })}
            </svg>
            <div
              key={invalidPulse}
              className={`absolute z-10 rounded-full border border-[#fff4c2] bg-[var(--ritual-gold)] shadow-[0_0_18px_rgba(245,214,138,0.85)] ${
                invalidPulse ? "token-invalid" : ""
              }`}
              style={{
                width: PLAYER_R * 2 + 5,
                height: PLAYER_R * 2 + 5,
                left: `${(playerRender.x / SIZE) * 100}%`,
                top: `${(playerRender.y / SIZE) * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            />
            <button
              type="button"
              onClick={() => setHintsEnabled((v) => !v)}
              className={`absolute right-3 top-3 z-20 ritual-icon-btn ${hintsEnabled ? "is-on" : ""}`}
              aria-label={hintsEnabled ? "Hide hint arrows" : "Show hint arrows"}
              title={hintsEnabled ? "Hide hint arrows" : "Show hint arrows"}
            >
              <BulbIcon />
            </button>
            {phase === "ready" && (
              <Overlay>
                <h2 className="font-display text-2xl md:text-3xl text-center">Navigate the Knot</h2>
                <p className="text-sm opacity-75 max-w-xs text-center">
                  Trace the glowing path from start to exit.
                </p>
                <button onClick={start} className="ritual-btn mt-2">
                  Begin
                </button>
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
                {bestTime != null && (
                  <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--ritual-cream)]/60">
                    Best Time · {fmtClock(bestTime)}
                  </div>
                )}
                <div className="flex flex-col gap-2 w-full max-w-xs mt-3">
                  <button onClick={restart} className="ritual-btn">
                    Play Again
                  </button>
                  {!wallet ? (
                    <button
                      onClick={connectWallet}
                      className="ritual-btn-ghost flex items-center justify-center gap-2"
                    >
                      <WalletIcon /> Connect Wallet to Mint NFT
                    </button>
                  ) : mintState === "minted" ? (
                    <div className="text-center">
                      <div className="text-xs uppercase tracking-[0.25em] text-[var(--ritual-glow)]">
                        NFT Minted on Ritual
                      </div>
                      <div className="font-mono text-[10px] text-[var(--ritual-cream)]/60 mt-1 break-all">
                        {txHash?.slice(0, 18)}…{txHash?.slice(-8)}
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={mintNft}
                      disabled={mintState === "minting"}
                      className="ritual-btn flex items-center justify-center gap-2"
                    >
                      {mintState === "minting" ? "Minting on Ritual…" : "Mint Score NFT on Ritual"}
                    </button>
                  )}
                </div>
              </Overlay>
            )}
            {phase === "loading" && (
              <Overlay>
                <div className="opacity-80">Loading…</div>
              </Overlay>
            )}
          </div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--ritual-gold)] mt-2 drop-shadow-[0_0_8px_rgba(245,214,138,0.6)]">
            Exit
          </div>
        </section>

        <aside className="order-3">
          <Panel>
            <div className="flex items-center gap-2">
              <BulbIcon />
              <PanelTitle className="text-[var(--ritual-glow)] !mb-0">Knot Logic</PanelTitle>
            </div>
            <ul className="space-y-2.5 mt-4 text-sm text-[var(--ritual-cream)]/85">
              <Check>Graph waypoints drive movement</Check>
              <Check>Branch nodes create dead ends</Check>
              <Check>Solution arrows skip dead ends</Check>
              <Check>Timer stops at the exit node</Check>
            </ul>
          </Panel>
        </aside>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-4 lg:gap-6 mt-6">
        <Panel>
          <PanelTitle className="text-[var(--ritual-glow)]">Controls</PanelTitle>
          <p className="text-xs text-[var(--ritual-cream)]/55 -mt-2 mb-4">
            Choose your way to move
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-2">
              <Key>←</Key>
              <Key>↑</Key>
              <Key>→</Key>
              <span className="text-sm text-[var(--ritual-cream)]/75 ml-1">Arrow Keys</span>
            </div>
            <div className="flex items-center gap-2">
              <Key>W</Key>
              <Key>A</Key>
              <Key>S</Key>
              <Key>D</Key>
              <span className="text-sm text-[var(--ritual-cream)]/75 ml-1">WASD</span>
            </div>
            <div className="flex items-center gap-2">
              <Key>
                <MouseIcon />
              </Key>
              <span className="text-sm text-[var(--ritual-cream)]/75 ml-1">Drag / Touch</span>
            </div>
          </div>
          <div className="flex justify-center mt-5">
            <button onClick={restart} className="ritual-btn-ghost flex items-center gap-2">
              <RestartIcon /> Restart
            </button>
          </div>
        </Panel>

        <Panel className="text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--ritual-glow)]">
            Score
          </div>
          <div className="font-display text-5xl text-[var(--ritual-cream)] mt-1">
            {liveScore.toLocaleString()}
          </div>
          <div className="flex justify-center gap-1.5 mt-2">
            {[0, 1, 2].map((i) => (
              <StarShape key={i} filled={i < stars} />
            ))}
          </div>
          <div className="text-xs text-[var(--ritual-cream)]/60 mt-2 tracking-widest">
            {bestTime != null ? fmtClock(bestTime) : "--:--"}
          </div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--ritual-cream)]/45 mt-0.5">
            Best Time
          </div>
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
        .ritual-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          border-radius: 999px;
          color: var(--ritual-cream);
          background: rgba(6,22,15,0.72);
          border: 1px solid rgba(245,241,232,0.22);
          backdrop-filter: blur(8px);
          transition: background .15s ease, border-color .15s ease, color .15s ease;
        }
        .ritual-icon-btn:hover,
        .ritual-icon-btn.is-on {
          color: var(--ritual-glow);
          background: rgba(74,222,128,0.12);
          border-color: rgba(74,222,128,0.55);
        }
        .token-invalid {
          animation: token-shake .24s ease, token-flash .24s ease;
        }
        @keyframes token-shake {
          0%, 100% { margin-left: 0; }
          25% { margin-left: -5px; }
          75% { margin-left: 5px; }
        }
        @keyframes token-flash {
          0%, 100% { box-shadow: 0 0 18px rgba(245,214,138,0.85); }
          50% { box-shadow: 0 0 28px rgba(255,255,255,0.95); }
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

function PanelTitle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-[11px] uppercase tracking-[0.3em] font-semibold mb-3 ${className}`}>
      {children}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent = "green",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "green" | "gold";
}) {
  const color = accent === "gold" ? "var(--ritual-gold)" : "var(--ritual-glow)";
  return (
    <div className="rounded-xl border border-[var(--ritual-glow)]/15 bg-[#0a2418]/70 backdrop-blur-sm px-3 py-2.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[var(--ritual-cream)]/60">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="font-mono text-lg tabular-nums text-[var(--ritual-cream)] mt-1 leading-none">
        {value}
      </div>
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
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        className="mt-1 flex-none text-[var(--ritual-glow)]"
      >
        <path
          d="M5 12l5 5L20 7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      className="text-[var(--ritual-cream)] drop-shadow-[0_0_8px_rgba(74,222,128,0.4)]"
    >
      <path
        d="M20 4l16 16-16 16L4 20 20 4z"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.4"
      />
      <path
        d="M12 12h6v4h4v-4h6v6h-4v4h4v6h-6v-4h-4v4h-6v-6h4v-4h-4v-6z"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
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
      <path
        d="M5 6H3a3 3 0 003 3M19 6h2a3 3 0 01-3 3M10 14h4l-1 4h-2l-1-4zM8 20h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2v6m0 8v6M2 12h6m8 0h6M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 21V4m0 0h11l-2 4 2 4H5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="text-[var(--ritual-glow)] drop-shadow-[0_0_6px_rgba(74,222,128,0.6)]"
    >
      <path
        d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.7.6 1 1.5 1 2.3v1h6v-1c0-.8.3-1.7 1-2.3A7 7 0 0012 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
      <path
        d="M3 12a9 9 0 0115.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 01-15.5 6.3L3 16M3 21v-5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 7a2 2 0 012-2h12a2 2 0 012 2v2H5a2 2 0 00-2-2zm0 4h16a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-6zm14 3a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function StarShape({ filled }: { filled: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "var(--ritual-glow)" : "none"}
      className="text-[var(--ritual-glow)]"
    >
      <path
        d="M12 2l3 7 7 .6-5.3 4.6L18.5 22 12 18l-6.5 4 1.8-7.8L2 9.6 9 9l3-7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
