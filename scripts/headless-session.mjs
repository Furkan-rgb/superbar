// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

/* A throwaway GNOME Shell for scripts that need the real extension running.
 *
 * Superbar is installed with the development driver into a headless Shell on
 * its own bus, HOME and runtime dir, so nothing touches the session running
 * the script. Both the showcase renderer and the input smoke test drive a
 * Shell this way; keeping one copy here is what stops the two setups drifting
 * apart the way the old HTML render replica did.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

const SUPERBAR_UUID = "superbar@Furkan-rgb.github.io";
const DRIVER_UUID = "render-driver@superbar.local";
const DRIVER_BUS = "org.superbar.RenderDriver";
const DRIVER_PATH = "/org/superbar/RenderDriver";
const SCHEMA_ID = "org.gnome.shell.extensions.superbar";

const EXTENSION_SOURCES = [
  "metadata.json",
  "stylesheet.css",
  "extension.js",
  "prefs.js",
  "LICENSE",
  "appearance.js",
  "app-search.js",
  "search-provider-config.js",
  "gnome-search-providers.js",
  "search-engines.js",
  "result-selection.js",
  "query-modes.js",
  "keybinding-conflicts.js",
  "keybinding-settings.js",
];

// driver has claimed its bus name; on a cold cache that is a good few seconds.
const STARTUP_TIMEOUT_MS = 60_000;

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export class HeadlessSession {
  constructor(options) {
    this.options = options;
    this.sessionDirectory = null;
    this.busPid = null;
    this.shell = null;
    this.environment = null;
    this.extensionDirectory = null;
  }

  /* The Wayland socket lives in XDG_RUNTIME_DIR and its full path has to fit
   * in 108 bytes, so the session directory is created directly under /tmp
   * rather than anywhere nested. */
  _createDirectories() {
    this.sessionDirectory = mkdtempSync("/tmp/superbar-render-");
    const home = join(this.sessionDirectory, "home");
    const runtime = join(this.sessionDirectory, "run");
    const dataHome = join(home, ".local", "share");

    this.extensionDirectory = join(
      dataHome,
      "gnome-shell",
      "extensions",
      SUPERBAR_UUID,
    );

    for (const directory of [
      home,
      runtime,
      dataHome,
      join(home, ".config"),
      join(home, ".cache"),
      this.extensionDirectory,
      join(this.extensionDirectory, "schemas"),
      join(dataHome, "gnome-shell", "extensions", DRIVER_UUID),
    ]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }

    this.environment = {
      ...process.env,
      HOME: home,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: dataHome,
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      // Inherited session hints confuse a Shell that is starting its own.
      XDG_SESSION_TYPE: "wayland",
      GNOME_SHELL_SESSION_MODE: "user",
    };
    // The driver turns on unsafe mode when it sees this, which is what makes
    // org.gnome.Shell.Eval answer. Only the smoke test needs it: it has to
    // reach into the extension to inject input and read back what happened.
    if (this.options.unsafe) this.environment.SUPERBAR_RENDER_UNSAFE = "1";
    delete this.environment.WAYLAND_DISPLAY;
    delete this.environment.DISPLAY;
    delete this.environment.DBUS_SESSION_BUS_ADDRESS;
  }

  _installExtensions() {
    for (const source of EXTENSION_SOURCES) {
      const from = join(repositoryRoot, source);
      if (!existsSync(from)) throw new Error(`Missing extension source: ${source}`);
      copyFileSync(from, join(this.extensionDirectory, source));
    }

    const schemaFile = "org.gnome.shell.extensions.superbar.gschema.xml";
    copyFileSync(
      join(repositoryRoot, "schemas", schemaFile),
      join(this.extensionDirectory, "schemas", schemaFile),
    );
    execFileSync("glib-compile-schemas", [join(this.extensionDirectory, "schemas")]);

    const driverSource = join(repositoryRoot, "showcase", DRIVER_UUID);
    const driverTarget = join(
      this.environment.XDG_DATA_HOME,
      "gnome-shell",
      "extensions",
      DRIVER_UUID,
    );
    for (const file of ["metadata.json", "extension.js"]) {
      copyFileSync(join(driverSource, file), join(driverTarget, file));
    }
  }

  _startBus() {
    const output = execFileSync(
      "dbus-daemon",
      ["--session", "--fork", "--print-address", "--print-pid"],
      { encoding: "utf8", env: this.environment },
    );

    const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
    const address = lines.find((line) => line.includes("="));
    const pid = lines.find((line) => /^\d+$/.test(line));
    if (!address || !pid) throw new Error(`Unexpected dbus-daemon output: ${output}`);

    this.busPid = Number(pid);
    this.environment.DBUS_SESSION_BUS_ADDRESS = address;
  }

  gsettings(args) {
    execFileSync("gsettings", args, { env: this.environment, encoding: "utf8" });
  }

  setExtensionSetting(key, value) {
    this.gsettings([
      "--schemadir",
      join(this.extensionDirectory, "schemas"),
      "set",
      SCHEMA_ID,
      key,
      String(value),
    ]);
  }

  /* The conflict-prompt key has changed name and type before now, so the
   * suppression below asks the schema what it actually offers rather than
   * hard-coding a key that may have moved. */
  extensionSettingKeys() {
    const output = execFileSync(
      "gsettings",
      ["--schemadir", join(this.extensionDirectory, "schemas"), "list-keys", SCHEMA_ID],
      { env: this.environment, encoding: "utf8" },
    );
    return new Set(output.split("\n").map((line) => line.trim()).filter(Boolean));
  }

  readExtensionSetting(key) {
    return execFileSync(
      "gsettings",
      ["--schemadir", join(this.extensionDirectory, "schemas"), "get", SCHEMA_ID, key],
      { env: this.environment, encoding: "utf8" },
    ).trim();
  }

  _seedSettings() {
    this.gsettings(["set", "org.gnome.shell", "disable-user-extensions", "false"]);
    this.gsettings([
      "set",
      "org.gnome.shell",
      "enabled-extensions",
      `['${SUPERBAR_UUID}', '${DRIVER_UUID}']`,
    ]);
    // A render should show the settled bar, never a frame from its open easing.
    this.gsettings(["set", "org.gnome.desktop.interface", "enable-animations", "false"]);
    // A fresh profile makes gnome-software announce itself, and the banner
    // lands across the top of the frame.
    this.gsettings(["set", "org.gnome.desktop.notifications", "show-banners", "false"]);

    // A fresh profile has Alt+Space clashing with GNOME's window menu, so the
    // extension quite correctly raises its conflict dialog a moment after
    // startup — which would land a modal on top of every render. Recording the
    // shortcut as already answered is the same thing choosing "Keep Both"
    // does, and leaves the binding itself untouched.
    const keys = this.extensionSettingKeys();
    if (keys.has("conflict-prompt-done")) {
      this.setExtensionSetting("conflict-prompt-done", "true");
    } else if (keys.has("conflict-prompt-accel")) {
      const accel = this.readExtensionSetting("toggle-shortcut").match(/'([^']+)'/)?.[1];
      if (accel) this.setExtensionSetting("conflict-prompt-accel", accel);
    } else {
      console.warn("No conflict-prompt key found; a render may catch the dialog.");
    }

    this.setExtensionSetting("bar-width", this.options["bar-width"]);

    // No wallpaper: a picture would show through the translucent bar and clutter
    // the margin. setBackdrop() picks the flat colour per state.
    this.gsettings(["set", "org.gnome.desktop.background", "picture-uri", ""]);
    this.gsettings(["set", "org.gnome.desktop.background", "picture-uri-dark", ""]);
    this.gsettings(["set", "org.gnome.desktop.background", "color-shading-type", "solid"]);
  }

  setBackdrop(color) {
    this.gsettings(["set", "org.gnome.desktop.background", "primary-color", color]);
  }

  /* Runs JavaScript inside the Shell and returns whatever it evaluated to.
   * Needs `unsafe: true`, since Eval refuses to answer otherwise. Main and the
   * gi imports are in scope; ui modules are not, because the legacy importer
   * cannot load them once they became ES modules. */
  evalInShell(code) {
    const output = execFileSync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.gnome.Shell",
        "--object-path",
        "/org/gnome/Shell",
        "--method",
        "org.gnome.Shell.Eval",
        code,
      ],
      { env: this.environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();

    const match = output.match(/^\((true|false), '(.*)'\)$/s);
    if (!match) throw new Error(`Unexpected Eval output: ${output}`);
    if (match[1] !== "true") throw new Error(`Eval failed: ${match[2]}`);
    return match[2].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }

  /* Eval hands back JSON.stringify() of whatever the code evaluated to, so the
   * code should return a value and let this parse it. Returning an
   * already-stringified object encodes it twice, and the result parses to a
   * string whose every property reads as undefined. */
  evalJson(code) {
    return JSON.parse(this.evalInShell(code));
  }

  _startShell(width, height) {
    this.shell = spawn(
      "gnome-shell",
      [
        "--headless",
        "--virtual-monitor",
        `${width}x${height}`,
        "--wayland-display",
        this.options.waylandDisplay ?? "superbar-render",
      ],
      { env: this.environment, stdio: ["ignore", "pipe", "pipe"] },
    );

    this.shellLog = [];
    for (const stream of [this.shell.stdout, this.shell.stderr]) {
      stream.on("data", (chunk) => this.shellLog.push(chunk.toString()));
    }
    this.shell.on("exit", (code) => {
      this.shellExited = code ?? "signal";
    });
  }

  callDriver(method, args = []) {
    const output = execFileSync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        DRIVER_BUS,
        "--object-path",
        DRIVER_PATH,
        "--method",
        `${DRIVER_BUS}.${method}`,
        ...args,
      ],
      // stderr is piped rather than inherited so the expected "no such name"
      // failures while polling for startup do not reach the console.
      { env: this.environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return output.trim();
  }

  async _waitForDriver() {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastError = null;

    while (Date.now() < deadline) {
      if (this.shellExited !== undefined) {
        throw new Error(
          `GNOME Shell exited (${this.shellExited}) before the driver came up:\n` +
            this.shellLog.join("").split("\n").slice(-15).join("\n"),
        );
      }
      try {
        return this.callDriver("Describe");
      } catch (error) {
        lastError = error;
        await sleep(500);
      }
    }

    throw new Error(
      `The render driver never appeared on the bus: ${lastError?.message ?? "timed out"}\n` +
        this.shellLog.join("").split("\n").slice(-15).join("\n"),
    );
  }

  async start(width, height) {
    this._createDirectories();
    this._installExtensions();
    this._startBus();
    this._seedSettings();
    this._startShell(width, height);
    return this._waitForDriver();
  }

  stop() {
    if (this.shell && this.shellExited === undefined) this.shell.kill("SIGTERM");
    if (this.busPid) {
      try {
        process.kill(this.busPid, "SIGTERM");
      } catch {
        // The bus is already gone.
      }
    }

    if (!this.sessionDirectory) return;

    // gvfs and the document portal mount themselves into XDG_RUNTIME_DIR and
    // a plain rm cannot remove a live FUSE mount.
    for (const mount of ["gvfs", "doc"]) {
      try {
        execFileSync("fusermount", ["-u", join(this.sessionDirectory, "run", mount)], {
          stdio: "ignore",
        });
      } catch {
        // Nothing was mounted there.
      }
    }

    if (this.options.keep) {
      console.log(`Kept the render session at ${this.sessionDirectory}`);
      return;
    }
    rmSync(this.sessionDirectory, { recursive: true, force: true });
  }
}
