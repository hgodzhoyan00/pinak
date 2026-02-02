import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

// iOS Safari stability: prefer websocket
const socket = io(SERVER_URL, {
  transports: ["websocket"],
  upgrade: false
});

/* ---------- SORT CONSTANTS ---------- */
const SUIT_ORDER = ["♠", "♥", "♦", "♣"];
const VALUE_ORDER = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

/* ---------- SUIT UI ---------- */
function suitColor(suit) {
  if (suit === "♥" || suit === "♦") return "#ff3b3b";
  return "#0c1a2a";
}

function cardFaceBg(card) {
  if (!card) return "rgba(255,255,255,0.92)";
  if (card.value === "2") return "rgba(255, 247, 214, 0.96)";
  return "rgba(255,255,255,0.94)";
}

/* ---------- THEME TOKENS ---------- */
const stylesTokens = {
  textStrong: "#f2f6ff",
  textMuted: "rgba(242,246,255,0.78)"
};

/* ---------- MINI UI ---------- */
function Badge({ children }) {
  return <span style={styles.badge}>{children}</span>;
}

function MiniCard({ card, selected, sizeStyle }) {
  return (
    <div
      style={{
        ...styles.miniCard,
        ...(sizeStyle || {}),
        background: selected ? "rgba(255, 214, 102, 0.95)" : cardFaceBg(card),
        border: selected ? "1px solid rgba(0,0,0,0.25)" : "1px solid rgba(0,0,0,0.18)"
      }}
    >
      <span style={{ color: suitColor(card.suit), fontWeight: 950 }}>
        {card.value}
        {card.suit}
      </span>
    </div>
  );
}

/* ---------- OPENED SETS (compact fan strip) ---------- */
function FanSet({ set, isTarget, compact = true }) {
  const maxShown = compact ? 6 : 10;
  const shown = (set || []).slice(0, maxShown);
  const extra = (set || []).length - shown.length;

  // Tuning knobs
  const tilt = compact ? 12 : 16;        // degrees
  const spread = compact ? 12 : 16;      // px per step
  const lift = compact ? 10 : 14;        // px arc height
  const dropK = compact ? 0.55 : 0.60;   // arc drop factor

  const count = shown.length || 1;
  const totalW = spread * (count - 1);

  return (
    <div
      style={{
        ...(compact ? styles.fanSetCompact : styles.fanSet),
        outline: isTarget ? "2px solid rgba(255,255,255,0.92)" : "1px solid rgba(255,255,255,0.12)",
        background: isTarget ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.16)"
      }}
    >
      <div style={compact ? styles.fanStackCompact : styles.fanStack}>
        {shown.map((c, i) => {
          const t = count <= 1 ? 0.5 : i / (count - 1);
          const rot = (t - 0.5) * 2 * tilt;
          const x = (t - 0.5) * totalW;
          const y = lift - Math.abs(rot) * dropK;

return (
  <span
    key={c.id || i}
    style={{
      ...(compact ? styles.fanCardCompact : styles.fanCard),
      position: "absolute",
      left: "50%",
      bottom: 0,
      transform: `translateX(-50%) translateX(${x}px) translateY(${-y}px) rotate(${rot}deg)`,
      transformOrigin: "50% 95%",
      background: cardFaceBg(c),
      overflow: "hidden"
    }}
  >
    {/* top-left pip */}
    <div
      style={{
        position: "absolute",
        top: 4,
        left: 4,
        display: "flex",
        flexDirection: "column",
        lineHeight: 1,
        fontWeight: 950,
        fontSize: compact ? 9 : 10,
        color: suitColor(c.suit)
      }}
    >
      <span>{c.value}</span>
      <span style={{ marginTop: 1 }}>{c.suit}</span>
    </div>

    {/* bottom-right pip */}
    <div
      style={{
        position: "absolute",
        bottom: 4,
        right: 4,
        display: "flex",
        flexDirection: "column",
        lineHeight: 1,
        fontWeight: 950,
        fontSize: compact ? 9 : 10,
        color: suitColor(c.suit),
        transform: "rotate(180deg)"
      }}
    >
      <span>{c.value}</span>
      <span style={{ marginTop: 1 }}>{c.suit}</span>
    </div>
  </span>
);
})}

        {extra > 0 && (
          <span
            style={{
              ...(compact ? styles.fanCardCompact : styles.fanCard),
              position: "absolute",
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.25)",
              color: "#fff"
            }}
          >
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
}
/* ---------- SEAT ---------- */
function Seat({
  pos,
  player,
  isMe,
  isTurn,
  target,
  setTarget,
  sfxClick,
  compact,
  hideHeader,
  showSets = true
}) {
  if (!player) return null;

  const headerStyle = { ...styles.seatHeader, ...(isTurn ? styles.seatHeaderTurn : null) };

  // ✅ If you want the bottom seat to be positioned specially, apply it here
  const seatStyle =
    pos === "bottom"
      ? {
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 210, // adjust later if needed
          pointerEvents: "auto",
          zIndex: 50
        }
      : null;

  return (
    <div style={{ ...styles.seat, ...(styles[`seat_${pos}`] || {}), ...(seatStyle || {}) }}>
      {/* HEADER */}
      {!hideHeader && (
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 950,
                color: stylesTokens.textStrong,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: pos === "bottom" ? 240 : 160
              }}
            >
              {player.name}
              {isMe ? " (You)" : ""}
            </div>
            {isTurn && <span style={{ opacity: 0.9 }}>⬅</span>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge>{player.score}</Badge>
            <Badge>{player.hand?.length ?? 0}🂠</Badge>
          </div>
        </div>
      )}

      {/* OPENED SETS */}
      {!compact && showSets && (
        <div style={styles.seatSetsRow}>
          {player.openedSets?.length ? (
            player.openedSets.map((set, i) => {
              const isTarget = target?.playerId === player.id && target?.runIndex === i;
              return (
                <div
                  key={i}
                  onClick={() => {
                    sfxClick?.();
                    setTarget?.({ playerId: player.id, runIndex: i });
                  }}
                  style={{ flex: "0 0 auto", cursor: "pointer", touchAction: "manipulation" }}
                  title="Tap to target this run"
                >
                  <FanSet set={set} isTarget={isTarget} />
                </div>
              );
            })
          ) : (
            <div style={styles.emptySets}>—</div>
          )}
        </div>
      )}
    </div>
  );
}

