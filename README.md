# Superbar

A keyboard-driven, system-wide launcher and command bar for GNOME Shell — inspired by macOS Spotlight.

Open it from anywhere with **Alt+Space**.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-49%20%7C%2050-blue)
![License](https://img.shields.io/badge/license-GPL--2.0-green)

---

## Screenshots

|                                                          |                                                        |
| -------------------------------------------------------- | ------------------------------------------------------ |
| ![Dark mode](screenshots/superbar_dark.png)              | ![App launcher](screenshots/superbar_dark_app.png)     |
| ![Weather](screenshots/superbar_dark_weather.png)        | ![Math](screenshots/superbar_dark_math.png)            |
| ![Currency](screenshots/superbar_dark_currency.png)      | ![Actions](screenshots/superbar_actions.png)           |
| ![Light weather](screenshots/superbar_light_weather.png) | ![Light folder](screenshots/superbar_light_folder.png) |

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
make export     # export the upload-ready ZIP to ~/Desktop; does not install
```

The generated archive is always named
`superbar@Furkan-rgb.github.io.shell-extension.zip`. `make export` writes it to
the Desktop but does not update the installed extension. Override the export
destination when needed with `make DESKTOP_DIR=/path/to/output export`.

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

## License

GPL-2.0-or-later — see [LICENSE](LICENSE)
