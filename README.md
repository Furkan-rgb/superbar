# Superbar

A keyboard-driven, system-wide launcher and command bar for GNOME Shell — inspired by macOS Spotlight.

Open it from anywhere with **Alt+Space**.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-49%20%7C%2050-blue)
![License](https://img.shields.io/badge/license-GPL--2.0--or--later-green)

---

## UI Renders

Deterministic high-resolution renders are generated from the local showcase
HTML/CSS so the README stays aligned with the extension UI.

|                                                                    |                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| ![Dark empty state](renders/dark-empty.png)                        | ![Light search results](renders/light-search.png)                         |
| ![Dark search results](renders/dark-search.png)                    | ![Dark bottom-positioned results](renders/dark-bottom-search.png)         |
| ![Light clipboard results](renders/light-clipboard.png)            | ![Dark clipboard copied state](renders/dark-clipboard-copied.png)         |
| ![Light calculator result](renders/light-calculator.png)           | ![Dark weather result](renders/dark-weather.png)                          |

---

## Features

| Feature                   | How to use                                                             |
| ------------------------- | ---------------------------------------------------------------------- |
| **App Launcher**          | Type the app name — fuzzy match, launches or focuses                   |
| **Window Switcher**       | Type part of a window title — jumps across workspaces                  |
| **File Search**           | Type a filename — searches home dir and common folders                 |
| **Clipboard History**     | `clip`, `clipboard`, or `history` prefix — browse saved entries        |
| **Weather**               | `weather <city>` — live temp, humidity, wind (Open-Meteo, no API key)  |
| **Calculator**            | Type a math expression e.g. `2 * (3 + 4)` — result copied to clipboard |
| **Currency Converter**    | `100 USD to EUR`                                                       |
| **Dictionary**            | `define <word>` — English definitions via Free Dictionary API          |
| **Web Search**            | Any unmatched query falls through to a web search                      |
| **System Commands**       | Use `>`, `cmd`, `command`, or `action` before an action name           |
| **Resumable Searches**    | Reopen a dismissed search within five minutes; typing replaces it      |
| **Adaptive Ranking**      | Prioritizes strong matches, active context, and selected apps/actions  |
| **Multi-Monitor Aware**   | Opens on the focused monitor and stays inside its usable work area     |
| **Configurable Shortcut** | Change the toggle keybinding in GNOME Extensions preferences           |
| **Adjustable Appearance** | Choose the theme, background opacity, width, and screen position       |

---

## Installation

### From GNOME Extensions (recommended)

> **Note:** The extension is currently under review by the GNOME Extensions team and is not yet available on [extensions.gnome.org](https://extensions.gnome.org). In the meantime, please use the manual installation method below.

[Superbar on Gnome Extensions Marketplace](https://extensions.gnome.org/extension/9778/superbar/) - Soon!

### Manual

```bash
git clone https://github.com/Furkan-rgb/superbar.git \
  ~/.local/share/gnome-shell/extensions/superbar@Furkan-rgb.github.io

glib-compile-schemas ~/.local/share/gnome-shell/extensions/superbar@Furkan-rgb.github.io/schemas/

gnome-extensions enable superbar@Furkan-rgb.github.io
```

Log out and back in if this is the first time installing.

---

## Requirements

- GNOME Shell 49 or 50
- An internet connection for weather, dictionary, and currency features

## Local development and testing

The Makefile provides the common development and release commands:

```bash
make help
make test       # validate, build, and verify the ZIP
make install    # install the latest local build
make nested     # install and start a fresh nested GNOME Shell
make renders    # generate deterministic UI showcase images
make export     # export the upload-ready ZIP to build/; does not install
```

The generated archive is always named
`superbar@Furkan-rgb.github.io.shell-extension.zip`. `make export` writes it to
the repository's `build/` directory but does not update the installed extension.

### UI showcase renders

Run `make renders` to generate consistent high-resolution 1716×1298 PNG
illustrations in `renders/`. The 2× pixel density is the default while the
composition remains equivalent to an 858×649 canvas. The showcase mirrors
Superbar's current dimensions, neutral light and dark surfaces, result rows,
bottom-positioned expansion, mode indicator, footer, and background opacity. It
uses local HTML, CSS, vector icons, and headless Chrome/Chromium, so it does not
need npm packages or network access.

```bash
make renders          # every state
make renders-light    # only light states
make renders-dark     # only dark states
make RENDER_SCALE=3 renders  # 2574×1947 output
node scripts/render-showcase.mjs --state dark-clipboard-copied
node scripts/render-showcase.mjs --scale 4 --state dark-weather
node scripts/render-showcase.mjs --list
```

The rendered states include empty search, general results, bottom-positioned
results, clipboard copy and copied states, calculator output, and weather. Set
`SUPERBAR_CHROME` to the Chrome or Chromium executable if it is installed
outside the common system locations. The renderer is an illustration of the
GNOME Shell UI rather than a live Shell capture; when the extension's design
tokens change, update `showcase/styles.css` alongside `stylesheet.css`.

For development, close any existing nested Shell and run `make nested`. This
packages and installs the current source before starting a fresh Shell process;
disabling and re-enabling an extension does not reliably reload cached modules.
Once it opens, enable Superbar and inspect its state from a terminal inside the
nested desktop while in the repository directory:

```bash
make enable
make prefs
make status
```

On X11, press **Alt+F2**, enter `r`, then enable the extension. On a regular
Wayland session, log out and back in instead of restarting GNOME Shell in place.

---

## Design and implementation notes

Superbar uses a restrained, high-contrast material adapted to GNOME Shell. Its
soft neutral off-white light surface and charcoal dark surface keep text, icons,
and results readable without GNOME Shell's rectangular background blur.
Background opacity is adjustable from 65–100% in Appearance settings and
defaults to 90%.

When Vertical Position is set to Bottom, the search row remains anchored at its
configured screen position, the footer stays on the underside of the bar, and
the result panel reveals upward. Bottom placement mirrors Top: the bottom edge
sits the same distance from the lower work-area edge that Top sits from the
upper work-area edge. Center is the default vertical position.

Ordinary searches remain one unified, adaptively ranked list; the redesign does
not add category tabs or source filters. The non-interactive mode indicator is
derived from the existing query parsers and provider conditions, so it reports
contexts such as Clipboard, Actions, Weather, Dictionary, Calculator, and
Currency without changing result selection. The results area uses
content-driven height for compact empty and short states, then scrolls after it
reaches its bounded maximum. The footer's `> Actions` label is only a discovery
hint for the existing action prefix, not a new control or shortcut.

For visual or lifecycle testing, use a fresh nested Shell so cached extension
modules cannot mask changes:

```bash
# From the repository, close any older nested Shell, then start a fresh one.
make nested

# In a terminal inside the nested desktop, from this repository:
make enable

# Press Alt+Space to open Superbar.
```

Use `make status` in that nested-desktop terminal to confirm the extension is
enabled. Run `make test` before testing, and use `make prefs` there when the
preferences UI also needs inspection.

---

## License and credits

Copyright © 2026 Furkan.

Superbar is licensed under GPL-2.0-or-later — see [LICENSE](LICENSE).

Superbar is built for GNOME Shell and uses GNOME platform APIs. Weather,
dictionary, and currency features use Open-Meteo (`open-meteo.com`), Free
Dictionary API (`dictionaryapi.dev`), and Frankfurter (`frankfurter.app`).
Clipboard history uses GNOME Shell clipboard access and is declared in
`metadata.json`.
