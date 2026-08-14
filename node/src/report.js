const SEVERITY_ORDER = { fixed: 0, info: 1, warn: 2, error: 3 };
const SYMBOL = { fixed: "fixed", warn: "warn", error: "block", info: "info" };
const SYMBOL_CHECK = { fixed: "would fix", warn: "warn", error: "block", info: "info" };

function renderReport(report, write = true) {
  if (!report.findings.length) return `clean  ${report.path}`;
  const symbols = write ? SYMBOL : SYMBOL_CHECK;
  const c = report.counts;
  const bits = [];
  for (const key of ["error", "warn", "fixed"]) {
    if (c[key]) {
      const label = write || key !== "fixed" ? key : "would fix";
      bits.push(`${c[key]} ${label}`);
    }
  }
  const lines = [`${report.path}  (${bits.join(", ")})`];
  const ordered = [...report.findings].sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0));
  for (const f of ordered) {
    let line = `  [${symbols[f.severity] || f.severity}] ${f.message} x${f.count}`;
    if (f.examples && f.examples.length) line += `  (${f.examples.join(", ")})`;
    lines.push(line);
  }
  return lines.join("\n");
}

function renderSummary(reports, write = true) {
  const totals = { fixed: 0, warn: 0, error: 0 };
  let changed = 0;
  for (const r of reports) {
    for (const key of Object.keys(totals)) totals[key] += r.counts[key] || 0;
    if (r.changed) changed += 1;
  }
  const changedLabel = write ? "changed" : "would change";
  const fixedLabel = write ? "fixed" : "would fix";
  return [
    `${reports.length} files scanned`,
    `${changed} ${changedLabel}`,
    `${totals.fixed} ${fixedLabel}`,
    `${totals.warn} warnings`,
    `${totals.error} blocking`,
  ].join("  |  ");
}

function serializeReport(report) {
  const counts = report.counts || {};
  return {
    path: report.path,
    changed: Boolean(report.changed),
    original_length: report.original_length || 0,
    cleaned_length: report.cleaned_length || 0,
    counts: {
      fixed: counts.fixed || 0,
      warn: counts.warn || 0,
      error: counts.error || 0,
      info: counts.info || 0,
    },
    findings: report.findings.map((f) => ({
      layer: f.layer,
      kind: f.kind,
      severity: f.severity,
      message: f.message,
      count: f.count,
      examples: f.examples || [],
    })),
  };
}

module.exports = { renderReport, renderSummary, serializeReport };