function RotateOverlay() {
  return (
    <div style={styles.rotateWrap}>
      <div style={styles.rotateCard}>
        <div style={{ fontSize: 44, lineHeight: 1 }}>📱↻</div>
        <div style={{ fontWeight: 950, fontSize: 18, marginTop: 10 }}>Rotate to Landscape</div>
        <div style={{ opacity: 0.85, marginTop: 6, fontWeight: 700 }}>
          This game is locked to landscape mode.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  /* ---------- STATE ---------- */
  const [connected, setConnected] = useState(false);
  const [game, setGame] = useState(null);

  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [teamMode, setTeamMode] = useState(false);
  const [teamPick, setTeamPick] = useState(null);

  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [selected, setSelected] = useState([]);
  const [openCount, setOpenCount] = useState(0);
  const [discardPick, setDiscardPick] = useState(null);
  const [target, setTarget] = useState(null);

  const [soundOn, setSoundOn] = useState(true);
  const audioCtxRef = useRef(null);
  const lastHandSigRef = useRef("");
  const wentOutSentRef = useRef(false);
  const toastTimerRef = useRef(null);

  const lastChatRoomRef = useRef(null); // ✅ ADD HERE

  const [isLandscape, setIsLandscape] = useState(false);

  const [chatOpen, setChatOpen] = useState(true);
  const [chat, setChat] = useState([]);
  const [chatText, setChatText] = useState("");
  const chatEndRef = useRef(null);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function sendChat() {
  const text = chatText.trim();
  if (!text || !game) return;

  const pid = localStorage.getItem("pinak_pid");
  socket.emit("sendChat", { room: game.room, pid, name: me?.name, text });

  setChatText("");
}

  useEffect(() => {
  if (!teamMode) setTeamPick(null);
}, [teamMode]);

  // Auto-scroll chat when a new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length]);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const update = () => setIsLandscape(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
  const html = document.documentElement;
  const body = document.body;

  const prevHtmlOverflow = html.style.overflow;
  const prevBodyOverflow = body.style.overflow;
  const prevBodyPosition = body.style.position;
  const prevBodyWidth = body.style.width;

  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";   // key: prevents page from moving
  body.style.width = "100%";

  return () => {
    html.style.overflow = prevHtmlOverflow;
    body.style.overflow = prevBodyOverflow;
    body.style.position = prevBodyPosition;
    body.style.width = prevBodyWidth;
  };
}, []);

  /* ---------- SOUND HELPERS ---------- */
  function ensureAudio() {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }

  function beep(freq = 440, durMs = 70, type = "sine", gainVal = 0.04) {
    if (!soundOn) return;
    const ctx = ensureAudio();
    if (!ctx) return;

    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = type;
    o.frequency.value = freq;

    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gainVal, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);

    o.connect(g);
    g.connect(ctx.destination);

    o.start(now);
    o.stop(now + durMs / 1000 + 0.02);
  }

  const sfx = {
    click: () => beep(520, 40, "sine", 0.03),
    draw: () => beep(740, 80, "triangle", 0.05),
    deal: () => beep(880, 60, "triangle", 0.04),
    run: () => {
      beep(660, 60, "sine", 0.04);
      setTimeout(() => beep(990, 70, "sine", 0.04), 65);
    },
    discard: () => beep(260, 90, "square", 0.03),
    end: () => beep(420, 55, "sine", 0.03)
  };

/* ---------- SOCKET ---------- */
const reconnectOnceRef = useRef(false);

useEffect(() => {
  const onConnect = () => setConnected(true);
  const onDisconnect = () => setConnected(false);

  const onYouAre = ({ pid }) => {
    if (pid) localStorage.setItem("pinak_pid", pid);
  };

  const onGameState = (state) => {
    setGame(state);

    // pull history once when we first get a state for a room
    if (state?.room && lastChatRoomRef.current !== state.room) {
    lastChatRoomRef.current = state.room;
    socket.emit("getChat", { room: state.room });
}
    const meNext = state.players.find((p) => p.id === socket.id);
    const isMyTurnNext = state.players[state.turn]?.id === socket.id;

    const openLen = state.open?.length || 0;
    setOpenCount((prev) => (prev > openLen ? openLen : prev));

    if (!isMyTurnNext) {
      setSelected([]);
      setDiscardPick(null);
      setTarget(null);
    }

    // clean invalid discardPick
    setDiscardPick((prev) => (prev && !meNext?.hand?.some((c) => c.id === prev) ? null : prev));

    // clean invalid target
    setTarget((prev) => {
      if (!prev) return null;
      const owner = state.players.find((p) => p.id === prev.playerId);
      if (!owner || !owner.openedSets?.[prev.runIndex]) return null;
      return prev;
    });

    if (!state.roundOver) wentOutSentRef.current = false;
  };

  const onErrorMsg = (msg) => {
    const m = msg || "Action rejected";
    setError(m);
    setToast(m);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2200);
  };

  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("youAre", onYouAre);
  socket.on("gameState", onGameState);
  socket.on("errorMsg", onErrorMsg);
  
const onChatHistory = (payload = {}) => {
  const hist = payload.chat;
  setChat(Array.isArray(hist) ? hist.slice(-60) : []);
};

const onChatMsg = (payload) => {
  // supports server sending { msg } OR msg directly
  const msg = payload?.msg ?? payload;
  if (!msg) return;

  setChat((prev) => {
    if (msg.id && prev.some((m) => m.id === msg.id)) return prev; // dedupe
    return [...prev, msg].slice(-60);
  });
};

socket.on("chatHistory", onChatHistory);
socket.on("chatMsg", onChatMsg);

  return () => {
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("youAre", onYouAre);
    socket.off("gameState", onGameState);
    socket.off("errorMsg", onErrorMsg);
    socket.off("chatHistory", onChatHistory);
    socket.off("chatMsg", onChatMsg)
  };
  // IMPORTANT: do NOT depend on discardPick/target/soundOn here
}, []);
/* ---------- AUTO RECONNECT ---------- */
useEffect(() => {
  if (!connected) return;
  if (reconnectOnceRef.current) return;

  const savedRoom = localStorage.getItem("pinak_room");
  const pid = localStorage.getItem("pinak_pid");

  // only attempt if we have identity + last room and we're not already in-game
  if (savedRoom && pid && !game) {
    reconnectOnceRef.current = true;
    socket.emit("reconnectRoom", { room: savedRoom, pid });
  }
}, [connected, game]);

 /* ---------- DERIVED ---------- */
  const me = useMemo(() => game?.players?.find((p) => p.id === socket.id), [game]);

  const isMyTurn = useMemo(() => {
    if (!game || !me) return false;
    return game.players[game.turn]?.id === me.id;
  }, [game, me]);

  const canAct = !!game && !!me && !game.roundOver && !game.gameOver;

  const canDraw = canAct && isMyTurn && !me.mustDiscard && !me.canDiscard;
  const canSelectOpen = canDraw;

const hasDrawnThisTurn = !!me?.canDiscard; // server sets canDiscard=true after ANY draw

