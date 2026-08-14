const fs = require("fs");

const { cleanText } = require("../core");
const { loadRules } = require("../rules");
const { isSymlink, writeAtomic } = require("../safeio");

const FREE_HOST = "https://api-free.deepl.com";
const PRO_HOST = "https://api.deepl.com";

function endpoint(apiKey) {
  const host = apiKey.trim().endsWith(":fx") ? FREE_HOST : PRO_HOST;
  return `${host}/v2/translate`;
}

function friendlyError(status) {
  if (status === 429) return "deepl rate limit reached, wait a moment and retry";
  if (status === 456) return "deepl quota exceeded for this billing period";
  if (status === 401 || status === 403) return "deepl rejected the api key, check DEEPL_API_KEY";
  return `deepl responded with http ${status}`;
}

async function translate(text, apiKey, targetLang, sourceLang) {
  if (typeof fetch !== "function") {
    throw new Error("global fetch is required; use node 18 or newer");
  }
  const body = new URLSearchParams({ text, target_lang: targetLang });
  if (sourceLang) body.set("source_lang", sourceLang);
  const response = await fetch(endpoint(apiKey), {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "watermark-cleaner/0.2",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(friendlyError(response.status));
  }
  const payload = await response.json();
  const translation = payload.translations[0];
  return { text: translation.text, detected: translation.detected_source_language };
}

async function backTranslate(text, sourceLang, pivotLang, apiKey) {
  apiKey = apiKey || process.env.DEEPL_API_KEY;
  if (!apiKey) throw new Error("set DEEPL_API_KEY to use the rewrite command");
  const pivot = await translate(text, apiKey, pivotLang, sourceLang);
  const backTarget = sourceLang || pivot.detected;
  if (!backTarget) throw new Error("could not detect the source language, pass --source-lang");
  if (backTarget.toUpperCase().startsWith(pivotLang.toUpperCase())) {
    throw new Error(`text is already in the pivot language (${backTarget}), pass a different --pivot-lang`);
  }
  const back = await translate(pivot.text, apiKey, backTarget, pivotLang);
  return back.text;
}

async function rewriteFile(path, sourceLang, pivotLang, write, config) {
  const original = fs.readFileSync(path, "utf-8");
  let rewritten = await backTranslate(original, sourceLang, pivotLang);
  if (config) {
    rewritten = cleanText(rewritten, config, loadRules(), path).text;
  }
  if (write) {
    if (isSymlink(path)) {
      throw new Error(`refusing to write through symlink: ${path}`);
    }
    const bak = `${path}.bak`;
    if (!fs.existsSync(bak)) fs.copyFileSync(path, bak);
    writeAtomic(path, rewritten);
  }
  return rewritten;
}

module.exports = { backTranslate, rewriteFile };
