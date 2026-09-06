#!/usr/bin/env node
const { loadConfig, applyAggressive, ConfigError } = require("../src/config");
const { run } = require("../src/runner");
const { renderReport, renderSummary, serializeReport } = require("../src/report");

const VALUE_FLAGS = new Set(["config", "source-lang", "pivot-lang"]);
const KNOWN_FLAGS = {
  check: new Set(["config", "json", "no-voice", "aggressive", "no-backup", "quiet", "strict"]),
  fix: new Set(["config", "json", "no-voice", "aggressive", "no-backup", "quiet", "strict"]),
  rewrite: new Set(["config", "source-lang", "pivot-lang", "write"]),
};

function parseArgs(argv, known) {
  const args = { paths: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      const name = eqIndex !== -1 ? token.slice(2, eqIndex) : token.slice(2);
      if (!known.has(name)) {
        throw new Error(`unknown option: --${name}`);
      }
      if (eqIndex !== -1) {
        args.flags[name] = token.slice(eqIndex + 1);
      } else if (VALUE_FLAGS.has(name)) {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new Error(`option --${name} requires a value`);
        }
        args.flags[name] = value;
        i += 1;
      } else {
        args.flags[name] = true;
      }
    } else {
      args.paths.push(token);
    }
  }
  return args;
}

function usage() {
  console.log("usage: watermark-cleaner <check|fix|rewrite> [paths...]");
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
    console.log(JSON.stringify({ mode: command, summary: renderSummary(reports, write), reports: reports.map(serializeReport) }, null, 2));
  } else {
    if (!args.flags.quiet) {
      for (const report of reports) if (report.findings.length) console.log(renderReport(report, write));
    }
    console.log("");
    console.log(renderSummary(reports, write));
  }

  const blocking = reports.some((r) => r.has_errors);
  return blocking && (!write || args.flags.strict) ? 1 : 0;
}

async function runRewrite(args) {
  const { rewriteFile } = require("../src/rewrite/deepl");
  if (!args.paths.length) {
    usage();
    return 1;
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
  return code;
}

function isUsageError(error) {
  return error instanceof ConfigError || /^unknown option: --|^option --.+ requires a value$|^config not found: /.test(error.message);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (command === "--version" || command === "-V") {
    console.log(`watermark-cleaner ${require("../package.json").version}`);
    return 0;
  }
  if (!Object.prototype.hasOwnProperty.call(KNOWN_FLAGS, command)) {
    usage();
    return command === "--help" || command === "-h" ? 0 : 1;
  }
  try {
    const args = parseArgs(argv, KNOWN_FLAGS[command]);
    if (command === "check" || command === "fix") return runScan(command, args);
    return await runRewrite(args);
  } catch (error) {
    if (isUsageError(error)) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}

main().then((code) => {
  process.exitCode = code;
});
