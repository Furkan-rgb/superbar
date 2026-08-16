// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

// Query mode prefixes, shared with the classifier in extension.js: every
// prefix the Tab cycle writes has to be one the classifier reads back as the
// same mode.

export const CLIPBOARD_QUERY_PATTERN =
  /^(?:clipboard|clip|history)(?:(?::|\s+)(.*))?$/i;
export const ACTION_SYMBOL_PATTERN = /^>\s*(.*)$/;
export const ACTION_WORD_PATTERN =
  /^(?:command|cmd|action)(?:(?::|\s+)(.*))?$/i;
export const WEATHER_QUERY_PATTERN =
  /^(?:weather|temp(?:erature)?|forecast|humidity|rain|snow|wind|hot|cold|clima|meteo)\s+(.+)$/i;
export const DICTIONARY_QUERY_PATTERN = /^def(?:ine)?\s+(.+)$/i;

// A bare "weather" has to stay a plain search so the Weather app keeps its own
// name; the separator is what marks a mode as chosen but not yet filled in.
export const WEATHER_PREFIX_PATTERN = /^weather(?::|\s+)(.*)$/i;
export const DICTIONARY_PREFIX_PATTERN = /^def(?:ine)?(?::|\s+)(.*)$/i;

// Currency and the calculator are missing on purpose: neither has a keyword to
// put in the chip.
export const QUERY_MODE_CYCLE = [
  { kind: "generic", prefix: "", hint: "Search", settingKey: null, pattern: null },
  {
    kind: "clipboard",
    prefix: "clip ",
    hint: "Search clipboard history",
    settingKey: "clipboard-search-enabled",
    pattern: /^(?:clipboard|clip|history)(?::|\s+)(.*)$/i,
  },
  {
    kind: "actions",
    prefix: "> ",
    hint: "Search system actions",
    settingKey: "system-actions-search-enabled",
    pattern: /^(?:>\s*|(?:command|cmd|action)(?::|\s+))(.*)$/i,
  },
  {
    kind: "weather",
    prefix: "weather ",
    hint: "e.g. Amsterdam",
    settingKey: "weather-search-enabled",
    pattern: WEATHER_PREFIX_PATTERN,
  },
  {
    kind: "dictionary",
    prefix: "define ",
    hint: "e.g. serendipity",
    settingKey: "dictionary-search-enabled",
    pattern: DICTIONARY_PREFIX_PATTERN,
  },
];

export function parseWeatherQuery(text) {
  const match = text.trim().match(WEATHER_QUERY_PATTERN);
  if (match) return match[1].trim();
  return WEATHER_PREFIX_PATTERN.test(text) ? "" : null;
}

export function parseDictionaryQuery(text) {
  const match = text.trim().match(DICTIONARY_QUERY_PATTERN);
  if (match) return match[1].trim();
  return DICTIONARY_PREFIX_PATTERN.test(text) ? "" : null;
}

export function getQueryModeByPrefix(prefix) {
  return (
    QUERY_MODE_CYCLE.find((mode) => mode.prefix === prefix) ??
    QUERY_MODE_CYCLE[0]
  );
}

export function getQueryModeCycle(isModeEnabled = () => true) {
  return QUERY_MODE_CYCLE.filter(
    (mode) => mode.settingKey === null || isModeEnabled(mode.settingKey),
  );
}

export function getQueryModeToken(prefix) {
  return prefix.trim();
}

// A separator is required: promoting on a bare "clip" would turn the rest of
// "clipping" into the query.
export function matchTypedQueryMode(text, isModeEnabled = () => true) {
  for (const mode of getQueryModeCycle(isModeEnabled)) {
    if (mode.pattern === null) continue;

    const match = text.match(mode.pattern);
    if (match) return { mode, query: match[1] ?? "" };
  }
  return null;
}

export function stripQueryModePrefix(text) {
  const normalized = text.trim();

  const clipboardMatch = normalized.match(CLIPBOARD_QUERY_PATTERN);
  if (clipboardMatch) return (clipboardMatch[1] ?? "").trim();

  const symbolMatch = normalized.match(ACTION_SYMBOL_PATTERN);
  if (symbolMatch) return symbolMatch[1].trim();

  const wordMatch = normalized.match(ACTION_WORD_PATTERN);
  if (wordMatch) return (wordMatch[1] ?? "").trim();

  const typed = matchTypedQueryMode(normalized);
  if (typed) return typed.query.trim();

  return normalized;
}

export function cycleQueryMode({
  text,
  kind,
  direction = 1,
  isModeEnabled = () => true,
}) {
  const cycle = getQueryModeCycle(isModeEnabled);
  if (cycle.length < 2) return null;

  // findIndex returns -1 for a kind the cycle has no prefix for — a sum, a
  // conversion — which is already the generic mode at index 0.
  const currentIndex = Math.max(
    0,
    cycle.findIndex((mode) => mode.kind === kind),
  );
  const step = direction < 0 ? -1 : 1;
  const next = cycle[(currentIndex + step + cycle.length) % cycle.length];

  return {
    kind: next.kind,
    prefix: next.prefix,
    query: stripQueryModePrefix(text),
  };
}
