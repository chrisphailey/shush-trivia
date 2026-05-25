import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  advanceQuestion,
  canHost,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  kickDisconnected,
  maybeAutoStart,
  pauseGame,
  playAnotherRound,
  restartGame,
  resumeGame,
  endGame,
  resetRoom,
  revealAnswer,
  setBroadcaster,
  setDisconnected,
  snapshot,
  startRound,
  submitAnswer,
  updatePlayer
} from "./gameState";
import type { Category, JoinPayload, PublicGameRoom } from "../shared/types";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT || "3001", 10);

app.use(cors());
app.use(express.json());

app.post("/api/rooms", (_request, response) => {
  response.json(createRoom());
});

app.get("/api/rooms/:code", (request, response) => {
  const room = getRoom(request.params.code);
  if (!room) {
    response.status(404).json({ error: "Room not found" });
    return;
  }
  response.json({ room });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(__dirname, "../dist");
  app.use(express.static(dist));
  app.get(/.*/, (_request, response) => response.sendFile(path.join(dist, "index.html")));
}

function emitRoom(room: PublicGameRoom | null) {
  if (!room) return;
  io.to(room.roomCode).emit("room:update", room);
}

setBroadcaster(emitRoom);

function guardedHostAction(roomCode: string, hostKey: string | undefined, action: () => PublicGameRoom | null | Promise<PublicGameRoom | null>) {
  if (!canHost(roomCode, hostKey)) return null;
  return action();
}

io.on("connection", (socket) => {
  let currentRoomCode: string | null = null;
  let currentPlayerId: string | null = null;

  socket.on("room:join", (payload: JoinPayload, ack?: (reply: unknown) => void) => {
    try {
      const result = joinRoom(payload, socket.id);
      currentRoomCode = payload.roomCode.toUpperCase();
      currentPlayerId = result.playerId;
      socket.join(currentRoomCode);
      emitRoom(result.room);
      ack?.({ ok: true, room: result.room, playerId: result.playerId });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unable to join room" });
    }
  });

  socket.on("player:vote", (payload: { roomCode: string; playerId: string; category: Category }) => {
    emitRoom(updatePlayer(payload.roomCode, payload.playerId, { categoryVote: payload.category }));
  });

  socket.on("player:ready", (payload: { roomCode: string; playerId: string }) => {
    const room = updatePlayer(payload.roomCode, payload.playerId, { ready: true });
    emitRoom(room);
    maybeAutoStart(payload.roomCode, emitRoom);
  });

  socket.on("player:leave", (payload: { roomCode: string; playerId: string }) => {
    const before = snapshot(payload.roomCode);
    const room = leaveRoom(payload.roomCode, payload.playerId);
    socket.leave(payload.roomCode.toUpperCase());
    if (currentRoomCode === payload.roomCode.toUpperCase() && currentPlayerId === payload.playerId) {
      currentRoomCode = null;
      currentPlayerId = null;
    }
    emitRoom(room);
    const after = snapshot(payload.roomCode);
  });

  socket.on("answer:submit", (payload: { roomCode: string; playerId: string; selectedAnswer: string }) => {
    const before = snapshot(payload.roomCode);
    const room = submitAnswer(payload.roomCode, payload.playerId, payload.selectedAnswer);
    emitRoom(room);
    const after = snapshot(payload.roomCode);
  });

  socket.on("host:start", async (payload: { roomCode: string; hostKey?: string }) => {
    await guardedHostAction(payload.roomCode, payload.hostKey, () => startRound(payload.roomCode, emitRoom));
  });

  socket.on("host:reveal", (payload: { roomCode: string; hostKey?: string }) => {
    const room = guardedHostAction(payload.roomCode, payload.hostKey, () => revealAnswer(payload.roomCode));
    emitRoom(room as PublicGameRoom | null);
  });

  socket.on("host:advance", (payload: { roomCode: string; hostKey?: string }) => {
    emitRoom(guardedHostAction(payload.roomCode, payload.hostKey, () => advanceQuestion(payload.roomCode)) as PublicGameRoom | null);
  });

  socket.on("host:pause", (payload: { roomCode: string; hostKey?: string }) => {
    emitRoom(guardedHostAction(payload.roomCode, payload.hostKey, () => pauseGame(payload.roomCode)) as PublicGameRoom | null);
  });

  socket.on("host:resume", (payload: { roomCode: string; hostKey?: string }) => {
    emitRoom(guardedHostAction(payload.roomCode, payload.hostKey, () => resumeGame(payload.roomCode)) as PublicGameRoom | null);
  });

  socket.on("host:restart", (payload: { roomCode: string; hostKey?: string }) => {
    emitRoom(guardedHostAction(payload.roomCode, payload.hostKey, () => restartGame(payload.roomCode)) as PublicGameRoom | null);
  });

  socket.on("host:end", (payload: { roomCode: string; hostKey?: string }) => {
    emitRoom(guardedHostAction(payload.roomCode, payload.hostKey, () => endGame(payload.roomCode)) as PublicGameRoom | null);
  });

  socket.on("host:playAgain", (payload: { roomCode: string; hostKey?: string }) => {
    emitRoom(guardedHostAction(payload.roomCode, payload.hostKey, () => playAnotherRound(payload.roomCode)) as PublicGameRoom | null);
  });

  socket.on("host:reset", (payload: { roomCode: string; hostKey?: string }) => {
    emitRoom(guardedHostAction(payload.roomCode, payload.hostKey, () => resetRoom(payload.roomCode)) as PublicGameRoom | null);
  });

  socket.on("host:kickDisconnected", (payload: { roomCode: string; hostKey?: string }) => {
    emitRoom(guardedHostAction(payload.roomCode, payload.hostKey, () => kickDisconnected(payload.roomCode)) as PublicGameRoom | null);
  });

  socket.on("disconnect", () => {
    if (!currentPlayerId) return;
    const room = setDisconnected(currentPlayerId);
    if (room && currentRoomCode) io.to(currentRoomCode).emit("room:update", room);
  });
});

httpServer.listen(port, () => {
  console.log(`SHUSH Trivia server listening on http://localhost:${port}`);
});
