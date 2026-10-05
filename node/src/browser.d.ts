import type { CharacterClass, CleanResult, Config, ImageStripper, PhraseHit, Rules } from "./types";

export * from "./types";

export const DEFAULTS: Readonly<Config>;
export const RULES: Readonly<Rules>;

export function cleanText(text: string, config?: Partial<Config>, rules?: Rules): CleanResult;
export function classifyCharacters(text: string, config?: Partial<Config>, rules?: Rules): CharacterClass[];
export function findPhrases(text: string, config?: Partial<Config>, rules?: Rules): PhraseHit[];

export const stripJpeg: ImageStripper;
export const stripPng: ImageStripper;
export const stripWebp: ImageStripper;
