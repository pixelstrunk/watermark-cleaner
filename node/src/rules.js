const fs = require("fs");
const path = require("path");

const RULE_FILES = ["characters", "typography", "phrases", "homoglyphs"];

function candidateDirs() {
  const dirs = [];
  if (process.env.WMC_RULES_DIR) dirs.push(process.env.WMC_RULES_DIR);
  dirs.push(path.join(__dirname, "..", "rules_data"));
  let current = __dirname;
  for (let i = 0; i < 6; i += 1) {
    dirs.push(path.join(current, "rules"));
    current = path.dirname(current);
  }
  return dirs;
}

function resolveDir() {
  for (const dir of candidateDirs()) {
    if (fs.existsSync(path.join(dir, "characters.json"))) return dir;
  }
  throw new Error("wmc rules not found. set WMC_RULES_DIR or run from the repository.");
}

let cache = null;

function loadRules() {
  if (cache) return cache;
  const base = resolveDir();
  const rules = {};
  for (const name of RULE_FILES) {
    rules[name] = JSON.parse(fs.readFileSync(path.join(base, `${name}.json`), "utf-8"));
  }
  cache = rules;
  return rules;
}

module.exports = { loadRules };
