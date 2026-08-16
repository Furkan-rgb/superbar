// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

// Preferences tests that need a real GTK stack. The node suite covers the pure
// logic in keybinding-conflicts.js; everything here is behaviour that only
// exists once the widgets are built — key propagation, the accelerator parser,
// and reading and writing the system shortcut schemas.
//
// Run through `make unit-gtk`, which points XDG_CONFIG_HOME at a throwaway
// directory inside a private D-Bus session. The conflict tests write to
// org.gnome.desktop.wm.keybindings and the media-keys schemas, so running this
// against a live session would rewrite the user's own shortcuts.

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";
import System from "system";

const SHELL_RESOURCE =
  "/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource";

// ExtensionPreferences lives in GNOME Shell's gresource rather than on disk.
Gio.resources_register(Gio.Resource.load(SHELL_RESOURCE));

Gtk.init();
Adw.init();

// The compiled schema is built into a scratch directory by the Makefile so the
// working tree stays clean; prefs.js itself is imported from the source tree.
const EXTENSION_DIR = GLib.getenv("SUPERBAR_TEST_EXTENSION_DIR");
const SOURCE_DIR = GLib.path_get_dirname(
  GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]),
);

const prefsModule = await import(`file://${SOURCE_DIR}/prefs.js`);

const prefs = new prefsModule.default({
  uuid: "superbar@Furkan-rgb.github.io",
  dir: Gio.File.new_for_path(EXTENSION_DIR),
  path: EXTENSION_DIR,
  "settings-schema": "org.gnome.shell.extensions.superbar",
  name: "Superbar",
});

const window = new Adw.PreferencesWindow();
await prefs.fillPreferencesWindow(window);
// Presented on purpose: a surface only gets keyboard focus, and only then a
// granted shortcut inhibitor, once it is actually on screen.
window.present();

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    print(`ok ${++passed + failed} - ${name}`);
  } else {
    failed++;
    print(`not ok ${passed + failed} - ${name}`);
    if (detail) print(`  # ${detail}`);
  }
}

function findRow(widget, typeName) {
  if (!widget) return null;
  if (widget.constructor?.$gtype?.name === typeName) return widget;

  for (
    let child = widget.get_first_child?.();
    child;
    child = child.get_next_sibling()
  ) {
    const found = findRow(child, typeName);
    if (found) return found;
  }

  return null;
}

// GTK assigns the initial focus and maps surfaces from the main loop, so state
// that a real window would settle into needs the loop pumped first.
function settle(iterations = 200) {
  const context = GLib.MainContext.default();
  for (let i = 0; i < iterations; i++) context.iteration(false);
}

// Focus and the compositor's answer to an inhibit request both arrive as
// events, so waiting on a condition beats guessing an iteration count.
function waitFor(predicate, iterations = 600) {
  const context = GLib.MainContext.default();
  for (let i = 0; i < iterations && !predicate(); i++) context.iteration(true);
  return predicate();
}

// ── The toolkit-free matcher against the real parser ────────────────────────

