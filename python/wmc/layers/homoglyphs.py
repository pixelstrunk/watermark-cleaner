from ..findings import Finding


def clean(text, config, rules):
    mapping = rules["homoglyphs"]["confusables"]
    findings = []
    table = {}
    total = 0
    seen = {}
    for hex_cp, replacement in mapping.items():
        code = int(hex_cp, 16)
        occurrences = text.count(chr(code))
        if occurrences:
            total += occurrences
            table[code] = replacement
            seen[code] = occurrences

    if not total:
        return text, findings

    if config.get("replace_homoglyphs", False):
        text = text.translate(table)
        findings.append(
            Finding("homoglyphs", "confusable", "fixed", "replaced look-alike letters with ascii", total)
        )
    else:
        examples = [f"U+{code:04X}" for code in list(seen.keys())[:8]]
        findings.append(
            Finding(
                "homoglyphs",
                "confusable",
                "warn",
                "look-alike letters found (enable replace_homoglyphs or --aggressive to fix)",
                total,
                examples,
            )
        )
    return text, findings
