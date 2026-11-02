/** @tikshuv/quiz - question schemas, headless QuizSession, DOM QuestionRenderer (task F8). */
export { questionSchema, questionsSchema, parseQuestions } from './schema.js';
export type { Question, QuestionKind, Tier, AnswerValue } from './schema.js';
export { TIER_POINTS, HINT_FACTOR, RETRY_FACTOR, defaultTier, pointsFor, isCorrect } from './grade.js';
export { createQuizSession, restoreQuizSession } from './session.js';
export type {
  QuizOptions, QuizSession, QuizSnapshot, QuizSummary, QuestionResult, QuestionView, SubmitResult,
} from './session.js';
export { renderQuestion, mountQuiz } from './renderer.js';
export type { RenderOptions, QuestionHandle, QuizStrings } from './renderer.js';
