#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const states = require(join(repositoryRoot, "showcase", "states.js"));
const BASE_WIDTH = 858;
const BASE_HEIGHT = 649;

function parseArguments(argv) {
  const options = {
    output: join(repositoryRoot, "renders"),
    state: null,
    theme: null,
    chrome: process.env.SUPERBAR_CHROME || null,
    scale: process.env.SUPERBAR_RENDER_SCALE || "2",
    list: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") {
      options.list = true;
    } else if (
      ["--output", "--state", "--theme", "--chrome", "--scale"].includes(
        argument,
      )
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/render-showcase.mjs [options]

Options:
  --output DIR    Output directory (default: renders)
  --state NAME    Render one named state
  --theme THEME   Render only light or dark states
  --chrome PATH   Chrome/Chromium executable
  --scale NUMBER  Pixel density from 1–4 (default: 2)
  --list          List the available states
  -h, --help      Show this help

Set SUPERBAR_CHROME to override browser discovery.`);
}

function findChrome(configuredPath) {
  const candidates = [
    configuredPath,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known browser location.
    }
  }

  throw new Error(
    "Chrome or Chromium was not found. Set SUPERBAR_CHROME=/path/to/browser.",
  );
}

function pngDimensions(filePath) {
  const header = readFileSync(filePath).subarray(0, 24);
  const signature = header.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`${filePath} is not a valid PNG`);
  }

  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

function selectStates(options) {
  if (options.theme && !["light", "dark"].includes(options.theme)) {
    throw new Error("--theme must be either light or dark");
  }
  if (options.state && !states[options.state]) {
    throw new Error(`Unknown state: ${options.state}`);
  }

  return Object.entries(states).filter(([name, state]) => {
    if (options.state && name !== options.state) return false;
    if (options.theme && state.theme !== options.theme) return false;
    return true;
  });
}

function parseScale(value) {
  const scale = Number(value);
  if (!Number.isInteger(scale) || scale < 1 || scale > 4) {
    throw new Error("--scale must be a whole number from 1 to 4");
  }
  return scale;
}

function renderState(chrome, profileDirectory, outputDirectory, name, scale) {
  const outputPath = join(outputDirectory, `${name}.png`);
  const showcaseUrl = new URL(
    pathToFileURL(join(repositoryRoot, "showcase", "index.html")),
  );
  showcaseUrl.searchParams.set("state", name);

  const result = spawnSync(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-default-browser-check",
      "--no-first-run",
      "--allow-file-access-from-files",
      `--force-device-scale-factor=${scale}`,
      "--virtual-time-budget=1000",
      `--user-data-dir=${profileDirectory}`,
      `--window-size=${BASE_WIDTH},${BASE_HEIGHT}`,
      `--screenshot=${outputPath}`,
      showcaseUrl.href,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n");
    throw new Error(`Chrome failed while rendering ${name}:\n${details}`);
  }

  const dimensions = pngDimensions(outputPath);
  const expectedWidth = BASE_WIDTH * scale;
  const expectedHeight = BASE_HEIGHT * scale;
  if (
    dimensions.width !== expectedWidth ||
    dimensions.height !== expectedHeight
  ) {
    throw new Error(
      `${name} rendered at ${dimensions.width}×${dimensions.height}; expected ${expectedWidth}×${expectedHeight}`,
    );
  }

  console.log(`Rendered ${name}.png (${dimensions.width}×${dimensions.height})`);
}

let profileDirectory = null;

try {
  const options = parseArguments(process.argv.slice(2));

  if (options.list) {
    for (const [name, state] of Object.entries(states)) {
      console.log(`${name.padEnd(26)} ${state.label}`);
    }
    process.exit(0);
  }

  const selectedStates = selectStates(options);
  if (selectedStates.length === 0) {
    throw new Error("No showcase states matched the requested filters");
  }

  const chrome = findChrome(options.chrome);
  const scale = parseScale(options.scale);
  const outputDirectory = resolve(options.output);
  mkdirSync(outputDirectory, { recursive: true });
  profileDirectory = mkdtempSync(join(tmpdir(), "superbar-render-"));

  for (const [name] of selectedStates) {
    renderState(chrome, profileDirectory, outputDirectory, name, scale);
  }

  console.log(`Saved ${selectedStates.length} render(s) to ${outputDirectory}`);
} catch (error) {
  console.error(`Render failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (profileDirectory) {
    rmSync(profileDirectory, { recursive: true, force: true });
  }
}
