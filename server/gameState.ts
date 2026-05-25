import { randomUUID } from "node:crypto";
import { CATEGORIES, type Answer, type Category, type GameRoom, type JoinPayload, type Player, type PublicGameRoom } from "../shared/types";
import { generateQuestions } from "./aiQuestions";

const rooms = new Map<string, GameRoom>();
const timers = new Map<string, NodeJS.Timeout>();
let broadcaster: RoomUpdate = () => undefined;

const timerSeconds = Number.parseInt(process.env.QUESTION_TIMER_SECONDS || "20", 10);
const questionCount = Number.parseInt(process.env.QUESTION_COUNT || "15", 10);

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? roomCode() : code;
}

function publicRoom(room: GameRoom): PublicGameRoom {
  const { hostKey, ...visible } = room;
  const shouldReveal = room.status === "showing_answer" || room.pausedFromStatus === "showing_answer" || room.status === "leaderboard";
  return {
    ...visible,
    questions: room.questions.map((question, index) => ({
      ...question,
      correctAnswer: shouldReveal || index < room.currentQuestionIndex ? question.correctAnswer : ""
    }))
  };
}

function clearRoomTimer(roomCodeValue: string) {
  const timer = timers.get(roomCodeValue);
  if (timer) {
    clearTimeout(timer);
    timers.delete(roomCodeValue);
  }
}

function schedule(room: GameRoom, callback: () => void, ms: number) {
  clearRoomTimer(room.roomCode);
  timers.set(room.roomCode, setTimeout(callback, ms));
}

function pickCategory(room: GameRoom): Category {
  const counts = new Map<Category, number>();
  CATEGORIES.forEach((category) => counts.set(category, 0));
  room.players.forEach((player) => {
    if (player.categoryVote) counts.set(player.categoryVote, (counts.get(player.categoryVote) || 0) + 1);
  });

  const highest = Math.max(...Array.from(counts.values()));
  const candidates = CATEGORIES.filter((category) => counts.get(category) === highest);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function allReady(room: GameRoom) {
  return room.players.length > 0 && room.players.every((player) => player.ready);
}

export type RoomUpdate = (room: PublicGameRoom) => void;

export function setBroadcaster(emit: RoomUpdate) {
  broadcaster = emit;
}

export function createRoom() {
  const code = roomCode();
  const room: GameRoom = {
    id: randomUUID(),
    roomCode: code,
    players: [],
    status: "lobby",
    selectedCategory: null,
    questions: [],
    currentQuestionIndex: 0,
    answers: {},
    createdAt: Date.now(),
    questionStartedAt: null,
    questionDeadlineAt: null,
    timerSeconds,
    hostKey: randomUUID(),
    aiError: null,
    pausedFromStatus: null,
    pauseRemainingMs: null,
    answerRevealDeadlineAt: null
  };
  rooms.set(code, room);
  return { room: publicRoom(room), hostKey: room.hostKey };
}

export function getRoom(code: string) {
  const room = rooms.get(code.toUpperCase());
  return room ? publicRoom(room) : null;
}

export function joinRoom(payload: JoinPayload, socketId: string) {
  const room = rooms.get(payload.roomCode.toUpperCase());
  if (!room) throw new Error("Room not found");
  if (!payload.name.trim()) throw new Error("Please enter a name");
  if (!CATEGORIES.includes(payload.categoryVote)) throw new Error("Please choose a category");

  const player: Player = {
    id: payload.playerId || randomUUID(),
    name: payload.name.trim().slice(0, 24),
    avatar: payload.avatar,
    categoryVote: payload.categoryVote,
    ready: false,
    score: 0,
    correctAnswers: 0,
    fastestBonusCount: 0,
    connected: true
  };

  const existing = room.players.find((candidate) => candidate.id === payload.playerId);
  if (existing) {
    existing.name = player.name;
    existing.avatar = player.avatar;
    existing.categoryVote = player.categoryVote;
    existing.connected = true;
  } else {
    room.players.push(player);
  }

  return { room: publicRoom(room), playerId: existing?.id || player.id, socketId };
}

export function setDisconnected(playerId: string) {
  for (const room of rooms.values()) {
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (player) {
      player.connected = false;
      return publicRoom(room);
    }
  }
  return null;
}

export function leaveRoom(roomCodeValue: string, playerId: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room) return null;
  room.players = room.players.filter((player) => player.id !== playerId);
  Object.keys(room.answers).forEach((questionIndex) => {
    room.answers[Number(questionIndex)] = room.answers[Number(questionIndex)].filter((answer) => answer.playerId !== playerId);
  });

  if (room.status === "in_progress") {
    const answers = room.answers[room.currentQuestionIndex] || [];
    const activePlayers = room.players.filter((player) => player.connected);
    if (activePlayers.length > 0 && activePlayers.every((player) => answers.some((answer) => answer.playerId === player.id))) {
      return revealAnswer(room.roomCode);
    }
  }

  return publicRoom(room);
}