const canCreateRun = canAct && isMyTurn && hasDrawnThisTurn && selected.length >= 3;
const canAddToRun  = canAct && isMyTurn && hasDrawnThisTurn && !!target && selected.length >= 1;

  const canDiscard = canAct && isMyTurn && !!discardPick && (me.mustDiscard || me.canDiscard);
  const canEndTurn = canAct && isMyTurn && !me.mustDiscard;

  const canContinueRound = !!game && !!me && game.roundOver && !game.gameOver;

  const teamSummary = useMemo(() => {
  if (!game?.teamMode) return null;

  // Prefer server-provided teams object if you add it later
  if (game.teams?.[0] && game.teams?.[1]) {
    return {
      0: { label: game.teams[0].label || "?", score: game.teams[0].score ?? 0 },
      1: { label: game.teams[1].label || "?", score: game.teams[1].score ?? 0 }
    };
  }

  // Fallback: compute on client from players
  const initial = (name) => (String(name || "").trim()[0] || "?").toUpperCase();

  const t0 = (game.players || []).filter((p) => p.team === 0);
  const t1 = (game.players || []).filter((p) => p.team === 1);

  return {
    0: {
      label: t0.map((p) => initial(p.name)).join("") || "?",
      score: t0.reduce((s, p) => s + (p.score ?? 0), 0)
    },
    1: {
      label: t1.map((p) => initial(p.name)).join("") || "?",
      score: t1.reduce((s, p) => s + (p.score ?? 0), 0)
    }
  };
}, [game]);

  /* ---------- SORTED HAND ---------- */
  const sortedHand = useMemo(() => {
    if (!me?.hand) return [];
    return [...me.hand].sort((a, b) => {
      if (a.value === "2" && b.value !== "2") return 1;
      if (b.value === "2" && a.value !== "2") return -1;
      if (a.value === "2" && b.value === "2") return 0;

      const suitDiff = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit);
      if (suitDiff !== 0) return suitDiff;

      return VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value);
    });
  }, [me?.hand]);

  /* ---------- DEAL SOUND TRIGGER ---------- */
  useEffect(() => {
    if (!me?.hand) return;
    const sig = [...me.hand].map((c) => c.id).sort().join("|");
    if (sig && sig !== lastHandSigRef.current) {
      if (game) sfx.deal();
      lastHandSigRef.current = sig;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.hand, game]);

  /* ---------- AUTO DISCARD PICK ---------- */
  useEffect(() => {
    if (!me || !canAct || !isMyTurn) return;

    const discardAllowed = me.mustDiscard || me.canDiscard;
    if (!discardAllowed) return;

    const handIds = new Set((me.hand || []).map((c) => c.id));
    if (discardPick && !handIds.has(discardPick)) {
      setDiscardPick(null);
      return;
    }

    if (!discardPick) {
      for (let i = selected.length - 1; i >= 0; i--) {
        if (handIds.has(selected[i])) {
          setDiscardPick(selected[i]);
          return;
        }
      }
      if (me.hand?.[0]?.id) setDiscardPick(me.hand[0].id);
    }
  }, [me, canAct, isMyTurn, selected, discardPick]);

/* ---------- AUTO END ROUND (only after draw) ---------- */
useEffect(() => {
  if (!game || !me) return;
  if (!isMyTurn) return;
  if (game.roundOver || game.gameOver) return;

  const handEmpty = (me.hand?.length || 0) === 0;
  if (!handEmpty) return;

  // ✅ MUST have drawn this turn (prevents ending without drawing)
  const alreadyDrewThisTurn = !canDraw;
  if (!alreadyDrewThisTurn) return;

  if (wentOutSentRef.current) return;
  wentOutSentRef.current = true;

  // clear local UI state
  setSelected([]);
  setDiscardPick(null);
  setTarget(null);

  ensureAudio();
  sfx.run();

  safeEmit("playerWentOut", { room: game.room });
}, [game, me, isMyTurn, canDraw]);
/* ---------- RESET wentOut FLAG WHEN HAND REFILLS ---------- */
useEffect(() => {
  if (!me) return;
  if ((me.hand?.length || 0) > 0) {
    wentOutSentRef.current = false;
  }
}, [me?.hand?.length]);

  /* ---------- HELPERS ---------- */
  function toggleCard(id) {
    if (!canAct || !isMyTurn) return;
    sfx.click();
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
    setDiscardPick(id);
  }

  function selectOpen(i) {
    if (!canSelectOpen) return;
    sfx.click();
    const openLen = game?.open?.length || 0;
    setOpenCount(Math.min(i + 1, openLen));
  }

  function continueNextRound() {
    if (!canContinueRound) return;
    ensureAudio();
    sfx.run();
    socket.emit("continueGame", { room: game.room });

    setSelected([]);
    setDiscardPick(null);
    setTarget(null);
    setOpenCount(0);
  }
  function startNewGame() {
  if (!game?.gameOver) return;
  ensureAudio();
  sfx.run();

  // local UI cleanup
  setSelected([]);
  setDiscardPick(null);
  setTarget(null);
  setOpenCount(0);

  safeEmit("newGame", { room: game.room });
}

  function safeEmit(eventName, payload) {
    // If buttons are clickable but nothing happens, this guard prevents “silent taps”
    if (!socket.connected) {
      setToast("Disconnected…");
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(""), 1400);
      return;
    }
    socket.emit(eventName, payload);
  }

  function leaveToLobby() {
  // prevent auto-reconnect into the same room
  localStorage.removeItem("pinak_room");

  // reset UI state
  setGame(null);
  setSelected([]);
  setDiscardPick(null);
  setTarget(null);
  setOpenCount(0);
  setError("");
  setToast("");
}

  /* ---------- CONNECTION ---------- */
  if (!connected) return <h2 style={{ padding: 20, color: "#eaf2ff" }}>Connecting…</h2>;

  /* ---------- LANDSCAPE LOCK ---------- */
  if (!isLandscape) {
    return (
      <div style={styles.table}>
        <RotateOverlay />
      </div>
    );
  }

  /* ---------- LOBBY ---------- */
  if (!game) {
    return (
      <div style={styles.table}>
        <div style={styles.pageLobby}>
          <div style={styles.headerRow}>
            <h2 style={{ margin: 0, color: stylesTokens.textStrong }}>Pinak</h2>

            <button
              style={styles.soundBtn}
              onClick={() => {
                ensureAudio();
                setSoundOn((v) => !v);
              }}
              title="Sound"
            >
              {soundOn ? "🔊" : "🔇"}
            </button>
          </div>

          <div style={styles.cardSection}>
            <input style={styles.input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input style={styles.input} placeholder="Room code" value={room} onChange={(e) => setRoom(e.target.value)} />

            <label style={styles.checkboxRow}>
              <input type="checkbox" checked={teamMode} onChange={(e) => setTeamMode(e.target.checked)} />
              <span style={{ marginLeft: 8, color: stylesTokens.textStrong, fontWeight: 950 }}>Team Mode</span>
            </label>
{teamMode && (
  <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
    <button
      style={{
        ...styles.secondaryBtn,
        width: "auto",
        padding: "10px 12px",
        opacity: teamPick === 0 ? 1 : 0.7,
        border: teamPick === 0 ? "1px solid rgba(120, 220, 255, 0.55)" : styles.secondaryBtn.border
      }}
      onClick={() => setTeamPick(0)}
      type="button"
    >
      Team 1
    </button>

    <button
      style={{
        ...styles.secondaryBtn,
        width: "auto",
        padding: "10px 12px",
        opacity: teamPick === 1 ? 1 : 0.7,
        border: teamPick === 1 ? "1px solid rgba(120, 220, 255, 0.55)" : styles.secondaryBtn.border
      }}
      onClick={() => setTeamPick(1)}
      type="button"
    >
      Team 2
    </button>
  </div>
)}
            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
<button
  style={styles.primaryBtn}
  onClick={() => {
    ensureAudio();
    sfx.click();

    // ✅ remember room for refresh/PWA resume
    localStorage.setItem("pinak_room", room);

    // ✅ persistent player id (may not exist yet)
    const pid = localStorage.getItem("pinak_pid");

    safeEmit("createRoom", { room, name, teamMode, pid, team: teamMode ? teamPick : null });
  }}
  disabled={!name || !room || (teamMode && teamPick === null)}
>
  Create
</button>

<button
  style={styles.secondaryBtn}
  onClick={() => {
    ensureAudio();
    sfx.click();

    // ✅ remember room for refresh/PWA resume
    localStorage.setItem("pinak_room", room);

    // ✅ persistent player id (may not exist yet)
    const pid = localStorage.getItem("pinak_pid");

    safeEmit("joinRoom", { room, name, pid, team: teamMode ? teamPick : null });
  }}
  disabled={!name || !room || (teamMode && teamPick === null)}
>
  Join
</button>            </div>

            {error && <p style={{ color: "#ff7b7b", marginTop: 10, fontWeight: 900 }}>{error}</p>}
          </div>

          {toast && <div style={styles.toast}>{toast}</div>}
        </div>
      </div>
    );
  }

  if (!me) return <p style={{ padding: 16, color: stylesTokens.textStrong }}>Syncing…</p>;

  const openTopFirst = [...(game.open || [])].reverse();

  /* ---------- SEAT MAPPING ---------- */
  const players = game.players || [];
  const myIndex = Math.max(0, players.findIndex((p) => p.id === me.id));
  const n = players.length;

  const pBottom = players[myIndex];
  const pLeft = n >= 3 ? players[(myIndex + 1) % n] : null;
  const pTop = n >= 2 ? players[(myIndex + 2) % n] : null;
  const pRight = n >= 4 ? players[(myIndex + 3) % n] : null;
  const topPlayer = n === 2 ? players[(myIndex + 1) % n] : pTop;

  /* ---------- ANIM ---------- */
  const handVariants = { hidden: {}, show: { transition: { staggerChildren: 0.02 } } };
  const cardVariants = {
    hidden: { opacity: 0, y: 10, scale: 0.98 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 420, damping: 28 } }
  };

  const fanCount = sortedHand.length || 1;

  const xSpread = Math.min(260, 150 + fanCount * 7.0);
  const fanMax = Math.min(70, 34 + fanCount * 1.05);

  const yLift = 28;
  const dropFactor = 0.24;
  
  const handCardSize = { width: 66, height: 84, fontSize: 16, borderRadius: 12 };
  const miniCardSizeStyle = { width: 36, height: 50, borderRadius: 12 };

