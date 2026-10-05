export type Severity = "fixed" | "info" | "warn" | "error";

export interface Finding {
  layer: string;
  kind: string;
  severity: Severity;
  message: string;
  count: number;
  examples: string[];
  by_rule: Record<string, number>;
}

export interface Report {
  path: string;
  findings: Finding[];
  original_length: number;
  cleaned_length: number;
  changed: boolean;
  counts: Record<Severity, number>;
  has_errors: boolean;
}

export interface CleanResult {
  text: string;
  report: Report;
}

export type LayerName = "entities" | "characters" | "homoglyphs" | "typography" | "voice" | "artifacts";

export interface Config {
  strip_variation_selectors: boolean;
  keep_nbsp_in_numbers: boolean;
  normalize_form: "NFC" | "NFKC" | "NFD" | "NFKD" | "none";
  straight_quotes: boolean;
  fix_punctuation: boolean;
  fix_dashes: boolean;
  dash_policy?: Record<string, string>;
  replace_homoglyphs: boolean;
  fix_safe_delete_phrases: boolean;
  voice: boolean;
  protect_code: boolean;
  strip_icc: boolean;
  backup: boolean;
  custom_banned_phrases: string[];
  ignore_phrases: string[];
  layers: LayerName[];
  text_extensions: string[];
  image_extensions: string[];
  document_extensions: string[];
  exclude: string[];
  max_file_bytes?: number;
}

export interface Rules {
  characters: Record<string, unknown>;
  typography: Record<string, unknown>;
  phrases: Record<string, unknown>;
  homoglyphs: Record<string, unknown>;
  artifacts: Record<string, unknown>;
}

export type CharacterAction = "keep" | "remove" | "space";

export interface CharacterClass {
  index: number;
  char: string;
  code: number;
  action: CharacterAction;
  name: string | null;
}

export type PhraseKind = "banned" | "filler" | "shape" | "lexicon";

export interface PhraseHit {
  start: number;
  end: number;
  kind: PhraseKind;
  id: string;
  severity: Severity;
  text: string;
}

export interface ImageResult {
  cleaned: Uint8Array;
  stripped: number;
  orientation: number | null;
}

export type ImageStripper = (data: Uint8Array, stripIcc?: boolean) => ImageResult | null;
