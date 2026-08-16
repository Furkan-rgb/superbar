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

// Accelerator comparison is delegated so this module stays free of GTK: the
// caller passes a matcher backed by Gtk.accelerator_parse, which makes
// "<Alt>space" and "<alt>Space" compare equal.
export function findAccelConflicts(accel, bindings, isSameAccel) {
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