return (
  <div style={styles.table}>
    {/* TOP BAR */}
    <div style={styles.topBar}>
      <div style={styles.topBarLeft}>
        <div style={styles.miniLabel}>Room</div>
        <div style={styles.title}>{game.room}</div>
      </div>

      <div style={styles.topBarCenter}>
        {isMyTurn && !me.mustDiscard && !game.roundOver && !game.gameOver && (
          <div style={styles.turnPillTop}>🔥 YOUR TURN</div>
        )}
      </div>

<div style={styles.topBarRight}>
  <div style={{ textAlign: "right" }}>
    <div style={styles.miniLabel}>Turn</div>
    <div style={styles.title}>{isMyTurn ? "You" : game.players[game.turn]?.name}</div>
  </div>

  <button
    style={styles.leaveBtn}
    onClick={() => {
      ensureAudio();
      sfx.click();
      leaveToLobby();
    }}
    title="Back to Lobby"
  >
    ⬅
  </button>

  <button
    style={styles.soundBtn}
    onClick={() => {
      ensureAudio();
      setSoundOn((v) => !v);
    }}
    title="Sound"
  >
    {soundOn ? "🔊" : "🔇"}
  </button>
</div>    
</div>

{/* BANNER */}
{(game.roundOver || game.gameOver) && (
  <div style={styles.bannerNeutral}>
    <div>
      {game.gameOver ? "🏁 Game Over" : "✅ Round Over"}
    </div>

    {/* ROUND OVER (but game not finished yet) */}
    {game.roundOver && !game.gameOver && (
      <button
        style={{ ...styles.primaryBtn, marginTop: 10 }}
        onClick={continueNextRound}
      >
        ▶️ Start Next Round
      </button>
    )}

    {/* GAME OVER ONLY */}
    {game.gameOver && (
      <button
        style={{ ...styles.primaryBtn, marginTop: 10 }}
        onClick={startNewGame}
      >
        🔁 Start New Game
      </button>
    )}
  </div>
)}
    {/* TABLE AREA */}
    <div style={styles.tableArea}>
      <div style={styles.rowTop}>
        <Seat
          pos="top"
          player={topPlayer}
          isMe={false}
          isTurn={game.players[game.turn]?.id === topPlayer?.id}
          target={target}
          setTarget={setTarget}
          sfxClick={sfx.click}
          compact={true}
          hideHeader={true}
        />
      </div>

<div style={{ ...styles.rowMid, alignItems: "flex-start" }}>
  {/* LEFT */}
  <div style={styles.midSide}>
    <Seat
      pos="left"
      player={pLeft}
      isMe={false}
      isTurn={game.players[game.turn]?.id === pLeft?.id}
      target={target}
      setTarget={setTarget}
      sfxClick={sfx.click}
      compact={true}
      hideHeader={true}
    />

    <div style={styles.runsRail}>
      {/* TEAM MODE HEADER */}
      {game.teamMode && teamSummary && (
        <div style={styles.runsRailTeamHeader}>
          <span style={styles.runsRailTeamSide}>
            <span style={styles.runsRailTeamLabel}>{teamSummary[0].label}</span>
            <span style={styles.runsRailTeamScorePill}>{teamSummary[0].score}</span>
          </span>

          <span style={styles.runsRailTeamDivider}>—</span>

          <span style={{ ...styles.runsRailTeamSide, justifyContent: "flex-end" }}>
            <span style={styles.runsRailTeamScorePill}>{teamSummary[1].score}</span>
            <span style={styles.runsRailTeamLabel}>{teamSummary[1].label}</span>
          </span>
        </div>
      )}

      {/* PLAYER BLOCKS */}
      {(() => {
        const list = game.teamMode
          ? [...game.players].sort((a, b) => (a.team ?? 0) - (b.team ?? 0))
          : game.players;

        return list.map((p) => (
          <div key={p.id} style={styles.runsRailBlock}>
            <div style={styles.runsRailNameRow}>
              <span style={styles.runsRailNameText}>
                {p.name}
                {p.id === me.id ? " (You)" : ""}
              </span>

              {!game.teamMode && <span style={styles.runsRailScore}>{p.score ?? 0}</span>}
            </div>

            {p.openedSets?.length ? (
              <div style={styles.runsRailSets}>
                {p.openedSets.map((set, i) => {
                  const isTarget = target?.playerId === p.id && target?.runIndex === i;
                  return (
                    <div
                      key={i}
                      onClick={() => {
                        sfx.click();
                        setTarget({ playerId: p.id, runIndex: i });
                      }}
                      style={{ cursor: "pointer", touchAction: "manipulation" }}
                      title="Tap to target this run"
                    >
                      <FanSet set={set} isTarget={isTarget} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={styles.runsRailEmpty}>—</div>
            )}
          </div>
        ));
      })()}
    </div>
  </div>

{/* CENTER */}
<div style={styles.midCenter}>
  <div style={styles.center}>
    <div style={styles.centerCard}>
      <div style={styles.centerHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 950 }}>Open Stack</span>
          <Badge>Pick: {openCount}</Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge>Target: {target ? "✓" : "—"}</Badge>
        </div>
      </div>

      <div style={styles.centerOpenRow}>
        {openTopFirst.map((c, i) => (
          <div
            key={c.id || i}
            onClick={() => selectOpen(i)}
            style={{
              cursor: canSelectOpen ? "pointer" : "not-allowed",
              opacity: canSelectOpen ? 1 : 0.45,
              flex: "0 0 auto",
              touchAction: "manipulation",
            }}
          >
            <MiniCard card={c} selected={i < openCount} sizeStyle={miniCardSizeStyle} />
          </div>
        ))}
      </div>

      <div style={styles.centerDrawRowCompact}>
        <button
          style={styles.drawBtnCompact}
          disabled={!canDraw}
          onClick={() => {
            ensureAudio();
            sfx.draw();
            safeEmit("drawClosed", { room: game.room });
          }}
          title="Draw 1 from Closed"
        >
          🂠 <span style={styles.drawBtnText}>Closed</span>
        </button>

        <button
          style={styles.drawBtnCompact}
          disabled={!canDraw || openCount < 1 || openCount > (game.open?.length || 0)}
          onClick={() => {
            ensureAudio();
            sfx.draw();
            safeEmit("drawOpen", { room: game.room, count: openCount });
          }}
          title="Draw from Open"
        >
          🂡 <span style={styles.drawBtnText}>Open</span>
        </button>
      </div>
    </div>
  </div>
</div>
{/* RIGHT */}
<div style={styles.midSide}>
  <Seat
    pos="right"
    player={pRight}
    isMe={false}
    isTurn={game.players[game.turn]?.id === pRight?.id}
    target={target}
    setTarget={setTarget}
    sfxClick={sfx.click}
    compact={true}
    hideHeader={true}
  />
</div>
</div>
  {/* CHAT */}
  <div
    style={{
      ...styles.chatRail,
      ...(chatOpen ? null : styles.chatRailCollapsed),
    }}
  >
    <div style={styles.chatHeader}>
      <div style={{ fontWeight: 950 }}>Chat</div>
      <button
        onClick={() => setChatOpen((v) => !v)}
        style={styles.chatToggleBtn}
        type="button"
      >
        {chatOpen ? "—" : "+"}
      </button>
    </div>

    {chatOpen && (
      <>
        <div style={styles.chatBody}>
          {(chat || []).map((m, i) => (
            <div key={m.id || i}>
              <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 900 }}>
                {m.name}
              </div>
              <div style={styles.chatBubble}>{m.text}</div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div style={styles.chatInputRow}>
          <input
            style={styles.chatInput}
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendChat()}
            placeholder="Type…"
          />
          <button style={styles.chatSendBtn} onClick={sendChat} type="button">
            Send
          </button>
        </div>
      </>
    )}
  </div>
</div>   {/* HAND DOCK (outside tableArea so it never stretches center) */}
    <div style={styles.handDock}>
      <div style={styles.handDockMeta}>
        <span>Run: {selected.length}</span>
        <span>Discard: {discardPick ? "✓" : "—"}</span>
      </div>

{(() => {
const fanCountLocal = sortedHand.length || 1;

// Smooth scaling: tight for small hands, wide for huge hands
const spreadTotal = Math.min(
  620,
  Math.max(180, 120 + fanCountLocal * 22) // 5 cards ~230, 12 cards ~384, 23 cards ~626 (clamped)
);

// Rotation: gentle for small hands, stronger as hand grows
const fanMax = Math.min(
  70,
  Math.max(28, 18 + fanCountLocal * 2.0) // 5 cards ~28, 12 cards ~42, 23 cards ~64
);

const yLift = 28;

// Drop: reduce droop for big hands so edges don't sink too far
const dropFactor = fanCountLocal <= 10 ? 0.34 : fanCountLocal <= 18 ? 0.26 : 0.20;
  return (
    <motion.div
      variants={handVariants}
      initial="hidden"
      animate="show"
      style={{ ...styles.handFanDock, position: "relative" }}
    >
      <AnimatePresence initial={false}>
{sortedHand.map((c, idx) => {
  const isRunSelected = selected.includes(c.id);
  const isDiscard = discardPick === c.id;

  const t = fanCountLocal <= 1 ? 0.5 : idx / (fanCountLocal - 1);
  const rot = (t - 0.5) * 2 * fanMax;

  // ORIGINAL: center position across the fan
  const hitX = (t - 0.5) * spreadTotal;

  // tiny RIGHT-only hitbox nudge (does NOT move the visual card)
  const edge01 = (t - 0.5) * 2;           // -1..+1
  const laneNudge = Math.max(0, edge01) * 10; // max 10px (safe)

  // Visual arc only
  const drop = Math.abs(rot) * dropFactor;
  const visualY = yLift - drop + (isRunSelected ? -10 : 0) + (isDiscard ? -14 : 0);

  // Tap lanes never overlap
  const stepLocal = fanCountLocal <= 1 ? handCardSize.width : spreadTotal / (fanCountLocal - 1);
  let laneW = Math.max(26, Math.min(handCardSize.width, stepLocal * 0.98));

  // Edge boost (easier edge taps)
  const edgeBoost = Math.abs(t - 0.5) * 2; // 0 center → 1 edges
  laneW = Math.min(handCardSize.width + 18, laneW + edgeBoost * 20);

  const laneH = handCardSize.height + 34;

  // Stable stacking order only (never change on selection)
  const z = 1000 + idx;

  return (
    <div
      key={c.id}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCard(c.id);
      }}
      style={{
        position: "absolute",
        left: "50%",
        bottom: 0,
        transform: `translateX(calc(-50% + ${hitX + laneNudge}px))`,
        width: laneW,
        height: laneH,
        zIndex: z,
        pointerEvents: "auto",
        touchAction: "none"
      }}
    >
      <motion.div
        variants={cardVariants}
        style={{
          ...styles.card,
          ...handCardSize,
          position: "absolute",
          left: "50%",
          bottom: 0,
          transform: "translateX(-50%)",
          padding: 6,
          rotate: rot,
          y: visualY,
          x: -laneNudge,
          transformOrigin: "50% 95%",
          background: cardFaceBg(c),
          border: isDiscard
            ? "2px solid #ff4d4d"
            : isRunSelected
            ? "2px solid rgba(255,255,255,0.78)"
            : "1px solid rgba(0,0,0,0.22)",
          pointerEvents: "none"
        }}
      >
        {/* top-left pip */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            display: "flex",
            flexDirection: "column",
            lineHeight: 1,
            fontWeight: 950,
            fontSize: 12,
            color: suitColor(c.suit)
          }}
        >
          <span>{c.value}</span>
          <span style={{ marginTop: 2 }}>{c.suit}</span>
        </div>

        {/* center suit watermark */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 18,
            fontWeight: 900,
            opacity: 0.18,
            color: suitColor(c.suit),
            pointerEvents: "none"
          }}
        >
          {c.suit}
        </div>

        {/* bottom-right pip */}
        <div
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            display: "flex",
            flexDirection: "column",
            lineHeight: 1,
            fontWeight: 950,
            fontSize: 12,
            color: suitColor(c.suit),
            transform: "rotate(180deg)"
          }}
        >
          <span>{c.value}</span>
          <span style={{ marginTop: 2 }}>{c.suit}</span>
        </div>
      </motion.div>
    </div>
  );
})}
      </AnimatePresence>
    </motion.div>
  );
})()}
    </div>
    

    {/* TOAST */}
      {toast && <div style={styles.toast}>{toast}</div>}


