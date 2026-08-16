// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

// GSettings schemas that hold GNOME's own global shortcuts. Everything a user
// can rebind from Settings lives in one of these, so together they cover the
// conflicts we are able to see. Shortcuts owned by other extensions live in
// private schemas we cannot enumerate, and applications that grab a key
// directly are invisible from here, so an empty result is not a promise that
// the combination is free.
export const CONFLICT_SOURCES = [
  { schemaId: "org.gnome.desktop.wm.keybindings", label: "Windows" },
  { schemaId: "org.gnome.shell.keybindings", label: "GNOME Shell" },
  { schemaId: "org.gnome.mutter.keybindings", label: "Mutter" },
  {
    schemaId: "org.gnome.mutter.wayland.keybindings",
    label: "Mutter (Wayland)",
  },
  {
    schemaId: "org.gnome.settings-daemon.plugins.media-keys",
    label: "System",
  },
];

export const MEDIA_KEYS_SCHEMA_ID =
  "org.gnome.settings-daemon.plugins.media-keys";

export const CUSTOM_KEYBINDING_SCHEMA_ID =
  "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";

// Control is the only modifier GDK spells more than one way. Meta, Super, and
// Hyper are modifiers in their own right, not aliases for Alt.
const MODIFIER_ALIASES = new Map([
  ["primary", "control"],
  ["ctrl", "control"],
]);

// Conventional reading order rather than the alphabetical order used for
// comparison, so a described shortcut looks like the one on the keycaps.
const MODIFIER_LABELS = [
  ["control", "Ctrl"],
  ["alt", "Alt"],
  ["shift", "Shift"],
  ["super", "Super"],
  ["meta", "Meta"],
  ["hyper", "Hyper"],
];

// The key half cannot contain angle brackets, which is what stops a bare
// "<Alt>" from parsing as a modifier-less key named "<Alt>". GDK spells the
// bracket keys "less" and "greater", so nothing legitimate is excluded.
const ACCEL_PATTERN = /^((?:<[^<>]+>)*)([^<>]+)$/;

// X11 keysyms that have two names for one key. GDK resolves these through its
// keysym table, which the Shell process has no access to, so the pairs GNOME
// actually ships are spelled out. Everything else compares by name.
const KEY_ALIASES = new Map([
  ["prior", "Page_Up"],
  ["page_up", "Page_Up"],
  ["next", "Page_Down"],
  ["page_down", "Page_Down"],
  ["kp_prior", "KP_Page_Up"],
  ["kp_page_up", "KP_Page_Up"],
  ["kp_next", "KP_Page_Down"],
  ["kp_page_down", "KP_Page_Down"],
]);

// Gtk.accelerator_parse ends in gdk_keyval_to_lower(), so a letter key means
// the same combination whichever case it was written in: GNOME ships
// "<Ctrl><Shift><Alt>R" for the screen recorder, while a shortcut captured in
// preferences is written back as "<Shift><Control><Alt>r". Comparing those as
// different text is how a real conflict goes unreported. Named keysyms are not
// folded — "space" is a key, "Space" is not one at all.
function normalizeKeyName(key) {
  if (/^[A-Za-z]$/.test(key)) return key.toLowerCase();

  // GDK accepts "XF86AudioPlay" but prints "AudioPlay"; both are the same key.
  const stripped = key.startsWith("XF86") ? key.slice(4) : key;

  return KEY_ALIASES.get(stripped.toLowerCase()) ?? stripped;
}

// Follows Gtk.accelerator_parse without the keysym lookup: modifier names are
// case-insensitive, and so are single-letter keys. Deliberately toolkit-free —
// the Shell process has no GTK, and comparing accelerators differently there
// than in preferences is how a shortcut ends up looking clean in one place and
// conflicting in the other.
export function parseAccel(accel) {
  if (!accel) return null;

  const match = ACCEL_PATTERN.exec(accel);
  if (!match) return null;

  const [, modifiers, key] = match;
  const names = (modifiers.match(/<[^<>]+>/g) ?? []).map((modifier) => {
    const name = modifier.slice(1, -1).toLowerCase();
    return MODIFIER_ALIASES.get(name) ?? name;
  });

  return { modifiers: [...new Set(names)].sort(), key: normalizeKeyName(key) };
}

