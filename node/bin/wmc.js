#!/usr/bin/env node
const { loadConfig, applyAggressive } = require("../src/config");
const { run } = require("../src/runner");
const { renderReport, renderSummary } = require("../src/report");

const VALUE_FLAGS = new Set(["config", "source-lang", "pivot-lang"]);

function parseArgs(argv) {
  const args = { paths: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        const name = token.slice(2, eqIndex);
        const val = token.slice(eqIndex + 1);
        args.flags[name] = val;
      } else {
        const name = token.slice(2);
        if (VALUE_FLAGS.has(name)) {
          args.flags[name] = argv[i + 1];
          i += 1;
        } else {
          args.flags[name] = true;
        }
      }
    } else {
      args.paths.push(token);
    }
  }
  return args;
}

function usage() {
  console.log("usage: wmc <check|fix|rewrite> [paths...]");
  console.log("  check|fix  [--json] [--no-voice] [--aggressive] [--no-backup] [--quiet] [--strict] [--config <file>]");
  console.log("  rewrite    [--source-lang <auto>] [--pivot-lang EN] [--write] [--config <file>]  (opt-in, sends text to deepl)");
  console.log("  --version  print the version");
}

function runScan(command, args) {
  const paths = args.paths.length ? args.paths : ["."];
  let config = loadConfig(args.flags.config, paths[0]);
  if (args.flags["no-voice"]) config.voice = false;
  if (args.flags.aggressive) config = applyAggressive(config);
  if (args.flags["no-backup"]) config.backup = false;

  const write = command === "fix";
  const reports = run(paths, config, write);

  if (args.flags.json) {
    console.log(JSON.stringify({ mode: command, summary: renderSummary(reports), reports }, null, 2));
  } else {
    if (!args.flags.quiet) {
      for (const report of reports) if (report.findings.length) console.log(renderReport(report));
    }
    console.log("");
    console.log(renderSummary(reports));
  }

  const blocking = reports.some((r) => r.has_errors);
  process.exit(blocking && (!write || args.flags.strict) ? 1 : 0);
}

async function runRewrite(args) {
  const { rewriteFile } = require("../src/rewrite/deepl");
  if (!args.paths.length) {
    usage();
    process.exit(1);
  }
  const config = loadConfig(args.flags.config, args.paths[0]);
  const sourceLang = args.flags["source-lang"] || null;
  const pivotLang = args.flags["pivot-lang"] || "EN";
  let code = 0;
  for (const path of args.paths) {
    try {
      const result = await rewriteFile(path, sourceLang, pivotLang, Boolean(args.flags.write), config);
      if (args.flags.write) console.log(`rewritten  ${path}`);
      else console.log(result);
    } catch (error) {
      console.error(`error  ${path}: ${error.message}`);
      code = 1;
    }
  }
  process.exit(code);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (command === "--version" || command === "-V") {
    console.log(`wmc ${require("../package.json").version}`);
    process.exit(0);
  }
  const args = parseArgs(argv);
  if (command === "check" || command === "fix") return runScan(command, args);
  if (command === "rewrite") return runRewrite(args);
  usage();
  process.exit(command === "--help" || command === "-h" ? 0 : 1);
}

main();