// isSameAccel is hand-written so the Shell process, which has no GTK, compares
// accelerators exactly as preferences does. That only holds while it agrees
// with Gtk.accelerator_parse, so check it against every accelerator GNOME
// actually ships rather than against a handful of examples.
{
  const { isSameAccel, parseAccel } = await import(
    `file://${SOURCE_DIR}/keybinding-conflicts.js`
  );
  const { collectSystemKeybindings } = await import(
    `file://${SOURCE_DIR}/keybinding-settings.js`
  );

  const gtkParse = (accel) => {
    try {
      const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
      return ok && keyval ? `${keyval}/${mods}` : null;
    } catch (_e) {
      return null;
    }
  };
  const gtkSame = (a, b) => {
    const left = gtkParse(a);
    const right = gtkParse(b);
    return left === null || right === null ? a === b : left === right;
  };

  const accels = [
    ...new Set(collectSystemKeybindings().flatMap((binding) => binding.accels)),
  ];
  const disagreements = [];
  for (const a of accels) {
    for (const b of accels) {
      if (isSameAccel(a, b) !== gtkSame(a, b)) disagreements.push(`${a} vs ${b}`);
    }
  }

  check(
    `the shared matcher agrees with GTK on all ${accels.length} shipped accelerators`,
    disagreements.length === 0,
    disagreements.slice(0, 5).join(", "),
  );

  // Every shipped accelerator should also survive being described and parsed,
  // since the dialog the extension shows renders one.
  const unparseable = accels.filter(
    (accel) => gtkParse(accel) !== null && parseAccel(accel) === null,
  );
  check(
    "every accelerator GTK parses is parsed by the shared parser too",
    unparseable.length === 0,
    unparseable.slice(0, 5).join(", "),
  );

  // Comparing the shipped accelerators only against each other misses the case
  // that actually bites: preferences stores what Gtk.accelerator_name produces,
  // which can be spelled differently from what GNOME ships. GNOME's
  // "<Ctrl><Shift><Alt>R" is written back as "<Shift><Control><Alt>r".
  const roundTripFailures = [];
  for (const accel of accels) {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    if (!ok || !keyval) continue;

    const canonical = Gtk.accelerator_name(keyval, mods);
    if (!isSameAccel(accel, canonical))
      roundTripFailures.push(`${accel} != ${canonical}`);
  }
  check(
    "each shipped accelerator matches its own GTK spelling",
    roundTripFailures.length === 0,
    roundTripFailures.slice(0, 5).join(", "),
  );
}

const keybindingRow = findRow(window, "SuperbarKeybindingRow");
const replacedRow = findRow(window, "SuperbarReplacedShortcutsRow");
check("the shortcut row is built into the window", keybindingRow !== null);
check("the restore row is built into the window", replacedRow !== null);

const settings = prefs.getSettings();

// ── The capture dialog ──────────────────────────────────────────────────────

keybindingRow._startCapture();
const dialog = Gtk.Window.list_toplevels().find(
  (toplevel) => toplevel.title === "New Shortcut",
);
check("pressing edit opens the capture dialog", dialog !== undefined);

if (dialog) {
  settle();

  // A focused button turns Space and Enter into a click, so they never reach
  // the handler and the dialog cancels itself instead of capturing.
  const focus = dialog.get_focus();
  check(
    "nothing activatable holds focus while capturing",
    !(focus instanceof Gtk.Button),
    `focus is ${focus?.constructor.$gtype.name ?? "none"}`,
  );

  // A bubble-phase controller only runs after the focused widget has declined
  // the key, which is too late for keys a widget handles itself.
  const controllers = dialog.observe_controllers();
  const phases = [];
  for (let i = 0; i < controllers.get_n_items(); i++) {
    const controller = controllers.get_item(i);
    if (controller instanceof Gtk.EventControllerKey)
      phases.push(controller.get_propagation_phase());
  }
  check(
    "the key handler runs in the capture phase",
    phases.length > 0 &&
      phases.every((phase) => phase === Gtk.PropagationPhase.CAPTURE),
    `phases were ${JSON.stringify(phases)}`,
  );

  // Without this the compositor acts on its own shortcuts instead of passing
  // them through, and the combinations most likely to conflict are the ones
  // that can never be pressed here. Asking is not enough — the compositor
  // grants the inhibitor only once the surface holds keyboard focus, so assert
  // on what was granted rather than on what was requested.
  check(
    "the dialog asks for system shortcuts to be inhibited",
    Boolean(keybindingRow._inhibitedSurface),
  );
  waitFor(() => dialog.is_active);
  const granted = waitFor(
    () => dialog.get_surface()?.shortcuts_inhibited === true,
  );
  check(
    "the compositor grants the inhibit, so Alt+Space reaches the dialog",
    granted,
    "the compositor kept its own shortcuts; conflicting combinations cannot be pressed here",
  );

  dialog.destroy();
  settle();
  check(
    "system shortcuts are released when the dialog closes",
    keybindingRow._inhibitedSurface === null,
  );
}

// ── Conflict detection against the real schemas ─────────────────────────────

const wm = new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings" });
wm.set_strv("activate-window-menu", ["<Alt>space"]);
Gio.Settings.sync();

