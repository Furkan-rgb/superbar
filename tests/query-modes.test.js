// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_SYMBOL_PATTERN,
  CLIPBOARD_QUERY_PATTERN,
  DICTIONARY_PREFIX_PATTERN,
  QUERY_MODE_CYCLE,
  WEATHER_PREFIX_PATTERN,
  cycleQueryMode,
  getQueryModeByPrefix,
  getQueryModeCycle,
  getQueryModeToken,
  matchTypedQueryMode,
  parseDictionaryQuery,
  parseWeatherQuery,
  stripQueryModePrefix,
} from "../query-modes.js";

const forward = (text, kind) => cycleQueryMode({ text, kind });
const backward = (text, kind) => cycleQueryMode({ text, kind, direction: -1 });

test("tab walks every mode in turn and wraps", () => {
  assert.equal(forward("", "generic").kind, "clipboard");
  assert.equal(forward("", "clipboard").kind, "actions");
  assert.equal(forward("", "actions").kind, "weather");
  assert.equal(forward("", "weather").kind, "dictionary");
  assert.equal(forward("", "dictionary").kind, "generic");
});

test("shift+tab walks the cycle the other way", () => {
  assert.equal(backward("", "generic").kind, "dictionary");
  assert.equal(backward("", "dictionary").kind, "weather");
  assert.equal(backward("", "clipboard").kind, "generic");
});

test("switching modes keeps the query and moves the prefix to the chip", () => {
  const next = forward("invoice", "generic");
  assert.equal(next.prefix, "clip ");
  assert.equal(next.query, "invoice");
});

test("a prefix the user typed is taken out of the query when cycling", () => {
  assert.deepEqual(forward("clip invoice", "clipboard"), {
    kind: "actions",
    prefix: "> ",
    query: "invoice",
  });
});

test("a query the cycle has no prefix for counts as all results", () => {
  assert.equal(forward("10 usd to eur", "currency").kind, "clipboard");
  assert.equal(forward("2 + 2", "calculator").query, "2 + 2");
});

test("modes switched off in preferences drop out of the cycle", () => {
  const withoutClipboard = (key) => key !== "clipboard-search-enabled";

  assert.deepEqual(
    getQueryModeCycle(withoutClipboard).map((mode) => mode.kind),
    ["generic", "actions", "weather", "dictionary"],
  );
  assert.equal(
    cycleQueryMode({
      text: "",
      kind: "generic",
      isModeEnabled: withoutClipboard,
    }).kind,
    "actions",
  );
});

test("a cycle of one is not a cycle", () => {
  const result = cycleQueryMode({
    text: "note",
    kind: "generic",
    isModeEnabled: () => false,
  });
  assert.equal(result, null);
});

test("the chip shows the prefix as it would have been typed", () => {
  assert.equal(getQueryModeToken("clip "), "clip");
  assert.equal(getQueryModeToken("> "), ">");
  assert.equal(getQueryModeToken(""), "");
});

test("every mode carries its own placeholder", () => {
  assert.equal(getQueryModeByPrefix("weather ").hint, "e.g. Amsterdam");
  assert.equal(getQueryModeByPrefix("").hint, "Search");
  assert.equal(getQueryModeByPrefix("nonsense").kind, "generic");
});

test("a typed prefix is promoted once its separator arrives", () => {
  assert.equal(matchTypedQueryMode("clip ").mode.kind, "clipboard");
  assert.equal(matchTypedQueryMode("> ").mode.kind, "actions");
  assert.equal(matchTypedQueryMode(">").mode.kind, "actions");
  assert.equal(matchTypedQueryMode("weather ").mode.kind, "weather");
  assert.equal(matchTypedQueryMode("define ").mode.kind, "dictionary");
  assert.equal(matchTypedQueryMode("clip invoice").query, "invoice");
});

