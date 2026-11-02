export type Unsubscribe = () => void;
export type Ms = number;
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTY_MULT: Record<Difficulty, number> = { easy: 1, medium: 1.5, hard: 2 };
