// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

export function getNextResultIndex(selectedIndex, resultCount) {
  if (resultCount <= 0) return -1;

  const lastIndex = resultCount - 1;

  // With no active selection, the first row is already shown as the default
  // result. Move to the second row so keyboard navigation matches the UI.
  if (selectedIndex < 0) return Math.min(1, lastIndex);

  return Math.min(selectedIndex + 1, lastIndex);
}