// Promoting before the separator arrives would eat the rest of "clipping".
test("a bare keyword is not promoted", () => {
  assert.equal(matchTypedQueryMode("clip"), null);
  assert.equal(matchTypedQueryMode("clipping"), null);
  assert.equal(matchTypedQueryMode("weather"), null);
  assert.equal(matchTypedQueryMode("define"), null);
});

test("promotion skips modes switched off in preferences", () => {
  assert.equal(
    matchTypedQueryMode("clip ", (key) => key !== "clipboard-search-enabled"),
    null,
  );
});

test("weather reads a location off any of its keywords", () => {
  assert.equal(parseWeatherQuery("weather Amsterdam"), "Amsterdam");
  assert.equal(parseWeatherQuery("forecast New York"), "New York");
  assert.equal(parseWeatherQuery("temp Berlin"), "Berlin");
  assert.equal(parseWeatherQuery("  weather   Oslo  "), "Oslo");
});

test("weather accepts its keyword with no location yet", () => {
  assert.equal(parseWeatherQuery("weather "), "");
  assert.equal(parseWeatherQuery("weather:"), "");
});

// Accepting the bare keyword would cost the Weather app its own name in search.
test("weather alone stays a plain search", () => {
  assert.equal(parseWeatherQuery("weather"), null);
  assert.equal(parseWeatherQuery("  weather  "), null);
  assert.equal(parseWeatherQuery("weatherstation"), null);
  assert.equal(parseWeatherQuery("firefox"), null);
});

test("dictionary parses the same way weather does", () => {
  assert.equal(parseDictionaryQuery("define serendipity"), "serendipity");
  assert.equal(parseDictionaryQuery("def cromulent"), "cromulent");
  assert.equal(parseDictionaryQuery("define "), "");
  assert.equal(parseDictionaryQuery("define"), null);
  assert.equal(parseDictionaryQuery("definition"), null);
});

test("the weather and dictionary prefixes parse as their own mode", () => {
  const parsers = {
    weather: parseWeatherQuery,
    dictionary: parseDictionaryQuery,
  };

  for (const mode of QUERY_MODE_CYCLE) {
    if (!parsers[mode.kind]) continue;
    assert.equal(parsers[mode.kind](mode.prefix), "");
    assert.equal(parsers[mode.kind](`${mode.prefix}Lisbon`), "Lisbon");
  }
});

test("every spelling of a prefix is stripped", () => {
  for (const text of [
    "clipboard note",
    "clip note",
    "history note",
    "clipboard:note",
    "> note",
    ">note",
    "cmd note",
    "command note",
    "action:note",
    "weather note",
    "define note",
    "def note",
  ]) {
    assert.equal(stripQueryModePrefix(text), "note", text);
  }
});

test("a query carrying no prefix is left alone", () => {
  assert.equal(stripQueryModePrefix("  firefox  "), "firefox");
  assert.equal(stripQueryModePrefix("clipping"), "clipping");
});

// If a prefix stopped matching the pattern the classifier uses, Tab would land
// the bar in a mode it could not see it was in.
test("the prefix written for a mode is one that mode's pattern matches", () => {
  const patterns = {
    clipboard: CLIPBOARD_QUERY_PATTERN,
    actions: ACTION_SYMBOL_PATTERN,
    weather: WEATHER_PREFIX_PATTERN,
    dictionary: DICTIONARY_PREFIX_PATTERN,
  };

  for (const mode of QUERY_MODE_CYCLE) {
    if (mode.kind === "generic") continue;

    const match = `${mode.prefix}note`.match(patterns[mode.kind]);
    assert.ok(match, `${mode.kind} prefix does not classify as ${mode.kind}`);
    assert.equal((match[1] ?? "").trim(), "note");
  }
});

test("a prefix with no argument still names its mode", () => {
  for (const mode of QUERY_MODE_CYCLE) {
    if (mode.kind === "generic") continue;
    assert.equal(matchTypedQueryMode(mode.prefix).mode.kind, mode.kind);
  }
});