{/* ACTION BAR */}
<div style={styles.stickyBar}>
  <div style={styles.stickyInner4}>
    <button
      style={styles.primaryBtnTiny}
      disabled={!canCreateRun}
      onClick={() => {
        ensureAudio();
        sfx.run();

        const handLen = me?.hand?.length ?? 0;
        const willEmpty = selected.length >= 1 && selected.length === handLen;

        safeEmit("openRun", { room: game.room, cardIds: selected });

        if (willEmpty) {
          socket.emit("playerWentOut", { room: game.room });
        }

        setSelected([]);
        setDiscardPick(null);
      }}
      type="button"
    >
      Create Run
    </button>

    <button
      style={styles.primaryBtnTiny}
      disabled={!canAddToRun}
      onClick={() => {
        if (!target) return;

        ensureAudio();
        sfx.run();

        const handLen = me?.hand?.length ?? 0;
        const willEmpty = selected.length >= 1 && selected.length === handLen;

        safeEmit("addToRun", {
          room: game.room,
          targetPlayer: target.playerId,
          runIndex: target.runIndex,
          cardIds: selected
        });

        if (willEmpty) {
          socket.emit("playerWentOut", { room: game.room });
        }

        setSelected([]);
        setDiscardPick(null);
      }}
      type="button"
    >
      Add
    </button>

    <button
      style={styles.dangerBtnTiny}
      disabled={!canDiscard}
      onClick={() => {
        ensureAudio();
        sfx.discard();

        const idx = me?.hand?.findIndex((c) => c.id === discardPick);
        if (idx == null || idx < 0) return;

        safeEmit("discard", { room: game.room, index: idx });
        setSelected([]);
        setDiscardPick(null);
      }}
      type="button"
    >
      {me?.mustDiscard ? "Discard!" : "Discard"}
    </button>

    <button
      style={styles.secondaryBtnTiny}
      disabled={!canEndTurn}
      onClick={() => {
        ensureAudio();
        sfx.end();

        safeEmit("endTurn", { room: game.room });
        setSelected([]);
        setDiscardPick(null);
        setTarget(null);
        setOpenCount(0);
      }}
      type="button"
    >
      End Turn
    </button>
  </div>