export function updatePlayer(roomCodeValue: string, playerId: string, patch: Partial<Pick<Player, "ready" | "categoryVote">>) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room || room.status !== "lobby") return null;
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  if (patch.categoryVote && CATEGORIES.includes(patch.categoryVote)) player.categoryVote = patch.categoryVote;
  if (patch.ready !== undefined && !player.ready) player.ready = patch.ready;
  return publicRoom(room);
}

export async function startRound(roomCodeValue: string, emit: RoomUpdate) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room || (room.status !== "lobby" && room.status !== "leaderboard")) return null;

  room.status = "generating_questions";
  room.selectedCategory = pickCategory(room);
  room.questions = [];
  room.answers = {};
  room.currentQuestionIndex = 0;
  room.aiError = null;
  room.questionStartedAt = null;
  room.questionDeadlineAt = null;
  room.answerRevealDeadlineAt = null;
  room.pauseRemainingMs = null;
  room.pausedFromStatus = null;
  emit(publicRoom(room));

  const result = await generateQuestions(room.selectedCategory, questionCount);
  room.questions = result.questions;
  room.aiError = result.usedFallback ? result.error : null;
  room.status = "in_progress";
  beginQuestion(room);
  emit(publicRoom(room));
  return publicRoom(room);
}

export function maybeAutoStart(roomCodeValue: string, emit: RoomUpdate) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (room && room.status === "lobby" && allReady(room)) {
    void startRound(room.roomCode, emit);
  }
}

function beginQuestion(room: GameRoom) {
  const now = Date.now();
  room.status = "in_progress";
  room.questionStartedAt = now;
  room.questionDeadlineAt = now + room.timerSeconds * 1000;
  room.answerRevealDeadlineAt = null;
  room.pausedFromStatus = null;
  room.pauseRemainingMs = null;
  room.answers[room.currentQuestionIndex] = room.answers[room.currentQuestionIndex] || [];
  scheduleQuestionReveal(room, room.timerSeconds * 1000);
}

function scheduleQuestionReveal(room: GameRoom, ms: number) {
  schedule(room, () => {
    const revealed = revealAnswer(room.roomCode);
    if (revealed) broadcaster(revealed);
  }, Math.max(0, ms));
}

function scheduleAnswerAdvance(room: GameRoom, ms = 4200) {
  room.answerRevealDeadlineAt = Date.now() + ms;
  schedule(room, () => {
    const advanced = advanceQuestion(room.roomCode);
    if (advanced) broadcaster(advanced);
  }, Math.max(0, ms));
}

export function submitAnswer(roomCodeValue: string, playerId: string, selectedAnswer: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room || room.status !== "in_progress" || room.questionStartedAt === null || room.questionDeadlineAt === null) return null;
  const player = room.players.find((candidate) => candidate.id === playerId);
  const question = room.questions[room.currentQuestionIndex];
  if (!player || !question) return null;
  if (Date.now() > room.questionDeadlineAt) return null;
  if (!question.choices.includes(selectedAnswer)) return null;

  const answers = room.answers[room.currentQuestionIndex] || [];
  if (answers.some((answer) => answer.playerId === playerId)) return publicRoom(room);

  const submittedAt = Date.now();
  const answer: Answer = {
    playerId,
    questionIndex: room.currentQuestionIndex,
    selectedAnswer,
    isCorrect: selectedAnswer === question.correctAnswer,
    submittedAt,
    responseTimeMs: submittedAt - room.questionStartedAt,
    pointsAwarded: 0
  };
  answers.push(answer);
  room.answers[room.currentQuestionIndex] = answers;

  const activePlayers = room.players.filter((candidate) => candidate.connected);
  if (activePlayers.length > 0 && activePlayers.every((candidate) => answers.some((answerItem) => answerItem.playerId === candidate.id))) {
    revealAnswer(room.roomCode);
  }

  return publicRoom(room);
}

export function revealAnswer(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room || room.status !== "in_progress") return null;

  clearRoomTimer(room.roomCode);
  const answers = room.answers[room.currentQuestionIndex] || [];
  const correctAnswers = answers.filter((answer) => answer.isCorrect).sort((a, b) => a.responseTimeMs - b.responseTimeMs);
  const fastestPlayerId = correctAnswers[0]?.playerId;

  answers.forEach((answer) => {
    if (answer.pointsAwarded > 0 || !answer.isCorrect) return;
    const player = room.players.find((candidate) => candidate.id === answer.playerId);
    if (!player) return;
    const bonus = answer.playerId === fastestPlayerId ? 1 : 0;
    answer.pointsAwarded = 5 + bonus;
    player.score += answer.pointsAwarded;
    player.correctAnswers += 1;
    player.fastestBonusCount += bonus;
  });

  room.status = "showing_answer";
  room.questionDeadlineAt = null;
  room.pauseRemainingMs = null;
  room.pausedFromStatus = null;
  scheduleAnswerAdvance(room);
  return publicRoom(room);
}

