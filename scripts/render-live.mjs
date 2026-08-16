#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

/* Renders the showcase PNGs from the real extension.
 *
 * A throwaway headless GNOME Shell is started on its own bus with its own
 * HOME, Superbar and a development-only driver extension are installed into
 * it, and each fixture state is captured from the live stage. Nothing touches
 * the session running the script.
 *
 * The alternative this replaces was screenshotting an HTML replica of the bar,
 * which meant the renders could not show real icon themes or font rendering
 * and drifted from stylesheet.css whenever one copy changed.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const states = (
  await import(pathToFileURL(join(repositoryRoot, "showcase", "live-states.js")))
).default;

const SUPERBAR_UUID = "superbar@Furkan-rgb.github.io";
const DRIVER_UUID = "render-driver@superbar.local";
const DRIVER_BUS = "org.superbar.RenderDriver";
const DRIVER_PATH = "/org/superbar/RenderDriver";
const SCHEMA_ID = "org.gnome.shell.extensions.superbar";

// Kept in step with the --extra-source list in the pack target.
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

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 1000;
// The shipped default is 640, which leaves the bar looking lost on a desktop
// this size. Renders widen it so the bar carries the frame.
const DEFAULT_BAR_WIDTH = 900;

// GNOME switches between these two by colour scheme, so a light state gets the
// light paper and a dark state the dimmed one without any extra bookkeeping.
// Renders are cropped to the bar, so the only part of the desktop that
// survives is the thin margin left for the drop shadow. A flat colour a step
// away from the bar's own surface makes its rounded corners read without
// competing with it — and because the bar is translucent, anything busier
// would bleed through the whole surface.
const BACKDROPS = { light: "#dcd8d4", dark: "#2b2b31" };

// Enough for the shadow the stylesheet paints outside the allocation, tight
// enough that the bar still fills the frame.
const DEFAULT_PADDING = 28;
// The Shell needs to reach the point where extensions are enabled and the
// driver has claimed its bus name; on a cold cache that is a good few seconds.
const STARTUP_TIMEOUT_MS = 60_000;
// A settings write has to reach the Shell through dconf, and the bar relayouts
// after results are set. Capturing sooner catches a half-styled frame.
const SETTLE_MS = 700;

function printHelp() {
  console.log(`Usage: node scripts/render-live.mjs [options]

Renders showcase PNGs from the real extension in a throwaway headless Shell.

Options:
  --output DIR      Output directory (default: renders)
  --state NAME      Render one named state
  --theme THEME     Render only light or dark states
  --width NUMBER    Virtual monitor width (default: ${DEFAULT_WIDTH})
  --height NUMBER   Virtual monitor height (default: ${DEFAULT_HEIGHT})
  --bar-width NUM   Superbar width in pixels (default: ${DEFAULT_BAR_WIDTH})
  --padding NUMBER  Margin kept around the bar (default: ${DEFAULT_PADDING})
  --backdrop COLOR  Flat colour behind the bar, as #rrggbb
  --keep            Keep the throwaway session directory for inspection
  --list            List the available states
  -h, --help        Show this help`);
}

function parseArguments(argv) {
  const options = {
    output: join(repositoryRoot, "renders"),
    state: null,
    theme: null,
    width: String(DEFAULT_WIDTH),
    height: String(DEFAULT_HEIGHT),
    "bar-width": String(DEFAULT_BAR_WIDTH),
    padding: String(DEFAULT_PADDING),
    backdrop: null,
    keep: false,
    list: false,
  };

  const valued = [
    "--output",
    "--state",
    "--theme",
    "--width",
    "--height",
    "--bar-width",
    "--padding",
    "--backdrop",
  ];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") {
      options.list = true;
    } else if (argument === "--keep") {
      options.keep = true;
    } else if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    } else if (valued.includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function stateTheme(state) {
  return state.settings?.["theme-mode"] === "light" ? "light" : "dark";
}

function selectStates(options) {
  if (options.theme && !["light", "dark"].includes(options.theme))
    throw new Error("--theme must be either light or dark");
  if (options.state && !states[options.state])
    throw new Error(`Unknown state: ${options.state}`);

  return Object.entries(states).filter(([name, state]) => {
    if (options.state && name !== options.state) return false;
    if (options.theme && stateTheme(state) !== options.theme) return false;
    return true;
  });
}

function parseDimension(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 640 || number > 7680)
    throw new Error(`--${label} must be a whole number from 640 to 7680`);
  return number;
}


function pngDimensions(filePath) {
  const header = readFileSync(filePath).subarray(0, 24);
  if (header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error(`${filePath} is not a valid PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class RenderSession {
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

  _startShell(width, height) {
    this.shell = spawn(
      "gnome-shell",
      [
        "--headless",
        "--virtual-monitor",
        `${width}x${height}`,
        "--wayland-display",
        "superbar-render",
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

async function renderState(session, name, state, outputDirectory, padding) {
  const theme = stateTheme(state);

  // Reset the keys any state can set, so a render never inherits the previous
  // one's settings.
  session.setExtensionSetting("theme-mode", "dark");
  session.setExtensionSetting("bar-position", "center");
  for (const [key, value] of Object.entries(state.settings ?? {})) {
    session.setExtensionSetting(key, value);
  }
  session.gsettings([
    "set",
    "org.gnome.desktop.interface",
    "color-scheme",
    theme === "light" ? "default" : "prefer-dark",
  ]);
  session.setBackdrop(session.options.backdrop ?? BACKDROPS[theme]);

  await sleep(SETTLE_MS);
  session.callDriver("ApplyState", [JSON.stringify(state)]);
  await sleep(SETTLE_MS);

  const outputPath = join(outputDirectory, `${name}.png`);
  session.callDriver("Capture", [outputPath, String(padding)]);

  const dimensions = pngDimensions(outputPath);
  console.log(`Rendered ${name}.png (${dimensions.width}×${dimensions.height})`);
  return dimensions;
}

let session = null;

try {
  const options = parseArguments(process.argv.slice(2));

  if (options.list) {
    for (const [name, state] of Object.entries(states)) {
      console.log(`${name.padEnd(26)} ${stateTheme(state).padEnd(6)} ${state.label}`);
    }
    process.exit(0);
  }

  const selectedStates = selectStates(options);
  if (selectedStates.length === 0)
    throw new Error("No showcase states matched the requested filters");

  const width = parseDimension(options.width, "width");
  const height = parseDimension(options.height, "height");

  const padding = Number(options.padding);
  if (!Number.isInteger(padding) || padding < 0 || padding > 400)
    throw new Error("--padding must be a whole number from 0 to 400");

  const outputDirectory = resolve(options.output);
  mkdirSync(outputDirectory, { recursive: true });

  session = new RenderSession(options);
  console.log(`Starting a headless GNOME Shell at ${width}×${height}…`);
  await session.start(width, height);

  const rendered = [];
  for (const [name, state] of selectedStates) {
    rendered.push([name, await renderState(session, name, state, outputDirectory, padding)]);
  }

  // The README lays these out side by side, so a state that comes out a
  // different width would show up as a misaligned column.
  const widths = new Set(rendered.map(([, size]) => size.width));
  if (widths.size > 1) {
    console.warn(
      `Renders came out at different widths (${[...widths].join(", ")}); ` +
        "the README table will not line up.",
    );
  }

  console.log(`Saved ${selectedStates.length} render(s) to ${outputDirectory}`);
} catch (error) {
  console.error(`Render failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  session?.stop();
}
