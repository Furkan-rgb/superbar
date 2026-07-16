SHELL := /bin/bash
.DEFAULT_GOAL := help

UUID := superbar@Furkan-rgb.github.io
ARCHIVE := $(UUID).shell-extension.zip
BUILD_DIR ?= build
DESKTOP_DIR ?= $(HOME)/Desktop
BUILD_ARCHIVE := $(BUILD_DIR)/$(ARCHIVE)
DESKTOP_ARCHIVE := $(DESKTOP_DIR)/$(ARCHIVE)

.PHONY: help check syntax schema lint pack verify test install enable disable \
	prefs status nested export release clean

help:
	@printf "%-12s %s\n" \
		"make check" "Validate JavaScript and the GSettings schema" \
		"make lint" "Run ESLint when it is installed" \
		"make pack" "Build the extension ZIP in $(BUILD_DIR)/" \
		"make test" "Build and verify the ZIP archive" \
		"make install" "Install the latest local build" \
		"make enable" "Enable Superbar in the current Shell session" \
		"make disable" "Disable Superbar in the current Shell session" \
		"make prefs" "Open Superbar preferences" \
		"make status" "Show the installed extension state" \
		"make nested" "Install and start a nested GNOME Shell" \
		"make export" "Validate and export the ZIP to $(DESKTOP_DIR)/" \
		"make release" "Alias for make export" \
		"make clean" "Remove generated build files"

check: syntax schema

syntax:
	@node --input-type=module --check < extension.js
	@node --input-type=module --check < prefs.js
	@printf "JavaScript syntax is valid.\n"

schema:
	@glib-compile-schemas --strict --dry-run schemas
	@printf "GSettings schema is valid.\n"

lint:
	@if command -v eslint >/dev/null 2>&1; then \
		eslint --no-eslintrc \
			--env es6 \
			--parser-options '{"ecmaVersion":2020,"sourceType":"module"}' \
			--global global:readonly \
			--global console:readonly \
			--global TextDecoder:readonly \
			--rule 'no-undef:error' \
			--rule 'no-unused-vars:error' \
			--rule 'no-dupe-keys:error' \
			--rule 'no-unreachable:error' \
			extension.js prefs.js; \
		printf "ESLint checks passed.\n"; \
	else \
		printf "ESLint is not installed; skipping optional lint checks.\n"; \
	fi

pack: check
	@mkdir -p "$(BUILD_DIR)"
	@gnome-extensions pack --force --out-dir="$(BUILD_DIR)" .
	@printf "Built %s\n" "$(BUILD_ARCHIVE)"

verify: pack
	@unzip -t "$(BUILD_ARCHIVE)"
	@sha256sum "$(BUILD_ARCHIVE)"

test: lint verify

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

nested: install
	@dbus-run-session gnome-shell --devkit --wayland

export: lint verify
	@mkdir -p "$(DESKTOP_DIR)"
	@install -m 0644 "$(BUILD_ARCHIVE)" "$(DESKTOP_ARCHIVE)"
	@printf "Exported %s\n" "$(DESKTOP_ARCHIVE)"
	@sha256sum "$(DESKTOP_ARCHIVE)"

release: export

clean:
	@test -n "$(BUILD_DIR)" && test "$(BUILD_DIR)" != "/"
	@$(RM) -r -- "$(BUILD_DIR)"
	@printf "Removed %s\n" "$(BUILD_DIR)"