function setShortcut(accel) {
  settings.set_strv("toggle-shortcut", [accel]);
  keybindingRow.syncState();
}

setShortcut("<Alt>space");
check(
  "the default shortcut is flagged against the window menu",
  keybindingRow._conflictIcon.visible === true,
);

setShortcut("<Control><Alt><Super>k");
check(
  "an unused combination is not flagged",
  keybindingRow._conflictIcon.visible === false,
);

setShortcut("<alt>space");
check(
  "a differently spelled modifier still matches",
  keybindingRow._conflictIcon.visible === true,
);

// ── Replacing and restoring a system shortcut ───────────────────────────────

const windowMenuConflict = {
  schemaId: "org.gnome.desktop.wm.keybindings",
  label: "Windows",
  key: "activate-window-menu",
  summary: "Activate the window menu",
  type: "as",
  accels: ["<Alt>space"],
  values: ["<Alt>space"],
};

keybindingRow._replaceConflicts("<Alt>space", [windowMenuConflict]);
Gio.Settings.sync();

check(
  "replacing clears the conflicting system shortcut",
  wm.get_strv("activate-window-menu").length === 0,
  `value is ${JSON.stringify(wm.get_strv("activate-window-menu"))}`,
);
check(
  "the cleared shortcut is recorded so it can come back",
  settings.get_string("replaced-keybindings").includes("activate-window-menu"),
);
check(
  "the warning clears once the conflict is gone",
  keybindingRow._conflictIcon.visible === false,
);
replacedRow.sync();
check("the restore row appears", replacedRow.visible === true);

replacedRow._restore();
Gio.Settings.sync();
check(
  "restoring puts the original accelerator back",
  JSON.stringify(wm.get_strv("activate-window-menu")) ===
    JSON.stringify(["<Alt>space"]),
  `value is ${JSON.stringify(wm.get_strv("activate-window-menu"))}`,
);
check(
  "restoring empties the record",
  settings.get_string("replaced-keybindings") === "",
);
check("the restore row hides again", replacedRow.visible === false);
check(
  "the warning returns once the conflict is back",
  keybindingRow._conflictIcon.visible === true,
);

// ── Custom shortcuts, which live in a relocatable schema ────────────────────

const CUSTOM_PATH =
  "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/superbar-test/";

const mediaKeys = new Gio.Settings({
  schema_id: "org.gnome.settings-daemon.plugins.media-keys",
});
mediaKeys.set_strv("custom-keybindings", [CUSTOM_PATH]);

const custom = new Gio.Settings({
  settings_schema: Gio.SettingsSchemaSource.get_default().lookup(
    "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding",
    true,
  ),
  path: CUSTOM_PATH,
});
custom.set_string("name", "My Launcher");
custom.set_string("binding", "<Super>e");
Gio.Settings.sync();

setShortcut("<Super>e");
check(
  "a user's own custom shortcut is detected",
  keybindingRow._conflictIcon.visible === true,
);
check(
  "the custom shortcut is named in the warning",
  keybindingRow._conflictIcon.tooltip_text.includes("My Launcher"),
  keybindingRow._conflictIcon.tooltip_text,
);

// Custom shortcuts store one accelerator as a string, not a list, so clearing
// and restoring them takes a different path than the system schemas.
keybindingRow._replaceConflicts("<Super>e", [
  {
    schemaId: "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding",
    path: CUSTOM_PATH,
    label: "Custom Shortcut",
    key: "binding",
    summary: "My Launcher",
    type: "s",
    accels: ["<Super>e"],
    values: ["<Super>e"],
  },
]);
Gio.Settings.sync();
check(
  "replacing clears a custom shortcut",
  custom.get_string("binding") === "",
  `value is ${JSON.stringify(custom.get_string("binding"))}`,
);

replacedRow._restore();
Gio.Settings.sync();
check(
  "restoring puts a custom shortcut back",
  custom.get_string("binding") === "<Super>e",
  `value is ${JSON.stringify(custom.get_string("binding"))}`,
);

print(`1..${passed + failed}`);
print(`# pass ${passed}`);
print(`# fail ${failed}`);
System.exit(failed > 0 ? 1 : 0);
