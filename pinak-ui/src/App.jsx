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
function FanSet({ set, isTarget }) {
  const head = set.slice(0, 7);
  const extra = set.length - head.length;

  return (
    <div
      style={{
        ...styles.fanSet,
        outline: isTarget ? "2px solid rgba(255,255,255,0.92)" : "1px solid rgba(255,255,255,0.12)",
        background: isTarget ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.16)"
      }}
    >
      <div style={styles.fanSetRow}>
        {head.map((c, idx) => (
          <span
            key={c.id || idx}
            style={{
              ...styles.fanCard,
              background: cardFaceBg(c),
              color: suitColor(c.suit)
            }}
          >
            {c.value}
            {c.suit}
          </span>
        ))}
        {extra > 0 && (
          <span style={{ ...styles.fanCard, background: "rgba(0,0,0,0.25)", color: "#fff" }}>
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- SEAT ---------- */
function Seat({ pos, player, isMe, isTurn, target, setTarget, sfxClick, compact }) {
  if (!player) return null;

  const headerStyle = { ...styles.seatHeader, ...(isTurn ? styles.seatHeaderTurn : null) };

  return (
    <div style={{ ...styles.seat, ...styles[`seat_${pos}`] }}>
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

      {!compact && (
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

  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const update = () => setIsLandscape(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
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
  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("gameState", (state) => {
      setGame(state);

      const meNext = state.players.find((p) => p.id === socket.id);
      const isMyTurnNext = state.players[state.turn]?.id === socket.id;

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

      if (!state.roundOver) wentOutSentRef.current = false;
    });

    socket.on("errorMsg", (msg) => {
      const m = msg || "Action rejected";
      setError(m);
      setToast(m);
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(""), 2200);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("gameState");
      socket.off("errorMsg");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardPick, target, soundOn]);

  /* ---------- DERIVED ---------- */
  const me = useMemo(() => game?.players?.find((p) => p.id === socket.id), [game]);

  const isMyTurn = useMemo(() => {
    if (!game || !me) return false;
    return game.players[game.turn]?.id === me.id;
  }, [game, me]);

  const canAct = !!game && !!me && !game.roundOver && !game.gameOver;

  const canDraw = canAct && isMyTurn && !me.mustDiscard && !me.canDiscard;
  const canSelectOpen = canDraw;

  const canCreateRun = canAct && isMyTurn && selected.length >= 3;
  const canAddToRun = canAct && isMyTurn && !!target && selected.length >= 1;

  const canDiscard = canAct && isMyTurn && !!discardPick && (me.mustDiscard || me.canDiscard);
  const canEndTurn = canAct && isMyTurn && !me.mustDiscard;

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

  /* ---------- AUTO END ROUND (no button) ---------- */
  useEffect(() => {
    if (!game || !me) return;
    if (!canAct || !isMyTurn) return;
    if (game.roundOver || game.gameOver) return;

    const handEmpty = (me.hand?.length || 0) === 0;
    if (!handEmpty) return;

    if (wentOutSentRef.current) return;
    wentOutSentRef.current = true;

    ensureAudio();
    sfx.run();
    socket.emit("playerWentOut", { room: game.room });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, me, canAct, isMyTurn]);

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

            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  ensureAudio();
                  sfx.click();
                  safeEmit("createRoom", { room, name, teamMode });
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
                  safeEmit("joinRoom", { room, name });
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

  const xSpread = Math.min(160, 48 + fanCount * 3.8);
  const fanMax = Math.min(68, 34 + fanCount * 1.05);

  const yLift = 28;
  const dropFactor = 0.36;
  
  const handCardSize = { width: 46, height: 64, fontSize: 14, borderRadius: 12 };
  const miniCardSizeStyle = { width: 36, height: 50, borderRadius: 12 };

    return (
    <div style={styles.table}>
    {/* TOP BAR */}
<div style={styles.topBar}>
  {/* Left */}
  <div style={styles.topBarLeft}>
    <div style={styles.miniLabel}>Room</div>
    <div style={styles.title}>{game.room}</div>
  </div>

  {/* Center */}
  <div style={styles.topBarCenter}>
    {isMyTurn && !me.mustDiscard && !game.roundOver && !game.gameOver && (
      <div style={styles.turnPillTop}>🔥 YOUR TURN</div>
    )}
  </div>

  {/* Right */}
  <div style={styles.topBarRight}>
    <div style={{ textAlign: "right" }}>
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
      {/* BANNER */}
      {(game.gameOver || game.roundOver) && (
        <div style={styles.bannerNeutral}>
          <div>{game.gameOver ? "🏁 Game Over" : "✅ Round Over"}</div>

          {game.roundOver && !game.gameOver && (
            <button style={{ ...styles.primaryBtn, marginTop: 10 }} onClick={continueNextRound}>
              ▶️ Start Next Round
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
          />
        </div>

        <div style={styles.rowMid}>
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
            />
          </div>

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
                        touchAction: "manipulation"
                      }}
                    >
                      <MiniCard card={c} selected={i < openCount} sizeStyle={miniCardSizeStyle} />
                    </div>
                  ))}
                </div>

                {/* TWO SQUARE DRAW BUTTONS */}
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

                <div style={styles.centerDivider} />

                <div style={styles.scoreMini}>
                  {game.players.map((p) => {
                    const isTurnNow = p.id === game.players[game.turn]?.id;
                    return (
                      <div
                        key={p.id}
                        style={{
                          ...styles.scoreMiniRow,
                          background: isTurnNow ? "rgba(92, 204, 255, 0.18)" : "transparent",
                          border: isTurnNow ? "1px solid rgba(120, 220, 255, 0.55)" : "1px solid transparent"
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 950,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {p.name}
                        </span>
                        <span style={{ fontWeight: 950 }}>{p.score}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

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
            />
          </div>
        </div>

        {/* BOTTOM */}
        <div style={styles.rowBottom}>
        
        </div>
      </div>
          <div style={styles.handDock}>
            <div style={styles.handDockMeta}>
              <span>Run: {selected.length}</span>
              <span>Discard: {discardPick ? "✓" : "—"}</span>
            </div>

            <motion.div variants={handVariants} initial="hidden" animate="show" style={{...styles.handFanDock, position: "relative",}}>
              <AnimatePresence initial={false}>
                {sortedHand.map((c, idx) => {
                  const isRunSelected = selected.includes(c.id);
                  const isDiscard = discardPick === c.id;
                  const t = fanCount <= 1 ? 0.5 : idx / (fanCount - 1);
                  const rot = (t - 0.5) * 2 * fanMax;

                  const drop = Math.abs(rot) * dropFactor;
                  const y = yLift - drop;
                  const x = (t - 0.5) * xSpread;

                  return (
                    <motion.div
                      key={c.id}
                      variants={cardVariants}
                      style={{
                        ...styles.card,
                        ...handCardSize,
                        position: "absolute",
                        padding: 6,
                        left: "50%",
                        bottom: 0,
                        transform: "translateX(-50%)",
                        rotate: rot,
                        x,
                        y,
                        transformOrigin: "50% 95%",
                        background: cardFaceBg(c),
                        border: isDiscard
                          ? "2px solid #ff4d4d"
                          : isRunSelected
                          ? "2px solid rgba(255,255,255,0.78)"
                          : "1px solid rgba(0,0,0,0.22)",
                        zIndex: isDiscard ? 50 : isRunSelected ? 40 : idx
                      }}                      
                      onClick={() => toggleCard(c.id)}
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
                    {/* bottom-right pip (rotated like a real card) */}
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
                  );
                })}
              </AnimatePresence>
            </motion.div>
          </div>

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
              safeEmit("openRun", { room: game.room, cardIds: selected });
              setSelected([]);
              setDiscardPick(null);
            }}
          >
            Create Run
          </button>

          <button
            style={styles.primaryBtnTiny}
            disabled={!canAddToRun}
            onClick={() => {
              ensureAudio();
              sfx.run();
              safeEmit("addToRun", {
                room: game.room,
                targetPlayer: target.playerId,
                runIndex: target.runIndex,
                cardIds: selected
              });
              setSelected([]);
              setDiscardPick(null);
            }}
          >
            Add
          </button>

          <button
            style={styles.dangerBtnTiny}
            disabled={!canDiscard}
            onClick={() => {
              ensureAudio();
              sfx.discard();
              const idx = me.hand.findIndex((c) => c.id === discardPick);
              safeEmit("discard", { room: game.room, index: idx });
              setSelected([]);
              setDiscardPick(null);
            }}
          >
            {me.mustDiscard ? "Discard!" : "Discard"}
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
          >
            End Turn
          </button>
        </div>
      </div>
    </div>
  );
}
/* ---------- STYLES ---------- */
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
    paddingBottom: 84
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
    maxWidth: 1100,
    margin: "0 auto",
    padding: "8px 12px",
    display: "grid",
    gridTemplateRows: "auto 1fr auto",
    gap: 8,
    height: "calc(100svh - 160px)",
    minHeight: 0
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
    alignItems: "start",
    minHeight: 0
  },

  midSide: { minWidth: 0 },
  midCenter: { minWidth: 0 },

  rowBottom: { minHeight: 0, minWidth: 0 },

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

  fanSet: { flex: "0 0 auto", borderRadius: 14, padding: "8px 10px", border: "1px solid rgba(255,255,255,0.12)" },
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
    bottom: 24, // sits just above action bar
    height: 190,
    pointerEvents: "none",
    zIndex: 200
},

  handDockMeta: {
    position: "absolute",
    right: 10,
    bottom: 44,              // pushes it down near the buttons
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    fontWeight: 900,
    opacity: 0.9,
    pointerEvents: "none"    // prevents blocking taps
},

  handFanDock: {
    position: "absolute",
    left: "50%",
    bottom: 8,
    transform: "translateX(-50%)",
    width: "min(1100px, 98vw)",
    height: 160,
    overflow: "visible",
    pointerEvents: "auto"    
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

};