</div>    </div>
  );
}
/* ---------- STYLES ---------- */
  const LEFT_RAIL_W = 240;
  const RIGHT_RAIL_W = 240;
  const RAIL_GAP = 8;

const styles = {
  table: {
    height: "100svh",
    width: "100%",
    overflow: "hidden",
    boxSizing: "border-box",
    background:
      "radial-gradient(1200px 600px at 20% 0%, rgba(255,255,255,0.10), transparent 55%)," +
      "radial-gradient(900px 500px at 90% 20%, rgba(0,0,0,0.25), transparent 60%)," +
      "linear-gradient(180deg, #0b3b2e 0%, #06261e 60%, #041b15 100%)",
    color: stylesTokens.textStrong,
    paddingTop: 0,
    paddingBottom: 0
  },

  rotateWrap: {
    minHeight: "100svh",
    display: "grid",
    placeItems: "center",
    padding: 16
  },

  rotateCard: {
    width: "min(420px, 92vw)",
    textAlign: "center",
    padding: 18,
    borderRadius: 18,
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 16px 50px rgba(0,0,0,0.28)",
    backdropFilter: "blur(12px)"
  },

  pageLobby: { padding: 14, maxWidth: 520, margin: "0 auto", fontFamily: "system-ui" },

  miniLabel: { fontSize: 12, opacity: 0.85, color: stylesTokens.textMuted, fontWeight: 800 },
  title: { fontSize: 18, fontWeight: 950, letterSpacing: 0.2, color: stylesTokens.textStrong },

  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginBottom: 10 },

  soundBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.28)",
    color: "#fff",
    fontWeight: 950,
    fontSize: 18,
    cursor: "pointer",
    touchAction: "manipulation"
  },

  cardSection: {
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 14,
    padding: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
    marginBottom: 10,
    backdropFilter: "blur(10px)"
  },

  bannerNeutral: {
    maxWidth: 1100,
    margin: "0 auto",
    background: "rgba(0,0,0,0.30)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 14,
    padding: "10px 12px",
    textAlign: "center",
    fontWeight: 950,
    marginBottom: 10
  },

  input: {
    display: "block",
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.28)",
    color: "#fff",
    marginBottom: 10,
    fontSize: 16,
    outline: "none"
  },

  checkboxRow: { display: "flex", alignItems: "center", marginTop: 4 },

