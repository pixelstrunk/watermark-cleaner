from .findings import SEVERITY_ORDER

_SYMBOL = {"fixed": "fixed", "warn": "warn", "error": "block", "info": "info"}


def render_report(report, verbose=False):
    lines = []
    if not report.findings:
        return f"clean  {report.path}"
    counts = report.counts()
    summary_bits = []
    for key in ("error", "warn", "fixed"):
        if counts.get(key):
            summary_bits.append(f"{counts[key]} {key}")
    header = f"{report.path}  ({', '.join(summary_bits)})"
    lines.append(header)
    ordered = sorted(report.findings, key=lambda f: -SEVERITY_ORDER.get(f.severity, 0))
    for finding in ordered:
        tag = _SYMBOL.get(finding.severity, finding.severity)
        line = f"  [{tag}] {finding.message} x{finding.count}"
        if finding.examples:
            line += f"  ({', '.join(finding.examples)})"
        lines.append(line)
    return "\n".join(lines)


def render_summary(reports):
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
    parts = [
        f"{len(reports)} files scanned",
        f"{files_changed} changed",
        f"{totals['fixed']} fixed",
        f"{totals['warn']} warnings",
        f"{totals['error']} blocking",
    ]
    return "  |  ".join(parts)
