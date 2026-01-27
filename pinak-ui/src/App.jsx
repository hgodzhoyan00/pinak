import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

// iOS Safari stability: prefer websocket (avoids long-polling weirdness on some hosts)
const socket = io(SERVER_URL, {
  transports: ["websocket"],
  upgrade: false
});

/* ---------- SORT CONSTANTS ---------- */
const SUIT_ORDER = ["♠", "♥", "♦", "♣"];
const VALUE_ORDER = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

/* ---------- SUIT UI (COLOR + TINT) ---------- */
function suitColor(suit) {
  if (suit === "♥" || suit === "♦") return "#ff3b3b";
  return "#0c1a2a"; // ♠ ♣
}

function cardFaceBg(card) {
  if (!card) return "rgba(255,255,255,0.92)";
  if (card.value === "2") return "rgba(255, 247, 214, 0.96)"; // joker tint (gold)
  return "rgba(255,255,255,0.94)";
}

/* ---------- THEME TOKENS ---------- */
const stylesTokens = {
  textStrong: "#f2f6ff",
  textMuted: "rgba(242,246,255,0.78)"
};

export default function App() {
  /* ---------- STATE ---------- */
  const [connected, setConnected] = useState(false);
  const [game, setGame] = useState(null);

  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [teamMode, setTeamMode] = useState(false);

  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // run selection + open selection
  const [selected, setSelected] = useState([]);
  const [openCount, setOpenCount] = useState(0);

  // discard is independent of run selection
  const [discardPick, setDiscardPick] = useState(null);

  // synced to server truth: me.canDiscard (after any draw)
  const [hasDrawn, setHasDrawn] = useState(false);

  // landscape detection
  const [isLandscape, setIsLandscape] = useState(
    typeof window !== "undefined" ? window.innerWidth > window.innerHeight : false
  );

  // add-to-run target
  const [target, setTarget] = useState(null); // { playerId, runIndex }

  // sounds
  const [soundOn, setSoundOn] = useState(true);
  const audioCtxRef = useRef(null);
  const lastHandSigRef = useRef("");

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
  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("gameState", (state) => {
      setGame(state);

      const meNext = state.players.find((p) => p.id === socket.id);
      const isMyTurnNext = state.players[state.turn]?.id === socket.id;

      setHasDrawn(!!meNext?.canDiscard);

      // IMPORTANT: keep openCount valid if open shrank
      const openLen = state.open?.length || 0;
      setOpenCount((prev) => (prev > openLen ? openLen : prev));

      if (!isMyTurnNext) {
        setSelected([]);
        setDiscardPick(null);
        setTarget(null);
      }

      if (discardPick && !meNext?.hand?.some((c) => c.id === discardPick)) {
        setDiscardPick(null);
      }

      if (target) {
        const owner = state.players.find((p) => p.id === target.playerId);
        if (!owner || !owner.openedSets?.[target.runIndex]) setTarget(null);
      }
    });

    socket.on("errorMsg", (msg) => {
      const m = msg || "Action rejected";
      setError(m);
      setToast(m);
      window.clearTimeout(window.__pinakToastTimer);
      window.__pinakToastTimer = window.setTimeout(() => setToast(""), 2200);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("gameState");
      socket.off("errorMsg");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardPick, target, soundOn]);

  /* ---------- LANDSCAPE DETECTION ---------- */
  useEffect(() => {
    const onResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---------- DERIVED ---------- */
  const me = useMemo(() => game?.players?.find((p) => p.id === socket.id), [game]);

  const isMyTurn = useMemo(() => {
    if (!game || !me) return false;
    return game.players[game.turn]?.id === me.id;
  }, [game, me]);

  const canAct = !!game && !!me && !game.roundOver && !game.gameOver;

  // Draw gating:
  // - must be your turn
  // - cannot be in required discard
  // - cannot have already drawn this turn (server sets canDiscard after any draw)
  const canDraw = canAct && isMyTurn && !me.mustDiscard && !me.canDiscard;

  // selecting from open is allowed whenever drawing is allowed
  const canSelectOpen = canDraw;

  const canCreateRun = canAct && isMyTurn && selected.length >= 3;
  const canAddToRun = canAct && isMyTurn && !!target && selected.length >= 1;

  const canDiscard = canAct && isMyTurn && !!discardPick && (me.mustDiscard || me.canDiscard);

  const canEndTurn = canAct && isMyTurn && !me.mustDiscard;
  const canEndRound = canAct && isMyTurn && me.hand?.length === 0;

  const canContinueRound = !!game && !!me && game.roundOver && !game.gameOver;

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

  /* ---------- DEAL ANIMATION TRIGGER ---------- */
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
    const next = Math.min(i + 1, openLen);
    setOpenCount(next);
  }

  function continueNextRound() {
    if (!canContinueRound) return;
    ensureAudio();
    sfx.run();
    socket.emit("continueGame", { room: game.room });

    // local cleanup so next round starts clean
    setSelected([]);
    setDiscardPick(null);
    setTarget(null);
    setOpenCount(0);
  }

  /* ---------- CONNECTION ---------- */
  if (!connected) return <h2 style={{ padding: 20, color: "#eaf2ff" }}>Connecting…</h2>;

  /* ---------- LOBBY ---------- */
  if (!game) {
    return (
      <div style={styles.table}>
        <div style={styles.page}>
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
            <input
              style={styles.input}
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <input
              style={styles.input}
              placeholder="Room code"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
            />

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={teamMode}
                onChange={(e) => setTeamMode(e.target.checked)}
              />
              <span style={{ marginLeft: 8, color: stylesTokens.textStrong, fontWeight: 950 }}>
                Team Mode
              </span>
            </label>

            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  ensureAudio();
                  sfx.click();
                  socket.emit("createRoom", { room, name, teamMode });
                }}
                disabled={!name || !room}
              >
                Create
              </button>
              <button
                style={styles.secondaryBtn}
                onClick={() => {
                  ensureAudio();
                  sfx.click();
                  socket.emit("joinRoom", { room, name });
                }}
                disabled={!name || !room}
              >
                Join
              </button>
            </div>

            {error && <p style={{ color: "#ff7b7b", marginTop: 10, fontWeight: 900 }}>{error}</p>}
          </div>

          {toast && <div style={styles.toast}>{toast}</div>}
        </div>
      </div>
    );
  }

  if (!me) return <p style={{ padding: 16, color: stylesTokens.textStrong }}>Syncing…</p>;

  // Open stack TOP-FIRST display
  const openTopFirst = [...game.open].reverse();

  /* ---------- GAME LAYOUT (LANDSCAPE GRID) ---------- */
  const pageStyle = {
    ...styles.page,
    opacity: isMyTurn ? 1 : 0.78,
    display: isLandscape ? "grid" : "block",
    gridTemplateColumns: isLandscape ? "1fr 1fr" : "none",
    gap: isLandscape ? 12 : undefined
  };

  const fullWidth = isLandscape ? { gridColumn: "1 / -1" } : null;

  const handVariants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.035 } }
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 14, scale: 0.98 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 420, damping: 28 } }
  };

  return (
    <div style={styles.table}>
      <div style={pageStyle}>
        {/* HEADER */}
        <div style={{ ...styles.headerRow, ...(fullWidth || {}) }}>
          <div>
            <div style={styles.miniLabel}>Room</div>
            <div style={styles.title}>{game.room}</div>
          </div>

          <div style={{ textAlign: "right", display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div>
              <div style={styles.miniLabel}>Turn</div>
              <div style={styles.title}>{isMyTurn ? "You" : game.players[game.turn]?.name}</div>
            </div>
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

        {(game.gameOver || game.roundOver) && (
          <div style={{ ...styles.bannerNeutral, ...(fullWidth || {}) }}>
            {game.gameOver ? "🏁 Game Over" : "✅ Round Over"}
          </div>
        )}

        {/* ✅ NEW: CONTINUE / NEXT ROUND BUTTON */}
        {canContinueRound && (
          <button
            style={{ ...styles.primaryBtn, ...(fullWidth || {}) }}
            onClick={continueNextRound}
            title="Start next round"
          >
            ▶️ Start Next Round
          </button>
        )}

        {isMyTurn && !me.mustDiscard && !game.roundOver && !game.gameOver && (
          <div style={{ ...styles.turnBanner, ...(fullWidth || {}) }}>🔥 YOUR TURN</div>
        )}

        {/* LEFT COLUMN */}
        <div>
          {/* SCOREBOARD */}
          <div style={styles.cardSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.h4}>Scoreboard</h4>
            </div>
            <div style={styles.scoreboard}>
              {game.players.map((p, idx) => {
                const isTurnNow = idx === game.turn;
                return (
                  <div
                    key={p.id}
                    style={{
                      ...styles.playerRow,
                      background: isTurnNow ? "rgba(92, 204, 255, 0.18)" : "transparent",
                      border: isTurnNow ? "1px solid rgba(120, 220, 255, 0.55)" : "1px solid transparent",
                      boxShadow: isTurnNow
                        ? "0 0 0 2px rgba(120,220,255,0.18), 0 10px 24px rgba(0,0,0,0.25)"
                        : "none"
                    }}
                  >
                    <span style={{ color: stylesTokens.textStrong, fontWeight: 950 }}>
                      {p.name} {isTurnNow && "⬅"}
                    </span>
                    <span style={{ color: stylesTokens.textStrong, fontWeight: 950 }}>{p.score}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* OPEN STACK */}
          <div style={styles.cardSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.h4}>Open Stack</h4>
              <div style={styles.miniPill}>Selected: {openCount}</div>
            </div>

            <div style={styles.openStack}>
              {openTopFirst.map((c, i) => (
                <div
                  key={c.id || i}
                  onClick={() => selectOpen(i)}
                  style={{
                    ...styles.openCard,
                    background: i < openCount ? "rgba(255, 214, 102, 0.95)" : cardFaceBg(c),
                    opacity: canSelectOpen ? 1 : 0.4,
                    cursor: canSelectOpen ? "pointer" : "not-allowed"
                  }}
                >
                  <span style={{ color: suitColor(c.suit), fontWeight: 950 }}>
                    {c.value}
                    {c.suit}
                  </span>
                </div>
              ))}
            </div>

            <button
              style={styles.primaryBtn}
              disabled={!canDraw || openCount < 1 || openCount > (game.open?.length || 0)}
              onClick={() => {
                ensureAudio();
                sfx.draw();
                socket.emit("drawOpen", { room: game.room, count: openCount });
              }}
            >
              Draw {openCount || ""} From Open
            </button>
          </div>

          {/* OPENED SETS */}
          <div style={styles.cardSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.h4}>Opened Sets</h4>
              <div style={styles.miniPill}>Target: {target ? "✓" : "—"}</div>
            </div>

            <div style={styles.openedSetsScroll}>
              {game.players.map((p) => (
                <div key={p.id} style={{ marginBottom: 10 }}>
                  <strong style={{ color: stylesTokens.textStrong }}>{p.name}</strong>
                  {p.openedSets.length === 0 && (
                    <div style={{ opacity: 0.85, color: stylesTokens.textMuted }}>—</div>
                  )}
                  {p.openedSets.map((set, i) => {
                    const isTarget = target?.playerId === p.id && target?.runIndex === i;
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          sfx.click();
                          setTarget({ playerId: p.id, runIndex: i });
                        }}
                        style={{
                          ...styles.set,
                          outline: isTarget
                            ? "2px solid rgba(255,255,255,0.9)"
                            : "1px dashed transparent",
                          borderRadius: 12,
                          padding: 6,
                          cursor: "pointer"
                        }}
                        title="Tap to target this run"
                      >
                        {set.map((c) => (
                          <span
                            key={c.id}
                            style={{
                              ...styles.setCard,
                              color: suitColor(c.suit),
                              background: cardFaceBg(c)
                            }}
                          >
                            {c.value}
                            {c.suit}
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {/* HAND */}
          <div style={{ ...styles.cardSection, paddingBottom: 14 }}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.h4}>Your Hand</h4>
              <div style={styles.miniPill}>
                Run: {selected.length} | Discard: {discardPick ? "✓" : "—"}
              </div>
            </div>

            <motion.div variants={handVariants} initial="hidden" animate="show" style={styles.hand}>
              <AnimatePresence initial={false}>
                {sortedHand.map((c) => {
                  const isRunSelected = selected.includes(c.id);
                  const isDiscard = discardPick === c.id;

                  return (
                    <motion.div
                      key={c.id}
                      variants={cardVariants}
                      exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.12 } }}
                      whileHover={!me.mustDiscard ? { scale: 1.06 } : {}}
                      style={{
                        ...styles.card,
                        background: cardFaceBg(c),
                        border: isDiscard
                          ? "2px solid #ff4d4d"
                          : isRunSelected
                          ? "2px solid #111"
                          : "1px solid rgba(0,0,0,0.28)"
                      }}
                      onClick={() => toggleCard(c.id)}
                    >
                      <span style={{ color: suitColor(c.suit), fontWeight: 950 }}>
                        {c.value}
                        {c.suit}
                      </span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          </div>

          {toast && <div style={styles.toast}>{toast}</div>}
        </div>

        {/* STICKY ACTION BAR */}
        <div style={styles.stickyBar}>
          <div style={styles.stickyInner}>
            <button
              style={styles.secondaryBtn}
              disabled={!canDraw}
              onClick={() => {
                ensureAudio();
                sfx.draw();
                socket.emit("drawClosed", { room: game.room });
              }}
            >
              Draw Closed
            </button>

            <button
              style={styles.primaryBtn}
              disabled={!canCreateRun}
              onClick={() => {
                ensureAudio();
                sfx.run();
                socket.emit("openRun", { room: game.room, cardIds: selected });
                setSelected([]);
                setDiscardPick(null);
              }}
            >
              Create Run
            </button>

            <button
              style={styles.primaryBtn}
              disabled={!canAddToRun}
              onClick={() => {
                ensureAudio();
                sfx.run();
                socket.emit("addToRun", {
                  room: game.room,
                  targetPlayer: target.playerId,
                  runIndex: target.runIndex,
                  cardIds: selected
                });
                setSelected([]);
                setDiscardPick(null);
              }}
            >
              Add To Run
            </button>

            <button
              style={styles.dangerBtn}
              disabled={!canDiscard}
              onClick={() => {
                ensureAudio();
                sfx.discard();
                const idx = me.hand.findIndex((c) => c.id === discardPick);
                socket.emit("discard", { room: game.room, index: idx });
                setSelected([]);
                setDiscardPick(null);
              }}
            >
              {me.mustDiscard ? "🗑 Discard (Req)" : "🗑 Discard (Opt)"}
            </button>

            <button
              style={styles.secondaryBtn}
              disabled={!canEndTurn}
              onClick={() => {
                ensureAudio();
                sfx.end();
                socket.emit("endTurn", { room: game.room });
                setSelected([]);
                setDiscardPick(null);
                setTarget(null);
              }}
            >
              End Turn
            </button>

            <button
              style={styles.primaryBtn}
              disabled={!canEndRound}
              onClick={() => {
                ensureAudio();
                sfx.run();
                socket.emit("playerWentOut", { room: game.room });
              }}
            >
              End Round
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- STYLES ---------- */
const styles = {
  table: {
    minHeight: "100vh",
    background:
      "radial-gradient(1200px 600px at 20% 0%, rgba(255,255,255,0.10), transparent 55%)," +
      "radial-gradient(900px 500px at 90% 20%, rgba(0,0,0,0.25), transparent 60%)," +
      "linear-gradient(180deg, #0b3b2e 0%, #06261e 60%, #041b15 100%)",
    color: stylesTokens.textStrong,
    paddingTop: 10
  },

  page: {
    padding: 14,
    paddingBottom: 220,
    maxWidth: 980,
    margin: "0 auto",
    fontFamily: "system-ui"
  },

  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 12,
    marginBottom: 10
  },

  soundBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.28)",
    color: "#fff",
    fontWeight: 950,
    fontSize: 18,
    cursor: "pointer"
  },

  miniLabel: { fontSize: 12, opacity: 0.85, color: stylesTokens.textMuted, fontWeight: 800 },
  title: { fontSize: 18, fontWeight: 950, letterSpacing: 0.2, color: stylesTokens.textStrong },

  cardSection: {
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 14,
    padding: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
    marginBottom: 10,
    backdropFilter: "blur(10px)"
  },

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8
  },

  h4: { margin: 0, color: stylesTokens.textStrong, fontWeight: 950 },

  miniPill: {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: stylesTokens.textStrong,
    fontWeight: 950
  },

  bannerNeutral: {
    background: "rgba(0,0,0,0.30)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 14,
    padding: "10px 12px",
    textAlign: "center",
    fontWeight: 950,
    marginBottom: 10
  },

  turnBanner: {
    background: "rgba(0,0,0,0.45)",
    color: "#fff",
    padding: "10px 10px",
    borderRadius: 14,
    marginBottom: 10,
    textAlign: "center",
    fontWeight: 950,
    border: "1px solid rgba(255,255,255,0.14)"
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

  scoreboard: { marginBottom: 0 },

  playerRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 10px",
    borderRadius: 12
  },

  openStack: {
    display: "flex",
    gap: 8,
    marginBottom: 10,
    flexWrap: "wrap"
  },

  openCard: {
    border: "1px solid rgba(0,0,0,0.20)",
    padding: "10px 10px",
    borderRadius: 12,
    minWidth: 52,
    textAlign: "center",
    fontWeight: 900,
    userSelect: "none",
    boxShadow: "0 6px 18px rgba(0,0,0,0.18)"
  },

  hand: { display: "flex", flexWrap: "wrap", gap: 10 },

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
    boxShadow: "0 10px 24px rgba(0,0,0,0.22)"
  },

  openedSetsScroll: {
    maxHeight: 380,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    paddingRight: 6
  },

  set: { display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" },

  setCard: {
    border: "1px solid rgba(0,0,0,0.20)",
    padding: "6px 10px",
    borderRadius: 12,
    fontWeight: 900,
    boxShadow: "0 6px 16px rgba(0,0,0,0.14)"
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
    boxShadow: "0 10px 24px rgba(0,0,0,0.18)"
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
    boxShadow: "0 10px 24px rgba(0,0,0,0.16)"
  },

  dangerBtn: {
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255, 77, 77, 0.6)",
    background: "linear-gradient(180deg, #ff3b3b, #b10000)",
    color: "#fff",
    fontWeight: 950,
    fontSize: 15,
    width: "100%",
    boxShadow: "0 10px 24px rgba(0,0,0,0.18)"
  },

  stickyBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    background: "rgba(2, 10, 8, 0.78)",
    borderTop: "1px solid rgba(255,255,255,0.12)",
    backdropFilter: "blur(14px)",
    zIndex: 999
  },

  stickyInner: {
    maxWidth: 980,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10
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
  }
};