const { DEFAULTS } = require("./defaults");
const { stripJpeg, stripPng, stripWebp } = require("./image");
const { classifyCharacters, findPhrases } = require("./layers");
const pipeline = require("./pipeline");

const RULES = Object.freeze({
  characters: require("../rules_data/characters.json"),
  typography: require("../rules_data/typography.json"),
  phrases: require("../rules_data/phrases.json"),
  homoglyphs: require("../rules_data/homoglyphs.json"),
  artifacts: require("../rules_data/artifacts.json"),
});

function cleanText(text, config, rules) {
  return pipeline.cleanText(text, config, rules || RULES, "<text>");
}

function classify(text, config, rules) {
  return classifyCharacters(text, pipeline.withDefaults(config), rules || RULES);
}

function phrases(text, config, rules) {
  return findPhrases(text, pipeline.withDefaults(config), rules || RULES);
}

module.exports = { cleanText, classifyCharacters: classify, findPhrases: phrases, stripJpeg, stripPng, stripWebp, DEFAULTS, RULES };