export function advanceQuestion(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room || room.status !== "showing_answer") return null;

  if (room.currentQuestionIndex >= room.questions.length - 1) {
    room.status = "leaderboard";
    room.questionStartedAt = null;
    room.questionDeadlineAt = null;
    room.answerRevealDeadlineAt = null;
    room.pauseRemainingMs = null;
    room.pausedFromStatus = null;
    clearRoomTimer(room.roomCode);
    return publicRoom(room);
  }

  room.currentQuestionIndex += 1;
  beginQuestion(room);
  return publicRoom(room);
}

export function pauseGame(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room || (room.status !== "in_progress" && room.status !== "showing_answer")) return null;

  const now = Date.now();
  room.pausedFromStatus = room.status;
  room.pauseRemainingMs = room.status === "in_progress"
    ? Math.max(0, (room.questionDeadlineAt || now) - now)
    : Math.max(0, (room.answerRevealDeadlineAt || now + 4200) - now);
  room.status = "paused";
  clearRoomTimer(room.roomCode);
  return publicRoom(room);
}

export function resumeGame(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room || room.status !== "paused" || !room.pausedFromStatus) return null;

  const remainingMs = Math.max(0, room.pauseRemainingMs ?? room.timerSeconds * 1000);
  const pausedFromStatus = room.pausedFromStatus;
  room.status = pausedFromStatus;
  room.pausedFromStatus = null;
  room.pauseRemainingMs = null;

  if (pausedFromStatus === "in_progress") {
    const now = Date.now();
    room.questionStartedAt = now - (room.timerSeconds * 1000 - remainingMs);
    room.questionDeadlineAt = now + remainingMs;
    scheduleQuestionReveal(room, remainingMs);
  } else if (pausedFromStatus === "showing_answer") {
    scheduleAnswerAdvance(room, remainingMs);
  }

  return publicRoom(room);
}

export function restartGame(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room) return null;
  clearRoomTimer(room.roomCode);
  room.status = "lobby";
  room.selectedCategory = null;
  room.questions = [];
  room.currentQuestionIndex = 0;
  room.answers = {};
  room.questionStartedAt = null;
  room.questionDeadlineAt = null;
  room.answerRevealDeadlineAt = null;
  room.pauseRemainingMs = null;
  room.pausedFromStatus = null;
  room.aiError = null;
  room.players.forEach((player) => {
    player.ready = false;
    player.categoryVote = null;
    player.score = 0;
    player.correctAnswers = 0;
    player.fastestBonusCount = 0;
  });
  return publicRoom(room);
}

export function endGame(roomCodeValue: string) {
  return resetRoom(roomCodeValue);
}

export function playAnotherRound(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room) return null;
  clearRoomTimer(room.roomCode);
  room.status = "lobby";
  room.selectedCategory = null;
  room.questions = [];
  room.currentQuestionIndex = 0;
  room.answers = {};
  room.questionStartedAt = null;
  room.questionDeadlineAt = null;
  room.answerRevealDeadlineAt = null;
  room.pauseRemainingMs = null;
  room.pausedFromStatus = null;
  room.aiError = null;
  room.players.forEach((player) => {
    player.ready = false;
    player.categoryVote = null;
  });
  return publicRoom(room);
}

export function resetRoom(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room) return null;
  clearRoomTimer(room.roomCode);
  room.players = [];
  room.status = "lobby";
  room.selectedCategory = null;
  room.questions = [];
  room.currentQuestionIndex = 0;
  room.answers = {};
  room.questionStartedAt = null;
  room.questionDeadlineAt = null;
  room.answerRevealDeadlineAt = null;
  room.pauseRemainingMs = null;
  room.pausedFromStatus = null;
  room.aiError = null;
  return publicRoom(room);
}

export function kickDisconnected(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  if (!room) return null;
  room.players = room.players.filter((player) => player.connected);
  return publicRoom(room);
}

export function canHost(roomCodeValue: string, hostKey: string | undefined) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  return Boolean(room && hostKey && room.hostKey === hostKey);
}

export function snapshot(roomCodeValue: string) {
  const room = rooms.get(roomCodeValue.toUpperCase());
  return room ? publicRoom(room) : null;
}