// Values that are not accelerators at all — media keys are stored as bare names
// like "XF86Keyboard" — compare as plain strings.
export function isSameAccel(a, b) {
  const left = parseAccel(a);
  const right = parseAccel(b);
  if (!left || !right) return a === b;

  return (
    left.key === right.key &&
    left.modifiers.length === right.modifiers.length &&
    left.modifiers.every((name, i) => name === right.modifiers[i])
  );
}

// GSettings stores "<Alt>space"; people read "Alt+Space". The key is taken from
// the text as written rather than from parseAccel, whose normalising exists to
// make two spellings compare equal and would otherwise rename keys on screen.
export function describeAccel(accel) {
  const parsed = parseAccel(accel);
  if (!parsed) return accel ?? "";

  const [, , rawKey] = ACCEL_PATTERN.exec(accel);

  const named = new Set(parsed.modifiers);
  const parts = MODIFIER_LABELS.filter(([name]) => named.delete(name)).map(
    ([, label]) => label,
  );
  // Anything GDK accepts that is not in the table above still gets shown.
  for (const name of named) parts.push(name);

  parts.push(rawKey.charAt(0).toUpperCase() + rawKey.slice(1));

  return parts.join("+");
}

export function findAccelConflicts(accel, bindings) {
  if (!accel) return [];

  const conflicts = [];

  for (const binding of bindings ?? []) {
    const matched = (binding.accels ?? []).filter(
      (candidate) => candidate && isSameAccel(candidate, accel),
    );
    if (matched.length > 0) conflicts.push({ ...binding, accels: matched });
  }

  return conflicts;
}

export function formatConflict(conflict) {
  const name = conflict.summary || conflict.key;

  return conflict.label ? `${name} (${conflict.label})` : name;
}

export function formatConflictSummary(conflicts) {
  if (!conflicts || conflicts.length === 0) return "";

  const [first] = conflicts;
  const others = conflicts.length - 1;
  if (others === 0) return `Also used by ${formatConflict(first)}`;

  return `Also used by ${formatConflict(first)} and ${others} other shortcut${
    others === 1 ? "" : "s"
  }`;
}

// GNOME refuses unmodified shortcuts because grabbing a bare key takes it away
// from every application. Function keys are the conventional exception.
export function describeAccelRejection({ valid, hasModifier, functionKey }) {
  if (!valid) return "That key combination cannot be used as a shortcut.";

  if (!hasModifier && !functionKey) {
    return (
      "Add a modifier such as Ctrl, Alt, or Super. A key on its own would " +
      "stop working everywhere else."
    );
  }

  return null;
}

function replacedBindingId(record) {
  return [record.schemaId, record.path ?? "", record.key].join("\n");
}

export function decodeReplacedBindings(payload) {
  if (!payload) return [];

  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (_e) {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (record) =>
      record &&
      typeof record.schemaId === "string" &&
      typeof record.key === "string",
  );
}

export function encodeReplacedBindings(records) {
  if (!records || records.length === 0) return "";

  return JSON.stringify(records);
}

// Keeps the earliest record for a binding: replacing the same shortcut twice
// must still restore the value the user originally had, not the empty value
// left behind by the first replacement.
export function mergeReplacedBindings(existing, added) {
  const merged = [...(existing ?? [])];
  const seen = new Set(merged.map(replacedBindingId));

  for (const record of added ?? []) {
    const id = replacedBindingId(record);
    if (seen.has(id)) continue;

    seen.add(id);
    merged.push(record);
  }

  return merged;
}
