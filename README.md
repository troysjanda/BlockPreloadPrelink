A userscript that blocks preloading and prelinking (prefetching) across all sites:Install it with **Tampermonkey** or **Violentmonkey**, then open any page — the script runs before the page parses, catching hints early and at runtime.

**What it blocks:**

- `<link rel="preload">` — resources the browser speculatively loads ahead of time
- `<link rel="prefetch">` — next-page resources queued in idle time
- `<link rel="prerender">` — background full-page renders
- `<link rel="preconnect">` — early TCP/TLS handshakes to third-party origins
- `<link rel="dns-prefetch">` — early DNS lookups
- `<link rel="modulepreload">` — ES module preloading

**How it covers all injection methods:**

| Vector | How it's blocked |
|---|---|
| Static HTML `<link>` in `<head>` | MutationObserver at `document-start` |
| `document.createElement('link')` | Proxied `rel` property on the new element |
| `appendChild` / `insertBefore` | Overridden to intercept and discard |
| `innerHTML` / `insertAdjacentHTML` | Parsed and stripped before being set |
| `link.rel = '...'` on existing elements | Overridden `HTMLLinkElement.rel` setter |
| Low-priority `fetch()` calls | `fetch` wrapper checks `importance`/`priority` |

**NOTE**
There might be site breakage, Please utilise the log feature to see what is blocked for trouble shooting. This is a work in progress and will evolve as time see fits.

Set `LOG = true` near the top of script for console output showing what gets blocked on each site.
