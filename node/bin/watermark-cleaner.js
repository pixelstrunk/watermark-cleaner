#!/usr/bin/env node
const { loadConfig, applyAggressive, ConfigError } = require("../src/config");
const { run } = require("../src/runner");
const { renderReport, renderSummary, serializeReport } = require("../src/report");
const { cleanText } = require("../src/core");
const { loadRules } = require("../src/rules");

const STDIN = "-";

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
  console.log("usage: watermark-cleaner <check|fix|rewrite> [paths...]   (use - to read stdin)");
  console.log("  check|fix  [--json] [--no-voice] [--aggressive] [--no-backup] [--quiet] [--strict] [--config <file>]");
  console.log("  rewrite    [--source-lang <auto>] [--pivot-lang EN] [--write] [--config <file>]  (opt-in, sends text to deepl)");
  console.log("  --version  print the version");
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function scanStdin(config, write) {
  const raw = require("fs").readFileSync(0);
  let original;
  try {
    original = utf8Decoder.decode(raw);
  } catch (error) {
    const report = {
      path: "<stdin>",
      findings: [{ layer: "io", kind: "read", severity: "warn", message: "skipped (not utf-8 text)", count: 1, examples: [] }],
      changed: false,
      counts: { fixed: 0, warn: 1, error: 0 },
      has_errors: false,
    };
    return { reports: [report], output: raw };
  }
  const { text, report } = cleanText(original, config, loadRules(), "<stdin>");
  return { reports: [report], output: write ? Buffer.from(text, "utf-8") : raw };
}

function printReports(reports, args, write, stream) {
  const print = (line) => stream.write(`${line}\n`);
  if (args.flags.json) {
    print(JSON.stringify({ mode: write ? "fix" : "check", summary: renderSummary(reports, write), reports: reports.map(serializeReport) }, null, 2));
    return;
  }
  if (!args.flags.quiet) {
    for (const report of reports) if (report.findings.length) print(renderReport(report, write));
  }
  print("");
  print(renderSummary(reports, write));
}

function exitCode(reports, args, write) {
  const strict = Boolean(args.flags.strict);
  const blocking = reports.some((r) => r.has_errors);
  if (blocking && (!write || strict)) return 1;
  if (strict && !write && reports.some((r) => r.changed)) return 1;
  return 0;
}

function runScan(command, args) {
  const paths = args.paths.length ? args.paths : ["."];
  const configStart = paths[0] === STDIN ? "." : paths[0];
  let config = loadConfig(args.flags.config, configStart);
  if (args.flags["no-voice"]) config.voice = false;
  if (args.flags.aggressive) config = applyAggressive(config);
  if (args.flags["no-backup"]) config.backup = false;

  const write = command === "fix";
  if (paths.length === 1 && paths[0] === STDIN) {
    const { reports, output } = scanStdin(config, write);
    if (write) {
      process.stdout.write(output);
      printReports(reports, args, write, process.stderr);
    } else {
      printReports(reports, args, write, process.stdout);
    }
    return exitCode(reports, args, write);
  }
  if (paths.includes(STDIN)) {
    console.error("stdin (-) cannot be combined with file paths");
    return 2;
  }
  const reports = run(paths, config, write);
  printReports(reports, args, write, process.stdout);
  return exitCode(reports, args, write);
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
