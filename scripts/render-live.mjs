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

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { HeadlessSession, sleep } from "./headless-session.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const states = (
  await import(pathToFileURL(join(repositoryRoot, "showcase", "live-states.js")))
).default;


// Kept in step with the --extra-source list in the pack target.

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

  session = new HeadlessSession(options);
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
