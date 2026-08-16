# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Furkan

SHELL := /bin/bash
.DEFAULT_GOAL := help

UUID := superbar@Furkan-rgb.github.io
ARCHIVE := $(UUID).shell-extension.zip
BUILD_DIR ?= build
BUILD_ARCHIVE := $(BUILD_DIR)/$(ARCHIVE)

# ExtensionPreferences ships inside GNOME Shell rather than on disk, and libshew
# is only on the typelib path for processes the Shell starts itself.
SHELL_RESOURCE := /usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource
SHELL_TYPELIB_DIR := $(firstword $(wildcard \
	/usr/lib/gnome-shell/girepository-1.0 \
	/usr/lib64/gnome-shell/girepository-1.0 \
	/usr/lib/*/gnome-shell/girepository-1.0))

.PHONY: help check syntax schema lint unit unit-gtk shexli pack verify test install enable \
	disable prefs status nested renders renders-light renders-dark renders-list \
	export release clean

help:
	@printf "%-12s %s\n" \
		"make check" "Validate JavaScript and the GSettings schema" \
		"make lint" "Run ESLint when it is installed" \
		"make unit" "Run the appearance logic unit tests" \
		"make unit-gtk" "Run the preferences tests that need GTK" \
		"make shexli" "Run the extensions.gnome.org static analyzer" \
		"make pack" "Build the extension ZIP in $(BUILD_DIR)/" \
		"make test" "Run checks, build, and verify the ZIP archive" \
		"make install" "Install the latest local build" \
		"make enable" "Enable Superbar in the current Shell session" \
		"make disable" "Disable Superbar in the current Shell session" \
		"make prefs" "Open Superbar preferences" \
		"make status" "Show the installed extension state" \
		"make nested" "Build, install, and start a fresh nested GNOME Shell" \
		"make renders" "Render all showcase PNGs from the real extension" \
		"make renders-light" "Render the light-theme showcase PNGs" \
		"make renders-dark" "Render the dark-theme showcase PNGs" \
		"make renders-list" "List the available showcase states" \
		"make export" "Build the release ZIP in $(BUILD_DIR)/; does not install it" \
		"make release" "Alias for make export" \
		"make clean" "Remove generated build files"

check: syntax schema

syntax:
	@node --input-type=module --check < extension.js
	@node --input-type=module --check < prefs.js
	@node --input-type=module --check < appearance.js
	@node --input-type=module --check < app-search.js
	@node --input-type=module --check < search-provider-config.js
	@node --input-type=module --check < keybinding-conflicts.js
	@node --input-type=module --check < keybinding-settings.js
	@node --input-type=module --check < tests/prefs-gtk.js
	@node --input-type=module --check < gnome-search-providers.js
	@node --input-type=module --check < scripts/smoke-search-providers.js
	@node --input-type=module --check < scripts/render-live.mjs
	@node --input-type=module --check < showcase/live-states.js
	@node --input-type=module --check < showcase/render-driver@superbar.local/extension.js
	@printf "JavaScript syntax is valid.\n"

schema:
	@glib-compile-schemas --strict --dry-run schemas
	@printf "GSettings schema is valid.\n"

lint:
	@if command -v eslint >/dev/null 2>&1; then \
		eslint --no-eslintrc \
			--env es6 \
			--parser-options '{"ecmaVersion":2022,"sourceType":"module"}' \
			--global global:readonly \
			--global console:readonly \
			--global TextDecoder:readonly \
			--global TextEncoder:readonly \
			--global print:readonly \
			--rule 'no-undef:error' \
			--rule 'no-unused-vars:error' \
			--rule 'no-dupe-keys:error' \
			--rule 'no-unreachable:error' \
			extension.js prefs.js appearance.js app-search.js \
			search-provider-config.js gnome-search-providers.js \
			keybinding-conflicts.js keybinding-settings.js \
			tests/*.test.js tests/prefs-gtk.js && \
		printf "ESLint checks passed.\n"; \
	else \
		printf "ESLint is not installed; skipping optional lint checks.\n"; \
	fi

unit:
	@node --test tests/*.test.js

# The conflict tests write to GNOME's own shortcut schemas, so they run against
# a throwaway XDG_CONFIG_HOME inside a private bus. Without that isolation a run
# would rewrite the shortcuts of whoever is logged in.
unit-gtk:
	@if ! command -v gjs >/dev/null 2>&1 || \
			! command -v dbus-run-session >/dev/null 2>&1; then \
		printf "gjs or dbus-run-session is missing; skipping the GTK preferences tests.\n"; \
	elif [ ! -f "$(SHELL_RESOURCE)" ]; then \
		printf "GNOME Shell resources are missing; skipping the GTK preferences tests.\n"; \
	elif [ -z "$(SHELL_TYPELIB_DIR)" ]; then \
		printf "GNOME Shell typelibs were not found; skipping the GTK preferences tests.\n"; \
	elif [ -z "$$WAYLAND_DISPLAY" ] && [ -z "$$DISPLAY" ]; then \
		printf "No display is available; skipping the GTK preferences tests.\n"; \
	else \
		tmp=$$(mktemp -d) && \
		trap 'rm -rf "$$tmp"' EXIT && \
		mkdir -p "$$tmp/schemas" "$$tmp/config" && \
		cp schemas/*.gschema.xml "$$tmp/schemas/" && \
		glib-compile-schemas "$$tmp/schemas" && \
		XDG_CONFIG_HOME="$$tmp/config" \
		SUPERBAR_TEST_EXTENSION_DIR="$$tmp" \
		GI_TYPELIB_PATH="$(SHELL_TYPELIB_DIR)$${GI_TYPELIB_PATH:+:$$GI_TYPELIB_PATH}" \
		dbus-run-session -- gjs -m tests/prefs-gtk.js; \
	fi

# The static analyser extensions.gnome.org recommends running before uploading.
# It exits 0 whatever it finds, so this target reports rather than gates and
# stays out of `make test`; read the findings yourself before an upload.
# Analyse the packed archive, never the source tree — a checkout carries the
# venv and the showcase renders, which blow shexli's 50MB input limit.
#
# The venv is local-only (uv writes a self-ignoring .gitignore into it), so a
# fresh checkout has no analyser until someone runs SHEXLI_VENV's install line.
SHEXLI_VENV := venv
SHEXLI = $(firstword $(wildcard $(SHEXLI_VENV)/bin/shexli) \
	$(shell command -v shexli 2>/dev/null))

shexli: pack
	@if [ -n "$(SHEXLI)" ]; then \
		"$(SHEXLI)" "$(BUILD_ARCHIVE)"; \
	else \
		printf "shexli is not installed; skipping. Install it with:\n"; \
		printf "  python3 -m venv %s && %s/bin/pip install -U shexli\n" \
			"$(SHEXLI_VENV)" "$(SHEXLI_VENV)"; \
	fi

pack: check
	@mkdir -p "$(BUILD_DIR)"
	@gnome-extensions pack --force --out-dir="$(BUILD_DIR)" \
		--extra-source=LICENSE --extra-source=appearance.js \
		--extra-source=app-search.js \
		--extra-source=search-provider-config.js \
		--extra-source=gnome-search-providers.js \
		--extra-source=search-engines.js --extra-source=result-selection.js \
		--extra-source=keybinding-conflicts.js \
		--extra-source=keybinding-settings.js .
	@printf "Built %s\n" "$(BUILD_ARCHIVE)"

verify: pack
	@unzip -t "$(BUILD_ARCHIVE)"
	@sha256sum "$(BUILD_ARCHIVE)"

test: lint unit unit-gtk verify

install: verify
	@gnome-extensions install --force "$(BUILD_ARCHIVE)"
	@printf "Installed %s\n" "$(UUID)"

enable:
	@gnome-extensions enable "$(UUID)"

disable:
	@gnome-extensions disable "$(UUID)"

prefs:
	@gnome-extensions prefs "$(UUID)"

status:
	@gnome-extensions info "$(UUID)"

# A nested Shell shares the live session's dconf unless told otherwise, which
# puts two dconf-service instances on one database: shortcut changes made in
# the nested session get clobbered by the outer one, and changes meant for the
# test leak into the real session. A throwaway XDG_CONFIG_HOME isolates it, and
# an empty database means every schema default applies — which is exactly the
# state a new install starts from, conflicting shortcut included.
nested: install
	@tmp=$$(mktemp -d) && \
	trap 'rm -rf "$$tmp"' EXIT && \
	printf "Nested session config: %s (discarded on exit)\n" "$$tmp" && \
	XDG_CONFIG_HOME="$$tmp" dbus-run-session -- bash -c \
		"gsettings set org.gnome.shell enabled-extensions \"['$(UUID)']\" && \
		 exec gnome-shell --devkit --wayland"

# Renders come from the real extension running in a throwaway headless Shell,
# so they need GNOME Shell on the machine generating them. Nothing about the
# live session is touched: the render session gets its own bus and HOME.
renders:
	@node scripts/render-live.mjs

renders-light:
	@node scripts/render-live.mjs --theme light

renders-dark:
	@node scripts/render-live.mjs --theme dark

renders-list:
	@node scripts/render-live.mjs --list

export: lint verify
	@printf "Exported %s\n" "$(BUILD_ARCHIVE)"

release: export

clean:
	@test -n "$(BUILD_DIR)" && test "$(BUILD_DIR)" != "/"
	@$(RM) -r -- "$(BUILD_DIR)"
	@printf "Removed %s\n" "$(BUILD_DIR)"
