---
name: False positive
about: The tool removed or flagged something it should not have
title: "false positive: "
labels: false-positive
---

**What was removed or flagged**

Paste the exact input text. If it contains invisible characters, paste it escaped (for example `water‌mark`) so the issue survives copy and paste.

**What the tool did**

Output of `wmc check <file> --json` for the affected file, or the relevant part of it.

**Why this is wrong**

For example: the character is required in this script, the phrase is normal usage in this domain.

**Versions**

- wmc version (`wmc --version`):
- Python or Node CLI:
- OS:
