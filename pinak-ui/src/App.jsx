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

  const [selected, setSelected] = useState([]);
  const [openCount, setOpenCount] = useState(0);

  // UI-only, but now synced to server truth: me.canDiscard
  const [hasDrawn, setHasDrawn] = useState(false);

  /* ---------- SOCKET ---------- */
  useEffect(() => {
    socket.on("connect", () => setConnected(true));

    socket.on("gameState", (state) => {
      setGame(state);

      const meNext = state.players.find((p) => p.id === socket.id);
      const isMyTurnNext = state.players[state.turn]?.id === socket.id;

      // IMPORTANT FIX #1:
      // hasDrawn should reflect server truth: "did I draw this turn?"
      // Server uses canDiscard=true after any draw (open or closed).
      setHasDrawn(!!meNext?.canDiscard);

      // IMPORTANT FIX #2:
      // Do NOT clear selection just because mustDiscard is false
      // (optional discard after open draw should still work).
      // Clear selection only when:
      // - it becomes NOT your turn, or
      // - you are in required discard mode (to avoid stale multi-select).
      if (!isMyTurnNext || meNext?.mustDiscard) {
        setSelected([]);
      }

      // open selection resets every update (safe)
      setOpenCount(0);
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
  }, []);

  /* ---------- DERIVED ---------- */
  const me = useMemo(() => game?.players?.find((p) => p.id === socket.id), [game]);

  const isMyTurn = useMemo(() => {
    if (!game || !me) return false;
    return game.players[game.turn]?.id === me.id;
  }, [game, me]);

  const showOptionalDiscard = isMyTurn && hasDrawn && !me?.mustDiscard;
  const showRequiredDiscard = isMyTurn && !!me?.mustDiscard;

  // UI GATING (B1)
  const canAct = !!game && !!me && !game.roundOver && !game.gameOver;
  const canDraw = canAct && isMyTurn && !me.mustDiscard && !me.canDiscard; // server truth
  const canSelectOpen = canDraw;
  const canCreateRun = canAct && isMyTurn && !me.mustDiscard && selected.length >= 3;

  // DISCARD:
  // - required if mustDiscard
  // - optional after any draw (server sets canDiscard=true)
  const canDiscard =
    canAct &&
    isMyTurn &&
    selected.length === 1 &&
    (me.mustDiscard || me.canDiscard);

  // END TURN:
  // allowed after open draw even if you don't discard
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

  /* ---------- HELPERS ---------- */
  function toggleCard(id) {
    if (!canAct || !isMyTurn) return;

    // if discard required, single-select
    if (me?.mustDiscard) {
      setSelected([id]);
      return;
    }

    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
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

      {/* GAME OVER / ROUND OVER */}
      {(game.gameOver || game.roundOver) && (
        <div style={styles.bannerNeutral}>
          {game.gameOver ? "🏁 Game Over" : "✅ Round Over"}
        </div>
      )}

      {/* TURN BANNER */}
      {isMyTurn && !me.mustDiscard && !game.roundOver && !game.gameOver && (
        <div style={styles.turnBanner}>🔥 YOUR TURN</div>
      )}

      {/* DISCARD BANNER (Required OR Optional) */}
      {(showRequiredDiscard || showOptionalDiscard) && !game.roundOver && !game.gameOver && (
        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} style={styles.discardBanner}>
          {showRequiredDiscard
            ? "❗ SELECT A CARD TO DISCARD (REQUIRED)"
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
          {game.open.map((c, i) => (
            <div
              key={i}
              onClick={() => selectOpen(i)}
              style={{
                ...styles.openCard,
                background: i < openCount ? "#ffe599" : "#f2f2f2",
                opacity: canSelectOpen ? 1 : 0.4,
                cursor: canSelectOpen ? "pointer" : "not-allowed"
              }}
            >
              {c.value}
              {c.suit}
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
          <div style={styles.miniPill}>Selected: {selected.length}</div>
        </div>

        <div style={styles.hand}>
          {sortedHand.map((c) => {
            const isSelected = selected.includes(c.id);
            return (
              <motion.div
                key={c.id}
                whileHover={!me.mustDiscard ? { scale: 1.06 } : {}}
                style={{
                  ...styles.card,
                  border: isSelected ? "2px solid #d00" : "1px solid #333",
                  opacity: showRequiredDiscard && !isSelected ? 0.55 : 1
                }}
                onClick={() => toggleCard(c.id)}
              >
                {c.value}
                {c.suit}
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
                    {c.value}
                    {c.suit}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* TOAST */}
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
            onClick={() =>
              socket.emit("discard", {
                room: game.room,
                index: me.hand.findIndex((c) => c.id === selected[0])
              })
            }
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