tableArea: {
  width: "100%",
  padding: "8px 12px",
  display: "grid",
  gridTemplateRows: "auto 1fr auto",
  gap: 8,

  /* DO NOT constrain height aggressively */
  minHeight: 0,

  /* leave space above hand dock */
  paddingBottom: 220,

  boxSizing: "border-box"
},

  center: { position: "relative", width: "100%" },

  centerCard: {
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 16,
    padding: 10,
    boxShadow: "0 14px 40px rgba(0,0,0,0.22)",
    backdropFilter: "blur(10px)",
    marginTop: -36,
    position: "relative",
    zIndex: 10
  },

  centerHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6 },

  centerOpenRow: {
    display: "flex",
    gap: 8,
    flexWrap: "nowrap",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    paddingBottom: 6,
    marginBottom: 10
  },

  centerDrawRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 6 },

  squareBtn: {
    height: 46,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.28)",
    color: "#fff",
    fontWeight: 950,
    fontSize: 18,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    boxShadow: "0 10px 22px rgba(0,0,0,0.16)",
    userSelect: "none",
    touchAction: "manipulation"
  },

  squareBtnLabel: { fontSize: 11, fontWeight: 900, opacity: 0.9, marginTop: -10 },

  centerDivider: { height: 1, background: "rgba(255,255,255,0.12)", margin: "10px 0" },

  scoreMini: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 },

  scoreMiniRow: { display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 12, gap: 10 },

  turnPill: {
    position: "absolute",
    top: -6,
    left: "50%",
    transform: "translateX(-50%)",
    fontWeight: 950,
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.30)",
    border: "1px solid rgba(255,255,255,0.12)",
    fontSize: 12,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    marginBottom: 6,
    marginTop: -10
},

  seat: { position: "relative", width: "100%", maxWidth: "unset", pointerEvents: "auto" },

  rowTop: { minHeight: 64 },

  rowMid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr)",
    gap: 8,
    alignItems: "flex-start",
    minHeight: 0
  },

  midCenter: {
  minWidth: 0,          // ✅ allows center column to shrink instead of overflowing
  display: "flex",
  flexDirection: "column",
},

midSide: {
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  justifyContent: "flex-start", // ✅ keeps chat at top
  gap: 12, // optional spacing between Seat + Chat
},

  rowBottom: { 
    minHeight: 0,
    position: "relative",
    zIndex: 2,          // below centerCard (we’ll set centerCard higher)
    pointerEvents: "auto" 
  },

  seatHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    background: "rgba(0,0,0,0.26)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: "8px 10px",
    boxShadow: "0 10px 24px rgba(0,0,0,0.20)"
  },

  seatHeaderTurn: {
    border: "1px solid rgba(120, 220, 255, 0.55)",
    boxShadow: "0 0 0 2px rgba(120,220,255,0.18), 0 10px 24px rgba(0,0,0,0.25)"
  },

  seatSetsRow: {
    marginTop: 8,
    display: "flex",
    gap: 8,
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    paddingBottom: 6
  },

  emptySets: { color: stylesTokens.textMuted, fontWeight: 900, padding: "6px 2px" },

  fanSet: { 
    position: "relative",
    display: "block ",
    flex: "0 0 auto", 
    borderRadius: 14, 
    padding: "8px 10px", 
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
  },

  fanSetRow: { display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center" },

  fanCard: {
    width: 34,
    height: 46,
    borderRadius: 12,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid rgba(0,0,0,0.18)",
    fontWeight: 950,
    fontSize: 12,
    boxShadow: "0 10px 22px rgba(0,0,0,0.18)"
  },

  handZone: {
    marginTop: 8,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 10,
    backdropFilter: "blur(10px)",
    overflow: "hidden"
  },

  handMetaRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 8
  },

  handFanRowTight: {
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-end",
    paddingBottom: 2
  },

  card: {
    width: 56,
    height: 76,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontWeight: 950,
    fontSize: 16,
    userSelect: "none",
    boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
    flex: "0 0 auto"
  },

  miniCard: {
    width: 52,
    height: 68,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
    boxShadow: "0 10px 24px rgba(0,0,0,0.20)"
  },

  badge: {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: stylesTokens.textStrong,
    fontWeight: 950
  },

  primaryBtn: {
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(0,0,0,0.10))",
    color: "#fff",
    fontWeight: 950,
    fontSize: 15,
    width: "100%",
    boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
    cursor: "pointer",
    touchAction: "manipulation"
  },

  secondaryBtn: {
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.28)",
    color: "#fff",
    fontWeight: 950,
    fontSize: 15,
    width: "100%",
    boxShadow: "0 10px 24px rgba(0,0,0,0.16)",
    cursor: "pointer",
    touchAction: "manipulation"
  },

  primaryBtnTiny: {
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(0,0,0,0.10))",
    color: "#fff",
    fontWeight: 950,
    fontSize: 13,
    padding: "0 10px",
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(0,0,0,0.16)",
    whiteSpace: "nowrap",
    touchAction: "manipulation"
  },

  secondaryBtnTiny: {
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.28)",
    color: "#fff",
    fontWeight: 950,
    fontSize: 13,
    padding: "0 10px",
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(0,0,0,0.14)",
    whiteSpace: "nowrap",
    touchAction: "manipulation"
  },

  dangerBtnTiny: {
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(255, 77, 77, 0.65)",
    background: "linear-gradient(180deg, #ff3b3b, #b10000)",
    color: "#fff",
    fontWeight: 950,
    fontSize: 13,
    padding: "0 10px",
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(0,0,0,0.16)",
    whiteSpace: "nowrap",
    touchAction: "manipulation"
  },

  stickyBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 8,
    background: "rgba(2, 10, 8, 0.78)",
    borderTop: "1px solid rgba(255,255,255,0.12)",
    backdropFilter: "blur(14px)",
    zIndex: 999,
    paddingBottom: "calc(8px + env(safe-area-inset-bottom))"
  },

  stickyInner4: {
    maxWidth: 1100,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 8
  },

  toast: {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: 92,
    background: "rgba(0,0,0,0.86)",
    color: "#fff",
    padding: "10px 12px",
    borderRadius: 999,
    fontWeight: 950,
    fontSize: 13,
    maxWidth: 340,
    textAlign: "center",
    zIndex: 9999
  },

  handDock: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 70, // sits just above action bar
    height: 220,
    pointerEvents: "none",
    zIndex: 600
},

  handDockMeta: {
    position: "absolute",
    right: 10,
    bottom: 40,              // pushes it down near the buttons
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    fontWeight: 900,
    opacity: 0.9,
    pointerEvents: "none"    // prevents blocking taps
},

  handFanDock: {
    position: "relative",           // ✅ cards anchor to this
    width: "min(1100px, 98vw)",
    height: 240,                    // ✅ room for big hitboxes
    margin: "0 auto",
    overflow: "visible",
    pointerEvents: "none",  
    paddingTop: 40
},

  centerDrawRowCompact: {
  display: "flex",
  gap: 10,
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 6
},

