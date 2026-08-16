// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

// Reading and rewriting GNOME's own shortcut settings. Split from prefs.js so
// the extension can run the same conflict scan the preferences window does:
// this file uses nothing but Gio, which both the Shell process and the
// preferences process have.

import Gio from "gi://Gio";

import {
  CONFLICT_SOURCES,
  CUSTOM_KEYBINDING_SCHEMA_ID,
  MEDIA_KEYS_SCHEMA_ID,
  decodeReplacedBindings,
  encodeReplacedBindings,
  findAccelConflicts,
  mergeReplacedBindings,
} from "./keybinding-conflicts.js";

const REPLACED_KEYBINDINGS_KEY = "replaced-keybindings";

function lookupSchema(schemaId) {
  return Gio.SettingsSchemaSource.get_default().lookup(schemaId, true);
}

function settingsForSchema(schemaId, path = null) {
  const schema = lookupSchema(schemaId);
  if (!schema) return null;

  try {
    return new Gio.Settings(
      path ? { settings_schema: schema, path } : { settings_schema: schema },
    );
  } catch (_e) {
    return null;
  }
}

// User-defined shortcuts live in a relocatable schema, one instance per path
// listed in the media-keys settings, and store a single accelerator string
// rather than a list.
function collectCustomKeybindings() {
  const mediaKeys = settingsForSchema(MEDIA_KEYS_SCHEMA_ID);
  const customSchema = lookupSchema(CUSTOM_KEYBINDING_SCHEMA_ID);
  if (!mediaKeys || !customSchema) return [];
  if (!mediaKeys.settings_schema.has_key("custom-keybindings")) return [];

  const bindings = [];

  for (const path of mediaKeys.get_strv("custom-keybindings")) {
    const custom = settingsForSchema(CUSTOM_KEYBINDING_SCHEMA_ID, path);
    if (!custom) continue;

    const accel = custom.get_string("binding");
    if (!accel) continue;

    bindings.push({
      schemaId: CUSTOM_KEYBINDING_SCHEMA_ID,
      path,
      label: "Custom Shortcut",
      key: "binding",
      summary: custom.get_string("name") || "Custom shortcut",
      type: "s",
      accels: [accel],
      values: [accel],
    });
  }

  return bindings;
}

// `accels` is what conflict matching narrows down; `values` keeps the full
// original list so that clearing one accelerator leaves the others in place.
export function collectSystemKeybindings() {
  const bindings = [];

  for (const { schemaId, label } of CONFLICT_SOURCES) {
    const settings = settingsForSchema(schemaId);
    if (!settings) continue;

    const schema = settings.settings_schema;

    for (const key of schema.list_keys()) {
      const value = settings.get_value(key);
      // Only string lists hold accelerators; everything else in these schemas
      // is unrelated configuration.
      if (value.get_type_string() !== "as") continue;

      const accels = value.get_strv().filter((accel) => accel);
      if (accels.length === 0) continue;

      // key came from this same schema's list_keys(), so the lookup holds.
      const summary = schema.get_key(key).get_summary() || key;

      bindings.push({
        schemaId,
        label,
        key,
        summary,
        type: "as",
        accels,
        values: accels,
      });
    }
  }

  return [...bindings, ...collectCustomKeybindings()];
}

export function findConflictsFor(accel) {
  if (!accel) return [];

  return findAccelConflicts(accel, collectSystemKeybindings());
}

// A key an administrator has locked down reports failure by returning false
// rather than raising, so the result has to be read either way.
function writeBindingValue(settings, key, type, value) {
  try {
    return type === "s"
      ? settings.set_string(key, value ?? "")
      : settings.set_strv(key, value ?? []);
  } catch (_e) {
    // The key is no longer in the schema — GNOME renamed or dropped it.
    return false;
  }
}

function clearConflictingBinding(binding) {
  const settings = settingsForSchema(binding.schemaId, binding.path ?? null);
  if (!settings) return null;

  const cleared =
    binding.type === "s"
      ? ""
      : binding.values.filter((accel) => !binding.accels.includes(accel));

  // Recording a shortcut that was not actually cleared would offer a restore
  // that undoes nothing while the conflict quietly remains.
  if (!writeBindingValue(settings, binding.key, binding.type, cleared))
    return null;

  const record = {
    schemaId: binding.schemaId,
    key: binding.key,
    label: binding.label,
    summary: binding.summary,
    type: binding.type,
    value: binding.type === "s" ? binding.values[0] : binding.values,
  };
  if (binding.path) record.path = binding.path;

  return record;
}

function restoreReplacedBinding(record) {
  const settings = settingsForSchema(record.schemaId, record.path ?? null);
  if (!settings) return false;

  return writeBindingValue(settings, record.key, record.type, record.value);
}

export function readReplacedBindings(settings) {
  return decodeReplacedBindings(settings.get_string(REPLACED_KEYBINDINGS_KEY));
}

function writeReplacedBindings(settings, records) {
  settings.set_string(
    REPLACED_KEYBINDINGS_KEY,
    encodeReplacedBindings(records),
  );
}

// Clears the given conflicts and records what was cleared on the extension's
// own settings, so they can be put back. Shared by the preferences dialog and
// the dialog the extension shows at startup: whichever route the user takes,
// the same thing is written down.
export function replaceConflicts(settings, conflicts) {
  const records = (conflicts ?? [])
    .map((conflict) => clearConflictingBinding(conflict))
    .filter((record) => record !== null);

  writeReplacedBindings(
    settings,
    mergeReplacedBindings(readReplacedBindings(settings), records),
  );

  return records;
}

// Puts every recorded shortcut back. Records that could not be written are
// kept, so a restore that fails part way can be tried again instead of
// forgetting the shortcuts it never actually restored.
export function restoreReplacedBindings(settings) {
  const records = readReplacedBindings(settings);
  const failed = records.filter((record) => !restoreReplacedBinding(record));

  writeReplacedBindings(settings, failed);

  return { restored: records.length - failed.length, failed };
}
