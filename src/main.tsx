import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Crown, LogOut, Pause, Play, RefreshCcw, Shield, Sparkles, Trophy, UserX, Users } from "lucide-react";
import type { Category, Player, PublicGameRoom } from "../shared/types";
import { CATEGORIES } from "../shared/types";
import "./styles.css";

const avatars = ["🦊", "🐼", "🦄", "🐙", "🚀", "🌈", "🍕", "🎸", "⚽", "⭐", "🐢", "🍩"];
const playerKey = (roomCode: string) => `shush:player:${roomCode}`;
const hostKey = (roomCode: string) => `shush:host:${roomCode}`;

type Profile = {
  playerId: string;
  name: string;
  avatar: string;
  categoryVote: Category;
};

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getRoomFromPath() {
  const match = window.location.pathname.match(/\/room\/([A-Z0-9]+)/i);
  return match?.[1]?.toUpperCase() || "";
}

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState(getRoomFromPath());
  const [room, setRoom] = useState<PublicGameRoom | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [avatar, setAvatar] = useState(avatars[0]);
  const [categoryVote, setCategoryVote] = useState<Category>("Animals");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const nextSocket = io();
    setSocket(nextSocket);
    nextSocket.on("room:update", (updatedRoom: PublicGameRoom) => {
      setRoom(updatedRoom);
      setRoomCode(updatedRoom.roomCode);
    });
    return () => {
      nextSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!socket || !roomCode) return;
    const saved = localStorage.getItem(playerKey(roomCode));
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Profile;
      setProfile(parsed);
      setJoinName(parsed.name);
      setAvatar(parsed.avatar);
      setCategoryVote(parsed.categoryVote);
      socket.emit("room:join", { roomCode, ...parsed }, (reply: { ok: boolean; room?: PublicGameRoom; error?: string }) => {
        if (reply.ok && reply.room) setRoom(reply.room);
      });
    } catch {
      localStorage.removeItem(playerKey(roomCode));
    }
  }, [socket, roomCode]);

  const currentPlayer = useMemo(
    () => room?.players.find((playerItem) => playerItem.id === profile?.playerId) || null,
    [room, profile]
  );
  const isHost = Boolean(roomCode && localStorage.getItem(hostKey(roomCode)));
  const currentQuestion = room?.questions[room.currentQuestionIndex];
  const currentAnswers = room?.answers[room.currentQuestionIndex] || [];
  const myAnswer = currentAnswers.find((answerItem) => answerItem.playerId === profile?.playerId);
  const effectiveStatus = room?.status === "paused" ? room.pausedFromStatus : room?.status;
  const countdown = room?.status === "paused" && room.pauseRemainingMs !== null
    ? Math.max(0, Math.ceil(room.pauseRemainingMs / 1000))
    : room?.questionDeadlineAt
      ? Math.max(0, Math.ceil((room.questionDeadlineAt - now) / 1000))
      : room?.timerSeconds || 20;
  const leaderboard = [...(room?.players || [])].sort((a, b) => b.score - a.score || b.correctAnswers - a.correctAnswers);

  async function createRoom() {
    setError("");
    const response = await fetch("/api/rooms", { method: "POST" });
    const data = await response.json();
    localStorage.setItem(hostKey(data.room.roomCode), data.hostKey);
    window.history.pushState({}, "", `/room/${data.room.roomCode}`);
    setRoomCode(data.room.roomCode);
    setRoom(data.room);
  }

  function goToJoinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("Enter a room code first.");
      return;
    }
    window.history.pushState({}, "", `/room/${code}`);
    setRoomCode(code);
    setError("");
  }

  function joinGame() {
    if (!socket || !roomCode) return;
    const trimmedName = joinName.trim();
    if (!trimmedName) {
      setError("Pick a name before joining.");
      return;
    }
    const nextProfile: Profile = {
      playerId: profile?.playerId || newId(),
      name: trimmedName,
      avatar,
      categoryVote
    };
    socket.emit("room:join", { roomCode, ...nextProfile }, (reply: { ok: boolean; room?: PublicGameRoom; playerId?: string; error?: string }) => {
      if (!reply.ok) {
        setError(reply.error || "Could not join that room.");
        return;
      }
      const saved = { ...nextProfile, playerId: reply.playerId || nextProfile.playerId };
      localStorage.setItem(playerKey(roomCode), JSON.stringify(saved));
      setProfile(saved);
      setRoom(reply.room || null);
      setError("");
    });
  }

  function vote(category: Category) {
    if (!socket || !profile || !roomCode || currentPlayer?.ready) return;
    const nextProfile = { ...profile, categoryVote: category };
    setProfile(nextProfile);
    localStorage.setItem(playerKey(roomCode), JSON.stringify(nextProfile));
    socket.emit("player:vote", { roomCode, playerId: profile.playerId, category });
  }

  function readyUp() {
    if (!socket || !profile || !roomCode || currentPlayer?.ready) return;
    socket.emit("player:ready", { roomCode, playerId: profile.playerId });
  }

  function submitAnswer(choice: string) {
    if (!socket || !profile || !roomCode || myAnswer || room?.status !== "in_progress") return;
    socket.emit("answer:submit", { roomCode, playerId: profile.playerId, selectedAnswer: choice });
  }

  function hostEmit(eventName: string) {
    if (!socket || !roomCode) return;
    socket.emit(eventName, { roomCode, hostKey: localStorage.getItem(hostKey(roomCode)) || undefined });
  }

  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/room/${roomCode}`);
  }

  function endGame() {
    hostEmit("host:end");
    setProfile(null);
    setRoom(null);
    setRoomCode("");
    setJoinCode("");
    setError("");
    if (roomCode) localStorage.removeItem(playerKey(roomCode));
    window.history.pushState({}, "", "/");
  }

  function exitGame() {
    if (roomCode && profile) {
      socket?.emit("player:leave", { roomCode, playerId: profile.playerId });
      localStorage.removeItem(playerKey(roomCode));
    }
    setProfile(null);
    setRoom(null);
    setRoomCode("");
    setJoinCode("");
    setError("");
    window.history.pushState({}, "", "/");
  }

  if (!roomCode) {
    return (
      <Shell>
        <section className="home-panel">
          <div>
            <p className="eyebrow">Phones out. Voices down.</p>
            <h1>SHUSH Trivia</h1>
            <p className="lede">A fast, friendly trivia party game for families, couches, classrooms, and kitchen tables.</p>
          </div>
          <div className="home-actions">
            <button className="primary-button" onClick={createRoom}>
              <Play size={20} /> Create Room
            </button>
            <div className="join-row">
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="Room code" maxLength={4} />
              <button onClick={goToJoinRoom}>Join</button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        </section>
      </Shell>
    );
  }

  return (
    <Shell roomCode={roomCode} onCopy={copyLink} showExit={Boolean(currentPlayer && room?.status !== "lobby")} onExit={exitGame}>
      {!currentPlayer || room?.status === "lobby" ? (
        <div className="grid-layout">
          <JoinCard
            name={joinName}
            setName={setJoinName}
            avatar={avatar}
            setAvatar={setAvatar}
            categoryVote={currentPlayer?.categoryVote || categoryVote}
            setCategoryVote={(category) => {
              setCategoryVote(category);
              vote(category);
            }}
            joined={Boolean(currentPlayer)}
            ready={Boolean(currentPlayer?.ready)}
            onJoin={joinGame}
            onReady={readyUp}
            error={error}
          />
          <LobbyCard room={room} isHost={isHost} hostEmit={hostEmit} />
        </div>
      ) : null}

      {room?.status === "generating_questions" && (
        <motion.section className="game-card center-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Sparkles size={34} />
          <h2>Building {room.selectedCategory} questions</h2>
          <p>Keeping it clean, fun, and family-ready.</p>
        </motion.section>
      )}

      {((room?.status === "in_progress" || room?.status === "showing_answer" || room?.status === "paused") && currentQuestion) && (
        <section className="game-card question-card">
          <div className="question-top">
            <span>Question {room.currentQuestionIndex + 1} of {room.questions.length}</span>
            <strong>{room.status === "paused" ? "Paused" : effectiveStatus === "in_progress" ? `${countdown}s` : "Answer"}</strong>
          </div>
          <h2>{currentQuestion.question}</h2>
          <div className="answers">
            {currentQuestion.choices.map((choice) => {
              const correct = effectiveStatus === "showing_answer" && choice === currentQuestion.correctAnswer;
              const mine = myAnswer?.selectedAnswer === choice;
              const wrongMine = effectiveStatus === "showing_answer" && mine && !correct;
              return (
                <button
                  key={choice}
                  className={classNames("answer-button", correct && "correct", wrongMine && "wrong", mine && "selected")}
                  disabled={Boolean(myAnswer) || room.status !== "in_progress"}
                  onClick={() => submitAnswer(choice)}
                >
                  {choice}
                </button>
              );
            })}
          </div>
          <AnimatePresence>
            {effectiveStatus === "showing_answer" && (
              <motion.div className="reveal" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <Crown size={20} />
                <span>
                  Correct: <strong>{currentQuestion.correctAnswer}</strong>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <PlayerStrip players={room.players} answers={currentAnswers} />
          {isHost && room.status !== "paused" && (
            <div className="host-row compact">
              <button onClick={() => hostEmit("host:pause")}><Pause size={18} /> Pause</button>
            </div>
          )}
        </section>
      )}

      {room?.status === "paused" && (
        <PauseLightbox isHost={isHost} hostEmit={hostEmit} onEnd={endGame} />
      )}

      {room?.status === "leaderboard" && (
        <motion.section className="game-card leaderboard" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
          <div className="leaderboard-head">
            <Trophy size={30} />
            <div>
              <p className="eyebrow">Winning category: {room.selectedCategory}</p>
              <h2>Leaderboard</h2>
            </div>
          </div>
          <div className="rank-list">
            {leaderboard.map((playerItem, index) => (
              <motion.div className="rank-row" key={playerItem.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.05 }}>
                <span className="rank">#{index + 1}</span>
                <span className="avatar-mini">{playerItem.avatar}</span>
                <span className="rank-name">{playerItem.name}</span>
                <span className="rank-score">{playerItem.score} pts</span>
                <small>{playerItem.correctAnswers} correct · {playerItem.fastestBonusCount} fastest</small>
              </motion.div>
            ))}
          </div>
          {isHost ? (
            <div className="host-row">
              <button onClick={() => hostEmit("host:playAgain")}><RefreshCcw size={18} /> Play Another Round</button>
              <button onClick={() => hostEmit("host:reset")}><Shield size={18} /> New Game</button>
            </div>
          ) : (
            <p className="notice">The host can start another round or reset the game.</p>
          )}
        </motion.section>
      )}
    </Shell>
  );
}

function PauseLightbox({ isHost, hostEmit, onEnd }: { isHost: boolean; hostEmit: (eventName: string) => void; onEnd: () => void }) {
  return (
    <div className="pause-backdrop" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <motion.section className="pause-modal" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}>
        <div className="pause-icon"><Pause size={30} /></div>
        <p className="eyebrow">Host pause</p>
        <h2 id="pause-title">Game Paused</h2>
        <p className="notice">Take a quick breather. Answers and timers are locked until the host resumes.</p>
        {isHost ? (
          <div className="pause-actions">
            <button className="primary-button" onClick={() => hostEmit("host:resume")}><Play size={18} /> Resume Game</button>
            <button onClick={() => hostEmit("host:restart")}><RefreshCcw size={18} /> Restart Game</button>
            <button className="danger-action" onClick={onEnd}><Shield size={18} /> End Game</button>
          </div>
        ) : (
          <p className="notice">Waiting for the host.</p>
        )}
      </motion.section>
    </div>
  );
}

function Shell({ children, roomCode, onCopy, showExit = false, onExit }: { children: React.ReactNode; roomCode?: string; onCopy?: () => void; showExit?: boolean; onExit?: () => void }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="brand-dot">S</span>
          <span className="brand">SHUSH Trivia</span>
        </div>
        <div className="top-actions">
          {roomCode && (
            <button className="room-pill" onClick={onCopy}>
              <Copy size={16} /> {roomCode}
            </button>
          )}
          {showExit && (
            <button className="exit-button" onClick={onExit}>
              <LogOut size={16} /> Exit Game
            </button>
          )}
        </div>
      </header>
      {children}
    </main>
  );
}

function JoinCard(props: {
  name: string;
  setName: (value: string) => void;
  avatar: string;
  setAvatar: (value: string) => void;
  categoryVote: Category;
  setCategoryVote: (value: Category) => void;
  joined: boolean;
  ready: boolean;
  onJoin: () => void;
  onReady: () => void;
  error: string;
}) {
  return (
    <section className="game-card">
      <p className="eyebrow">Join the round</p>
      <h2>Pick your player</h2>
      <input value={props.name} onChange={(event) => props.setName(event.target.value)} placeholder="Display name" maxLength={24} disabled={props.ready} />
      <div className="avatar-grid">
        {avatars.map((item) => (
          <button key={item} className={classNames("avatar-button", props.avatar === item && "active")} onClick={() => props.setAvatar(item)} disabled={props.ready}>
            {item}
          </button>
        ))}
      </div>
      <p className="small-label">Category vote</p>
      <div className="category-grid">
        {CATEGORIES.map((category) => (
          <button key={category} className={classNames(props.categoryVote === category && "active")} onClick={() => props.setCategoryVote(category)} disabled={props.ready}>
            {category}
          </button>
        ))}
      </div>
      {props.error && <p className="error">{props.error}</p>}
      {!props.joined ? (
        <button className="primary-button" onClick={props.onJoin}>Join Room</button>
      ) : (
        <motion.button className="primary-button" onClick={props.onReady} disabled={props.ready} whileTap={{ scale: 0.98 }}>
          {props.ready ? "Ready Locked" : "Ready to Play"}
        </motion.button>
      )}
    </section>
  );
}

function LobbyCard({ room, isHost, hostEmit }: { room: PublicGameRoom | null; isHost: boolean; hostEmit: (eventName: string) => void }) {
  return (
    <section className="game-card">
      <div className="card-title-row">
        <div>
          <p className="eyebrow">Live lobby</p>
          <h2>Players</h2>
        </div>
        <Users size={24} />
      </div>
      {!room?.players.length && <p className="notice">Share the room code or link, then join from each phone.</p>}
      <div className="player-list">
        {room?.players.map((playerItem) => (
          <motion.div className="player-row" key={playerItem.id} layout>
            <span className="avatar-mini">{playerItem.avatar}</span>
            <div>
              <strong>{playerItem.name}</strong>
              <small>{playerItem.categoryVote || "No vote"} · {playerItem.connected ? "online" : "offline"}</small>
            </div>
            <span className={classNames("ready-chip", playerItem.ready && "ready")}>{playerItem.ready ? "Ready" : "Waiting"}</span>
          </motion.div>
        ))}
      </div>
      {isHost && <HostControls hostEmit={hostEmit} showStart={room?.status === "lobby"} />}
    </section>
  );
}

function HostControls({ hostEmit, compact = false, showStart = false }: { hostEmit: (eventName: string) => void; compact?: boolean; showStart?: boolean }) {
  return (
    <div className={classNames("host-row", compact && "compact")}>
      {showStart && <button onClick={() => hostEmit("host:start")}><Play size={18} /> Start</button>}
      {!compact && <button onClick={() => hostEmit("host:kickDisconnected")}><UserX size={18} /> Kick Offline</button>}
      {!compact && <button onClick={() => hostEmit("host:reset")}><Shield size={18} /> Reset</button>}
    </div>
  );
}

function PlayerStrip({ players, answers }: { players: Player[]; answers: PublicGameRoom["answers"][number] }) {
  return (
    <div className="answer-strip">
      {players.map((playerItem) => {
        const answer = answers.find((answerItem) => answerItem.playerId === playerItem.id);
        return (
          <span key={playerItem.id} className={classNames("answer-chip", answer?.isCorrect && "right", answer && !answer.isCorrect && "miss")}>
            {playerItem.avatar} {playerItem.name}
          </span>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