drawBtnCompact: {
  flex: 1,
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(0,0,0,0.28)",
  color: "#fff",
  fontWeight: 950,
  fontSize: 16,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  boxShadow: "0 10px 22px rgba(0,0,0,0.16)",
  userSelect: "none",
  touchAction: "manipulation"
},

drawBtnText: {
  fontSize: 13,
  fontWeight: 900,
  opacity: 0.95
},
topBar: {
  padding: "8px 14px",
  maxWidth: 1100,
  margin: "0 auto",
  fontFamily: "system-ui",
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "end",
  gap: 10
},

topBarLeft: { justifySelf: "start" },
topBarCenter: { justifySelf: "center", alignSelf: "center" },
topBarRight: { justifySelf: "end", display: "flex", alignItems: "flex-end", gap: 10 },

turnPillTop: {
  fontWeight: 950,
  padding: "8px 12px",
  borderRadius: 999,
  background: "rgba(0,0,0,0.38)",
  border: "1px solid rgba(255,255,255,0.14)",
  whiteSpace: "nowrap"
},

seatSetsRowCompact: {
  marginTop: 6,
  display: "flex",
  gap: 6,
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  paddingBottom: 4
},

fanSetCompact: {
  position: "relative",
  display: "block",
  flex: "0 0 auto",
  borderRadius: 12,
  padding: "6px 8px",
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.16)",
},

fanSetRowCompact: {
  display: "flex",
  gap: 5,
  flexWrap: "nowrap",
  alignItems: "center"
},

fanCardCompact: {
  width: 26,
  height: 36,
  borderRadius: 10,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(0,0,0,0.18)",
  fontWeight: 950,
  fontSize: 10,
  boxShadow: "0 8px 18px rgba(0,0,0,0.16)"
},
runsRail: {
  position: "fixed",
  left: 10,
  top: 72,
  bottom: 120,
  width: 240,
  zIndex: 300,  // ✅ bump this up
  pointerEvents: "auto",
  overflowY: "auto",
  overflowX: "hidden",
  right: "auto",
  WebkitOverflowScrolling: "touch",
  paddingRight: 6,
  padding: 10,
  borderRadius: 14,
  background: "rgba(0,0,0,0.18)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
  backdropFilter: "blur(10px)",
},

runsRailBlock: {
  pointerEvents: "auto",
  marginBottom: 10,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 10,
  overflow: "hidden", // ✅ keeps FanSet inside the box
},

runsRailName: {
  fontWeight: 950,
  fontSize: 12,
  opacity: 0.9,
  marginBottom: 8,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
},

runsRailSets: {
  display: "flex",
  flexDirection: "column",
  gap: 8,
},

runsRailEmpty: {
  opacity: 0.6,
  fontWeight: 900,
  padding: "6px 2px",
},
runsRailNameRow: {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 8
},

runsRailNameText: {
  fontWeight: 950,
  fontSize: 12,
  opacity: 0.95,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
},

runsRailScore: {
  flex: "0 0 auto",
  fontWeight: 950,
  fontSize: 12,
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(0,0,0,0.28)",
  border: "1px solid rgba(255,255,255,0.14)"
},

fanStack: {
  position: "relative",
  height: 60,
  overflow: "visible"

},
fanStackCompact: {
  position: "relative",
  height: 56,
  overflow: "visible"
},

runsRailTeamHeader: {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 10px",
  marginBottom: 10,
  borderRadius: 14,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.10)"
},

runsRailTeamSide: {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  flex: 1
},

runsRailTeamLabel: {
  fontWeight: 950,
  fontSize: 12,
  letterSpacing: 0.5,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  opacity: 0.95
},

runsRailTeamScorePill: {
  flex: "0 0 auto",
  fontWeight: 950,
  fontSize: 12,
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(0,0,0,0.28)",
  border: "1px solid rgba(255,255,255,0.14)"
},

runsRailTeamDivider: {
  fontWeight: 950,
  opacity: 0.65
},

leaveBtn: {
  width: 44,
  height: 44,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(0,0,0,0.28)",
  color: "#fff",
  fontWeight: 950,
  fontSize: 18,
  cursor: "pointer",
  touchAction: "manipulation"
},

chatRail: {
  position: "fixed",
  right: 10,
  top: 72,          // match left rail top
  bottom: 120,      // ✅ stays ABOVE handDock (prevents overlapping hand)
  width: 240,       // match left rail width

  zIndex: 320,
  pointerEvents: "auto",

  borderRadius: 14,
  background: "rgba(0,0,0,0.18)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
  backdropFilter: "blur(10px)",

  display: "flex",
  flexDirection: "column",
  overflow: "hidden",

  boxSizing: "border-box",
},

chatRailCollapsed: {
  bottom: "auto",     // stop stretching when collapsed
  height: 56,   
  overflow: "hidden",  // header-only
},

chatHeader: {
  padding: "10px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  boxSizing: "border-box",
},

chatBody: {
  flex: 1,
  overflowY: "auto",
  padding: 10,
  WebkitOverflowScrolling: "touch",
  boxSizing: "border-box",
},

chatInputRow: {
  display: "flex",
  gap: 8,
  padding: 10,
  borderTop: "1px solid rgba(255,255,255,0.10)",
  boxSizing: "border-box",
  width: "100%",
},

chatInput: {
  flex: 1,
  minWidth: 0,          // ✅ CRITICAL: prevents overflow wider than rail
  height: 38,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.22)",
  color: "#fff",
  padding: "0 10px",
  outline: "none",
  fontSize: 16,
  boxSizing: "border-box",
},

chatSendBtn: {
  flex: "0 0 auto",
  width: 64,
  height: 38,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.30)",
  color: "#fff",
  fontWeight: 950,
  cursor: "pointer",
  touchAction: "manipulation",
  boxSizing: "border-box",
},
};