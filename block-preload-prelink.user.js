// ==UserScript==
// @name         Block Site's Preloading & Prelinking.
// @namespace    https://github.com/troysjanda
// @version      1.2.1
// @description  Blocks <link rel="preload|prefetch|prerender|preconnect|dns-prefetch"> and dynamic Resource Hints injected at runtime.
// @author       Troy Janda
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // --- Config ---
    const BLOCKED_REL = new Set([
        'preload',
        'prefetch',
        'prerender',
        'preconnect',
        'dns-prefetch',
        'modulepreload',
    ]);

    const LOG = false; // set to true to log blocked hints to the console

    function isBlocked(rel) {
        if (!rel) return false;
        return rel.trim().split(/\s+/).some(r => BLOCKED_REL.has(r.toLowerCase()));
    }

    function log(...args) {
        if (LOG) console.log('[Block Preload]', ...args);
    }

    // ── 1. Strip existing <link> tags in <head> before they are parsed ──────────
    // Works only if @run-at document-start fires early enough (it does in most engines).
    const headObserver = new MutationObserver(mutations => {
        for (const { addedNodes } of mutations) {
            for (const node of addedNodes) {
                if (node.nodeName === 'LINK' && isBlocked(node.rel)) {
                    node.remove();
                    log('removed <link rel="' + node.rel + '">', node.href);
                }
            }
        }
    });

    headObserver.observe(document.documentElement, { childList: true, subtree: true });

    // ── 2. Override HTMLLinkElement.rel setter ───────────────────────────────────
    // Catches cases where scripts set rel on an existing element after insertion.
    const linkRelDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'rel');
    if (linkRelDesc && linkRelDesc.set) {
        Object.defineProperty(HTMLLinkElement.prototype, 'rel', {
            get: linkRelDesc.get,
            set(value) {
                if (isBlocked(value)) {
                    log('blocked rel setter →', value, this.href);
                    // Neutralise by setting to a harmless value
                    linkRelDesc.set.call(this, 'stylesheet-blocked');
                    this.disabled = true;
                    return;
                }
                linkRelDesc.set.call(this, value);
            },
            configurable: true,
        });
    }

    // ── 3. Override document.createElement to trap programmatic <link> creation ─
    const origCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, options) {
        const el = origCreateElement.call(this, tag, options);
        if (tag.toLowerCase() === 'link') {
            // Proxy the rel property on the new element instance
            let _rel = '';
            Object.defineProperty(el, 'rel', {
                get() { return _rel; },
                set(value) {
                    if (isBlocked(value)) {
                        log('blocked createElement link rel →', value);
                        _rel = 'stylesheet-blocked';
                        el.disabled = true;
                        return;
                    }
                    _rel = value;
                },
                configurable: true,
            });
        }
        return el;
    };

    // ── 4. Block <link> insertion via Node.prototype.appendChild / insertBefore ──
    // This catches the most common dynamic injection pattern.
    function blockIfResourceHint(node) {
        if (node && node.nodeName === 'LINK' && isBlocked(node.rel)) {
            log('blocked appendChild/insertBefore <link rel="' + node.rel + '">', node.href);
            // Return a detached clone so callers don't throw
            return document.createDocumentFragment();
        }
        return null;
    }

    const origAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function (node) {
        return blockIfResourceHint(node) ?? origAppendChild.call(this, node);
    };

    const origInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (node, ref) {
        return blockIfResourceHint(node) ?? origInsertBefore.call(this, node, ref);
    };

    const origPrepend = Element.prototype.prepend;
    if (origPrepend) {
        Element.prototype.prepend = function (...nodes) {
            const safe = nodes.filter(n => !blockIfResourceHint(n));
            return origPrepend.apply(this, safe);
        };
    }

    const origAppend = Element.prototype.append;
    if (origAppend) {
        Element.prototype.append = function (...nodes) {
            const safe = nodes.filter(n => !blockIfResourceHint(n));
            return origAppend.apply(this, safe);
        };
    }

    // ── 5. Block fetch() with "preload" / "prefetch" initiatorType hints ─────────
    // The Fetch API doesn't have a native initiator field, but some frameworks
    // pass a custom 'priority' or 'importance' header. Block explicit importance hints.
    const origFetch = window.fetch;
    window.fetch = function (input, init = {}) {
        const importance = init.importance || init.priority || '';
        if (importance === 'low' || (typeof input === 'string' && /\?.*prefetch/.test(input))) {
            log('blocked low-priority fetch →', input);
            return Promise.resolve(new Response(null, { status: 204 }));
        }
        return origFetch.call(this, input, init);
    };

    // ── 6. Block <link> injection via innerHTML / insertAdjacentHTML ─────────────
    // Parse the string and strip preload/prefetch links before setting.
    function sanitiseHTML(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('link').forEach(el => {
            if (isBlocked(el.rel)) {
                log('stripped from innerHTML:', el.outerHTML);
                el.remove();
            }
        });
        // Re-serialise
        const div = document.createElement('div');
        div.appendChild(tpl.content.cloneNode(true));
        return div.innerHTML;
    }

    const innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (innerHTMLDesc && innerHTMLDesc.set) {
        Object.defineProperty(Element.prototype, 'innerHTML', {
            get: innerHTMLDesc.get,
            set(value) {
                if (typeof value === 'string' && /preload|prefetch|prerender|preconnect|dns-prefetch/i.test(value)) {
                    value = sanitiseHTML(value);
                }
                innerHTMLDesc.set.call(this, value);
            },
            configurable: true,
        });
    }

    const origInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (position, html) {
        if (typeof html === 'string' && /preload|prefetch|prerender|preconnect|dns-prefetch/i.test(html)) {
            html = sanitiseHTML(html);
        }
        return origInsertAdjacentHTML.call(this, position, html);
    };

    log('Preload/prelink blocking active.');
})();
