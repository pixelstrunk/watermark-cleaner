# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub security advisories (Security tab, "Report a vulnerability") or by email to christian@christianstrunk.com. Do not open a public issue for a vulnerability.

You can expect an initial response within a week.

## Hardening in place

- File writes are atomic (temp file plus rename) and never follow symlinks.
- Input files larger than `max_file_bytes` (default 256 MiB) are skipped.
- CI uses SHA-pinned actions, least-privilege permissions, CodeQL, Dependabot and pip-audit. Releases are published via trusted publishing without long-lived tokens.

## Scope notes

- The cleaner parses untrusted file content (text, JPEG, PNG, WebP, SVG). Parsing bugs that lead to corrupted output or crashes on crafted input are in scope.
- The tool removes bidi control characters from left-to-right documents as a defense against Trojan Source style attacks. Bypasses of that defense are in scope.
- The DeepL rewrite command sends text to the DeepL API over HTTPS when explicitly invoked. Everything else works offline.
