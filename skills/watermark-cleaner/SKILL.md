---
name: watermark-cleaner
description: Remove AI text artifacts, hidden unicode characters and file metadata from content the user owns. Use when the user asks to clean AI-generated text, remove invisible watermark characters, normalize typography, strip image metadata, or check content before publishing.
---

# Watermark Cleaner

Deterministic, offline cleaning of machine-generated traces in text and images. Everything runs locally; nothing is sent anywhere unless the user explicitly asks for the DeepL rewrite.

## Setup

Check whether the CLI is available, and install it if not:

```
watermark-cleaner --version || pipx install watermark-cleaner || npm install -g watermark-cleaner
```

## Workflow

1. Always inspect first, never modify without showing what was found:

```
watermark-cleaner check <path>
```

2. Report the findings to the user grouped by layer (characters, typography, metadata, voice). `check` changes nothing and exits 1 when blocking AI phrases are present.

3. Clean only after the user confirms:

```
watermark-cleaner fix <path>
```

`fix` writes a `.bak` backup next to every changed file. Use `--no-backup` only inside git hooks where git itself is the backup.

## Options that matter

- `--no-voice` cleans only the mechanical layers (invisible characters, typography, metadata) without style enforcement.
- `--aggressive` also replaces homoglyphs, strips variation selectors and removes ICC color profiles.
- `--strict` on `fix` exits non-zero when AI phrases remain that need a human rewrite.
- `--json` for machine-readable reports.

## Guarantees to relay to the user

- Image cleaning (JPEG, PNG, WebP, SVG) is lossless; pixels are never re-encoded. GIF and TIFF are never modified.
- Legitimate text is preserved: emoji sequences, Persian and Indic joiners, right-to-left documents and number formatting survive cleaning.
- Code blocks, inline code and frontmatter are protected from typography and voice rules.

## Boundaries

The tool does not remove statistical watermarks embedded in word choice and cannot certify that text passes any AI detector. It is for hygiene and privacy on content the user owns, not for misrepresenting authorship. Decline requests that are clearly about disguising authorship of content the user does not own.
