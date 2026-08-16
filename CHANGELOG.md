# Changelog

All notable changes to Superbar are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by pushing a `v*` tag, which triggers the packaging workflow.

## [Unreleased]

## [1.3.0] - 2026-08-16

### Added

- Tab cycles the search mode between All results, Clipboard, System Actions,
  Weather, and Dictionary; Shift+Tab cycles back. Tab previously duplicated
  the Down arrow. Modes disabled in Search Sources are left out of the cycle,
  and currency and the calculator stay out of it because neither has a prefix
  to switch into — both are still recognized from what is typed.
- The active mode's prefix is shown as a chip in front of the search field
  instead of as text inside it, so the query survives a mode change and the
  shortcut that reaches the mode stays visible. Typing a prefix turns it into
  the same chip, and Backspace at the start of the field removes it. The
  placeholder text follows the mode.
- Weather and dictionary now accept their keyword before an argument is typed,
  which is the state Tab leaves them in, and prompt for what is missing rather
  than calling out to a third-party API with nothing to look up. The keyword
  on its own is unchanged and still searches normally, so the Weather app is
  still found by name.
- The footer lists `Tab Mode` alongside the existing hints, and hides it when
  every mode but All results has been disabled.

### Security

- The clipboard history file is created with `0600` permissions instead of
  being written with the default umask and tightened immediately afterwards.
  Between those two steps the file — which holds everything the user has
  copied, passwords included — was readable by any local process. Because
  replacing a file preserves its existing mode, history files written by
  earlier versions are also tightened explicitly on load.

### Changed

- Clipboard history reaches disk through an asynchronous, coalesced write
  rather than a synchronous one on every capture, so the compositor thread no
  longer blocks on file I/O while the user is typing. Serializing the history
  still happens on that thread; only the write itself moved off it.
- Saving the adaptive ranking history no longer triggers a reload and a full
  re-run of the active search. The extension writes that key itself, and was
  reacting to its own write; only external changes are picked up now.
- Deferred scroll and results-height updates run on Mutter's `IDLE` laters
  instead of zero-delay `PRIORITY_DEFAULT` timeouts. Both of those read
  allocations after queueing a relayout, and a priority-0 timeout preempts the
  frame clock, so they observed the previous frame's geometry — the selected
  row could scroll to a stale position on a long result list. `IDLE` laters run
  below the frame clock's priority, so the relayout lands first.
- Remote lookups (weather, dictionary, currency) are cached for five minutes,
  so a repeated query no longer re-hits the third-party API. Error responses
  are not cached.
- The HTTP session has a 10 second socket timeout, so a silent endpoint no
  longer leaves the spinner running indefinitely. This is an inactivity budget,
  not a deadline for the whole request.

### Fixed

- Clipboard captures that arrived before the history file finished loading
  could overwrite the saved history with a single entry and then be discarded
  themselves. They are now held until the load completes.
- Clearing the clipboard history while its file was still loading could restore
  every cleared entry, in memory and on disk.
- A history load left in flight across a screen lock could land after the
  unlock and discard entries copied since.

### Known issues

- Coalescing means up to 400 ms of copies can be lost if GNOME Shell exits
  without running `disable()` — a crash, or `Alt+F2 r`. A clean logout or
  screen lock flushes pending writes synchronously.

## [1.2.1] - 2026-08-16

### Changed

- Clipboard monitoring is now event-driven instead of polled. The extension
  connects to Mutter's `MetaSelection::owner-changed` signal rather than reading
  the clipboard on a 1.2 second timer, so a copy shows up in history
  immediately and no work happens while the clipboard is idle. Entries copied
  in quick succession are all captured, where the timer previously collapsed
  everything within a tick down to the last value.

## [1.2.0] - 2026-08-16

### Added

- Showcase images are rendered from the real extension instead of a static
  HTML mock, so the README screenshots track the actual UI.

### Fixed

- The toggle shortcut is registered reliably, and conflicts with existing GNOME
  shortcuts are detected, surfaced, and resolvable from preferences.
- Shortcut capture works in the preferences dialog.
- A failed `enable()` tears itself down and restores the previous shortcuts
  exactly, instead of leaving the extension half-initialized.

### Documentation

- README clarifies shortcut usage and expands the feature descriptions.
- Recorded why `shexli` cannot gate the build yet.

## [1.1.1] - 2026-07-22

### Changed

- Simplified icon handling in search results and made the surrounding styles
  consistent.
- The GitHub release step specifies the repository explicitly.

## [1.1.0] - 2026-07-22

### Added

- Results from GNOME application search providers are shown inline.
- Calculator results can be copied straight from the result row.
- Color source settings with GNOME app palette integration.
- A GitHub Actions workflow that packages and releases the extension.

### Fixed

- Result navigation now aligns with the initially highlighted row.

## [1.0.0] - 2026-07-22

Initial public release.

### Added

- Keyboard-driven, system-wide launcher and command bar for GNOME Shell.
- Clipboard history with search, and clipboard search history management.
- Web search with a selectable default search engine.
- Adaptive result ranking and search preferences.
- Weather, dictionary, and currency conversion lookups.
- Appearance settings: light/dark theme mode, adjustable color presets, color
  swatches in preferences, adjustable background opacity, and a liquid-glass
  spotlight style.
- Bottom-positioned results layout and configurable divider visibility.
- Showcase rendering script with a high-resolution render scale option.

[Unreleased]: https://github.com/Furkan-rgb/superbar/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Furkan-rgb/superbar/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/Furkan-rgb/superbar/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Furkan-rgb/superbar/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Furkan-rgb/superbar/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Furkan-rgb/superbar/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Furkan-rgb/superbar/releases/tag/v1.0.0
