import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { motion } from "framer-motion";

const socket = io(import.meta.env.VITE_SERVER_URL || "http://localhost:3001");

/* ---------- SORT CONSTANTS ---------- */
const SUIT_ORDER = ["♠", "♥", "♦", "♣"];
const VALUE_ORDER = ["3","4","5","6","7","8","9","10","J","Q","K","A"];

export default function App() {
  /* ---------- STATE ---------- */
  const [connected, setConnected] = useState(false);
  const [game, setGame] = useState(null);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [teamMode, setTeamMode] = useState(false);

  // show errors as toast (and also in lobby)
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // run selection (multi)
  const [selected, setSelected] = useState([]);

  // open stack selection (top-to-bottom count)
  const [openCount, setOpenCount] = useState(0);

  // discard candidate (single card id)
  const [discardPick, setDiscardPick] = useState(null);

  // UI-only, but synced to server truth: me.canDiscard
  const [hasDrawn, setHasDrawn] = useState(false);

  /* ---------- SOCKET ---------- */
  useEffect(() => {
    socket.on("connect", () => setConnected(true));

    socket.on("gameState", (state) => {
      setGame(state);

      const meNext = state.players.find((p) => p.id === socket.id);
      const isMyTurnNext = state.players[state.turn]?.id === socket.id;

      // hasDrawn reflects server truth (canDiscard=true after any draw)
      setHasDrawn(!!meNext?.canDiscard);

      // reset open selection every update
      setOpenCount(0);

      // when your turn ends -> clear selections
      if (!isMyTurnNext) {
        setSelected([]);
        setDiscardPick(null);
        return;
      }

      // if your discardPick card no longer exists in hand -> clear it
      if (discardPick && !meNext?.hand?.some((c) => c.id === discardPick)) {
        setDiscardPick(null);
      }
    });

    socket.on("errorMsg", (msg) => {
      setError(msg || "");
      setToast(msg || "Action rejected");
      window.clearTimeout(window.__pinakToastTimer);
      window.__pinakToastTimer = window.setTimeout(() => setToast(""), 2200);
    });

    return () => {
      socket.off("connect");
      socket.off("gameState");
      socket.off("errorMsg");
    };
    // IMPORTANT: do not re-register socket handlers on state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- DERIVED ---------- */
  const me = useMemo(() => game?.players?.find((p) => p.id === socket.id), [game]);

  const isMyTurn = useMemo(() => {
    if (!game || !me) return false;
    return game.players[game.turn]?.id === me.id;
  }, [game, me]);

  const showOptionalDiscard = isMyTurn && hasDrawn && !me?.mustDiscard;
  const showRequiredDiscard = isMyTurn && !!me?.mustDiscard;

  // UI gating
  const canAct = !!game && !!me && !game.roundOver && !game.gameOver;

  // can draw only if you haven't drawn yet this turn (server truth)
  const canDraw = canAct && isMyTurn && !me.mustDiscard && !me.canDiscard;
  const canSelectOpen = canDraw;

  // allow Create Run even during mustDiscard (closed draw) — discard still required before ending
  const canCreateRun = canAct && isMyTurn && selected.length >= 3;

  // discard is enabled if you have a discardPick AND server says discard is possible/required
  const canDiscard =
    canAct &&
    isMyTurn &&
    !!discardPick &&
    (me.mustDiscard || me.canDiscard);

  // end turn is blocked only when mustDiscard is true
  const canEndTurn = canAct && isMyTurn && !me.mustDiscard;

  const canEndRound = canAct && isMyTurn && me.hand?.length === 0;

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

  /* ---------- BULLETPROOF DISCARD PICK ---------- */
  // If discard is allowed/required and no discardPick yet, auto-pick:
  // - prefer last selected card
  // - otherwise pick first card in hand
  useEffect(() => {
    if (!me || !canAct || !isMyTurn) return;

    const discardAllowed = (me.mustDiscard || me.canDiscard);
    if (!discardAllowed) return;

    const handIds = new Set((me.hand || []).map((c) => c.id));

    // If discardPick is invalid, clear it
    if (discardPick && !handIds.has(discardPick)) {
      setDiscardPick(null);
      return;
    }

    // If no discardPick, choose one
    if (!discardPick) {
      // prefer last selected that is in hand
      for (let i = selected.length - 1; i >= 0; i--) {
        if (handIds.has(selected[i])) {
          setDiscardPick(selected[i]);
          return;
        }
      }
      // otherwise default to first card in hand
      if (me.hand?.[0]?.id) setDiscardPick(me.hand[0].id);
    }
  }, [me, canAct, isMyTurn, selected, discardPick]);

  /* ---------- HELPERS ---------- */
  function toggleCard(id) {
    if (!canAct || !isMyTurn) return;

    // Toggle run selection
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

    // Always treat last tapped as discard candidate too
    setDiscardPick(id);
  }

  function selectOpen(i) {
    if (!canSelectOpen) return;
    setOpenCount(i + 1);
  }

  /* ---------- CONNECTION ---------- */
  if (!connected) return <h2 style={{ padding: 20 }}>Connecting…</h2>;

  /* ---------- LOBBY ---------- */
  if (!game) {
    return (
      <div style={styles.page}>
        <div style={styles.headerRow}>
          <h2 style={{ margin: 0 }}>Pinak</h2>
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
            <span style={{ marginLeft: 8 }}>Team Mode</span>
          </label>

          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button
              style={styles.primaryBtn}
              onClick={() => socket.emit("createRoom", { room, name, teamMode })}
              disabled={!name || !room}
            >
              Create
            </button>
            <button
              style={styles.secondaryBtn}
              onClick={() => socket.emit("joinRoom", { room, name })}
              disabled={!name || !room}
            >
              Join
            </button>
          </div>

          {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
        </div>

        {toast && <div style={styles.toast}>{toast}</div>}
      </div>
    );
  }

  if (!me) return <p style={{ padding: 16 }}>Syncing…</p>;

  // Open stack top first (most recent discard)
  const openTopFirst = [...game.open].reverse();

  /* ---------- GAME ---------- */
  return (
    <div style={{ ...styles.page, opacity: isMyTurn ? 1 : 0.55 }}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.miniLabel}>Room</div>
          <div style={styles.title}>{game.room}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={styles.miniLabel}>Turn</div>
          <div style={styles.title}>{isMyTurn ? "You" : game.players[game.turn]?.name}</div>
        </div>
      </div>

      {(game.gameOver || game.roundOver) && (
        <div style={styles.bannerNeutral}>
          {game.gameOver ? "🏁 Game Over" : "✅ Round Over"}
        </div>
      )}

      {isMyTurn && !me.mustDiscard && !game.roundOver && !game.gameOver && (
        <div style={styles.turnBanner}>🔥 YOUR TURN</div>
      )}

      {(showRequiredDiscard || showOptionalDiscard) && !game.roundOver && !game.gameOver && (
        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} style={styles.discardBanner}>
          {showRequiredDiscard
            ? "❗ You MUST discard before ending your turn (you may open runs first)"
            : "💡 You may discard one card (OPTIONAL)"}
        </motion.div>
      )}

      {/* SCOREBOARD */}
      <div style={styles.cardSection}>
        <div style={styles.sectionHeader}>
          <h4 style={styles.h4}>Scoreboard</h4>
        </div>
        <div style={styles.scoreboard}>
          {game.players.map((p, idx) => {
            const isTurn = idx === game.turn;
            return (
              <div
                key={p.id}
                style={{
                  ...styles.playerRow,
                  background: isTurn ? "#e6f4ff" : "transparent",
                  fontWeight: isTurn ? "bold" : "normal"
                }}
              >
                <span>
                  {p.name} {isTurn && "⬅"}
                </span>
                <span>{p.score}</span>
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
                background: i < openCount ? "#ffe599" : "#f2f2f2",
                opacity: canSelectOpen ? 1 : 0.4,
                cursor: canSelectOpen ? "pointer" : "not-allowed"
              }}
            >
              {c.value}{c.suit}
            </div>
          ))}
        </div>

        <button
          style={styles.primaryBtn}
          disabled={!canDraw || openCount < 1}
          onClick={() => socket.emit("drawOpen", { room: game.room, count: openCount })}
        >
          Draw {openCount || ""} From Open
        </button>
      </div>

      {/* HAND */}
      <div style={{ ...styles.cardSection, paddingBottom: 96 }}>
        <div style={styles.sectionHeader}>
          <h4 style={styles.h4}>Your Hand</h4>
          <div style={styles.miniPill}>
            Run: {selected.length} | Discard: {discardPick ? "✓" : "—"}
          </div>
        </div>

        <div style={styles.hand}>
          {sortedHand.map((c) => {
            const isRunSelected = selected.includes(c.id);
            const isDiscard = discardPick === c.id;

            return (
              <motion.div
                key={c.id}
                whileHover={!me.mustDiscard ? { scale: 1.06 } : {}}
                style={{
                  ...styles.card,
                  border: isDiscard
                    ? "2px solid #c00"
                    : isRunSelected
                    ? "2px solid #111"
                    : "1px solid #333"
                }}
                onClick={() => toggleCard(c.id)}
              >
                {c.value}{c.suit}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* OPENED SETS */}
      <div style={styles.cardSection}>
        <div style={styles.sectionHeader}>
          <h4 style={styles.h4}>Opened Sets</h4>
        </div>

        {game.players.map((p) => (
          <div key={p.id} style={{ marginBottom: 10 }}>
            <strong>{p.name}</strong>
            {p.openedSets.length === 0 && <div style={{ opacity: 0.7 }}>—</div>}
            {p.openedSets.map((set, i) => (
              <div key={i} style={styles.set}>
                {set.map((c) => (
                  <span key={c.id} style={styles.setCard}>
                    {c.value}{c.suit}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}

      {/* STICKY ACTION BAR */}
      <div style={styles.stickyBar}>
        <div style={styles.stickyInner}>
          <button
            style={styles.secondaryBtn}
            disabled={!canDraw}
            onClick={() => socket.emit("drawClosed", { room: game.room })}
          >
            Draw Closed
          </button>

          <button
            style={styles.primaryBtn}
            disabled={!canCreateRun}
            onClick={() => socket.emit("openRun", { room: game.room, cardIds: selected })}
          >
            Create Run
          </button>

          <button
            style={styles.dangerBtn}
            disabled={!canDiscard}
            onClick={() => {
              const idx = me.hand.findIndex((c) => c.id === discardPick);
              socket.emit("discard", { room: game.room, index: idx });
            }}
          >
            {me.mustDiscard ? "🗑 Discard (Req)" : "🗑 Discard (Opt)"}
          </button>

          <button
            style={styles.secondaryBtn}
            disabled={!canEndTurn}
            onClick={() => socket.emit("endTurn", { room: game.room })}
          >
            End Turn
          </button>

          <button
            style={styles.primaryBtn}
            disabled={!canEndRound}
            onClick={() => socket.emit("playerWentOut", { room: game.room })}
          >
            End Round
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- STYLES ---------- */
const styles = {
  page: {
    padding: 14,
    maxWidth: 540,
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
  miniLabel: { fontSize: 12, opacity: 0.7 },
  title: { fontSize: 18, fontWeight: 800, letterSpacing: 0.2 },

  cardSection: {
    background: "#fff",
    border: "1px solid #e6e6e6",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    marginBottom: 10
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8
  },
  h4: { margin: 0 },
  miniPill: {
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    background: "#f4f4f4",
    border: "1px solid #e6e6e6"
  },

  bannerNeutral: {
    background: "#f4f4f4",
    border: "1px solid #e6e6e6",
    borderRadius: 12,
    padding: "10px 12px",
    textAlign: "center",
    fontWeight: 900,
    marginBottom: 10
  },

  turnBanner: {
    background: "#111",
    color: "#fff",
    padding: "8px 10px",
    borderRadius: 10,
    marginBottom: 10,
    textAlign: "center",
    fontWeight: "bold"
  },
  discardBanner: {
    background: "#ffeded",
    color: "#900",
    padding: "8px 10px",
    borderRadius: 10,
    marginBottom: 10,
    textAlign: "center",
    fontWeight: "bold",
    border: "1px solid #c00"
  },

  input: {
    display: "block",
    width: "100%",
    padding: 12,
    borderRadius: 10,
    border: "1px solid #ddd",
    marginBottom: 10,
    fontSize: 16
  },
  checkboxRow: { display: "flex", alignItems: "center", marginTop: 4 },

  scoreboard: { marginBottom: 0 },
  playerRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 10px",
    borderRadius: 10
  },

  openStack: {
    display: "flex",
    gap: 8,
    marginBottom: 10,
    flexWrap: "wrap"
  },
  openCard: {
    border: "1px solid #333",
    padding: "10px 10px",
    borderRadius: 10,
    minWidth: 48,
    textAlign: "center",
    fontWeight: 800,
    userSelect: "none"
  },

  hand: { display: "flex", flexWrap: "wrap", gap: 10 },
  card: {
    width: 54,
    height: 72,
    background: "#fff",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 16,
    userSelect: "none",
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)"
  },

  set: { display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" },
  setCard: {
    border: "1px solid #333",
    padding: "6px 10px",
    borderRadius: 10,
    background: "#fafafa",
    fontWeight: 800
  },

  primaryBtn: {
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    fontWeight: 900,
    fontSize: 15,
    width: "100%"
  },
  secondaryBtn: {
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #ccc",
    background: "#fff",
    fontWeight: 900,
    fontSize: 15,
    width: "100%"
  },
  dangerBtn: {
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #c00",
    background: "#c00",
    color: "#fff",
    fontWeight: 900,
    fontSize: 15,
    width: "100%"
  },

  stickyBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    background: "rgba(255,255,255,0.92)",
    borderTop: "1px solid #e6e6e6",
    backdropFilter: "blur(10px)"
  },
  stickyInner: {
    maxWidth: 540,
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
    fontWeight: 800,
    fontSize: 13,
    maxWidth: 340,
    textAlign: "center",
    zIndex: 9999
  }
};