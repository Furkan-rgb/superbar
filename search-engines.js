// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

export const SEARCH_ENGINES = [
  {
    key: "google",
    label: "Google",
    searchUrl: "https://www.google.com/search?q=",
  },
  {
    key: "duckduckgo",
    label: "DuckDuckGo",
    searchUrl: "https://duckduckgo.com/?q=",
  },
  {
    key: "bing",
    label: "Bing",
    searchUrl: "https://www.bing.com/search?q=",
  },
  {
    key: "brave",
    label: "Brave Search",
    searchUrl: "https://search.brave.com/search?q=",
  },
  {
    key: "ecosia",
    label: "Ecosia",
    searchUrl: "https://www.ecosia.org/search?q=",
  },
  {
    key: "startpage",
    label: "Startpage",
    searchUrl: "https://www.startpage.com/sp/search?query=",
  },
];

export function getSearchEngine(key) {
  return (
    SEARCH_ENGINES.find((searchEngine) => searchEngine.key === key) ??
    SEARCH_ENGINES[0]
  );
}

export function buildSearchUri(searchEngineKey, query) {
  const searchEngine = getSearchEngine(searchEngineKey);
  return `${searchEngine.searchUrl}${encodeURIComponent(query)}`;
}
