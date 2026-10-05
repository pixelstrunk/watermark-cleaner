const { DEFAULTS } = require("./defaults");
const { classifyCharacters, findPhrases } = require("./layers");
const { stripJpeg, stripPng, stripWebp } = require("./metadata");
const pipeline = require("./pipeline");
const { loadRules } = require("./rules");

function cleanText(text, config, rules, filePath) {
  return pipeline.cleanText(text, config || DEFAULTS, rules || loadRules(), filePath);
}

function classify(text, config, rules) {
  return classifyCharacters(text, pipeline.withDefaults(config), rules || loadRules());
}

function phrases(text, config, rules) {
  return findPhrases(text, pipeline.withDefaults(config), rules || loadRules());
}

module.exports = { cleanText, classifyCharacters: classify, findPhrases: phrases, stripJpeg, stripPng, stripWebp, DEFAULTS, loadRules };
