export const CATEGORIES = ["Animals", "Sports", "Music", "Food", "Movies"] as const;

export type Category = (typeof CATEGORIES)[number];
export type GameStatus =
  | "lobby"
  | "generating_questions"
  | "in_progress"
  | "showing_answer"
  | "paused"
  | "leaderboard";

export type Question = {
  question: string;
  choices: string[];
  correctAnswer: string;
};

export type Player = {
  id: string;
  name: string;
  avatar: string;
  categoryVote: Category | null;
  ready: boolean;
  score: number;
  correctAnswers: number;
  fastestBonusCount: number;
  connected: boolean;
};

export type Answer = {
  playerId: string;
  questionIndex: number;
  selectedAnswer: string;
  isCorrect: boolean;
  submittedAt: number;
  responseTimeMs: number;
  pointsAwarded: number;
};

export type GameRoom = {
  id: string;
  roomCode: string;
  players: Player[];
  status: GameStatus;
  selectedCategory: Category | null;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<number, Answer[]>;
  createdAt: number;
  questionStartedAt: number | null;
  questionDeadlineAt: number | null;
  timerSeconds: number;
  hostKey: string;
  aiError: string | null;
  pausedFromStatus: Exclude<GameStatus, "paused"> | null;
  pauseRemainingMs: number | null;
  answerRevealDeadlineAt: number | null;
};

export type PublicGameRoom = Omit<GameRoom, "hostKey">;

export type JoinPayload = {
  roomCode: string;
  playerId: string;
  name: string;
  avatar: string;
  categoryVote: Category;
};
