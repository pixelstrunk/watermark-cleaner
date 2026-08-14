from .findings import SEVERITY_ORDER

_SYMBOL = {"fixed": "fixed", "warn": "warn", "error": "block", "info": "info"}
_SYMBOL_CHECK = {"fixed": "would fix", "warn": "warn", "error": "block", "info": "info"}


def render_report(report, write=True):
    lines = []
    if not report.findings:
        return f"clean  {report.path}"
    symbols = _SYMBOL if write else _SYMBOL_CHECK
    counts = report.counts()
    summary_bits = []
    for key in ("error", "warn", "fixed"):
        if counts.get(key):
            label = key if write or key != "fixed" else "would fix"
            summary_bits.append(f"{counts[key]} {label}")
    header = f"{report.path}  ({', '.join(summary_bits)})"
    lines.append(header)
    ordered = sorted(report.findings, key=lambda f: -SEVERITY_ORDER.get(f.severity, 0))
    for finding in ordered:
        tag = symbols.get(finding.severity, finding.severity)
        line = f"  [{tag}] {finding.message} x{finding.count}"
        if finding.examples:
            line += f"  ({', '.join(finding.examples)})"
        lines.append(line)
    return "\n".join(lines)


def render_summary(reports, write=True):
    totals = {"fixed": 0, "warn": 0, "error": 0}
    files_changed = 0
    files_blocked = 0
    for report in reports:
        counts = report.counts()
        for key in totals:
            totals[key] += counts.get(key, 0)
        if report.changed:
            files_changed += 1
        if report.has_blocking:
            files_blocked += 1
    changed_label = "changed" if write else "would change"
    fixed_label = "fixed" if write else "would fix"
    parts = [
        f"{len(reports)} files scanned",
        f"{files_changed} {changed_label}",
        f"{totals['fixed']} {fixed_label}",
        f"{totals['warn']} warnings",
        f"{totals['error']} blocking",
    ]
    return "  |  ".join(parts)
