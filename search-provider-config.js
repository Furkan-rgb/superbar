// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

export function tokenizeSearchQuery(query) {
  return String(query ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function isSubsearchQuery(previousTerms, currentTerms) {
  if (!previousTerms?.length || !currentTerms?.length) return false;
  return currentTerms.join(" ").startsWith(previousTerms.join(" "));
}

export function isSearchProviderEnabled(provider, configuration = {}) {
  if (configuration.disableExternal) return false;

  const desktopId = provider?.desktopId;
  if (!desktopId) return false;

  const disabled = new Set(configuration.disabled ?? []);
  const enabled = new Set(configuration.enabled ?? []);

  return provider.defaultDisabled
    ? enabled.has(desktopId)
    : !disabled.has(desktopId);
}

export function sortSearchProviders(providers, sortOrder = []) {
  const order = new Map(sortOrder.map((desktopId, index) => [desktopId, index]));

  return [...providers].sort((first, second) => {
    const firstOrder = order.get(first.desktopId);
    const secondOrder = order.get(second.desktopId);

    if (firstOrder !== undefined || secondOrder !== undefined) {
      if (firstOrder === undefined) return 1;
      if (secondOrder === undefined) return -1;
      if (firstOrder !== secondOrder) return firstOrder - secondOrder;
    }

    return String(first.label ?? first.desktopId).localeCompare(
      String(second.label ?? second.desktopId),
    );
  });
}

export function flattenProviderResultGroups(providers, resultGroups) {
  return providers.flatMap(
    (provider) => resultGroups.get(provider.desktopId) ?? [],
  );
}
