const SEVERITY_ORDER = { fixed: 0, info: 1, warn: 2, error: 3 };
const SYMBOL = { fixed: "fixed", warn: "warn", error: "block", info: "info" };

function renderReport(report) {
  if (!report.findings.length) return `clean  ${report.path}`;
  const c = report.counts;
  const bits = [];
  for (const key of ["error", "warn", "fixed"]) if (c[key]) bits.push(`${c[key]} ${key}`);
  const lines = [`${report.path}  (${bits.join(", ")})`];
  const ordered = [...report.findings].sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0));
  for (const f of ordered) {
    let line = `  [${SYMBOL[f.severity] || f.severity}] ${f.message} x${f.count}`;
    if (f.examples && f.examples.length) line += `  (${f.examples.join(", ")})`;
    lines.push(line);
  }
  return lines.join("\n");
}

function renderSummary(reports) {
  const totals = { fixed: 0, warn: 0, error: 0 };
  let changed = 0;
  for (const r of reports) {
    for (const key of Object.keys(totals)) totals[key] += r.counts[key] || 0;
    if (r.changed) changed += 1;
  }
  return [
    `${reports.length} files scanned`,
    `${changed} changed`,
    `${totals.fixed} fixed`,
    `${totals.warn} warnings`,
    `${totals.error} blocking`,
  ].join("  |  ");
}

module.exports = { renderReport, renderSummary };
