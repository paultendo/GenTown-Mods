// hot-swap-mod.js
// Hot-swap mod manager for GenTown
// Author: paultendo
// Install via Settings > Add mod > "hot-swap-mod.js" or full URL

(function() {
    "use strict";

    const MOD_VERSION = "0.1.0";
    if (typeof window !== "undefined") {
        window.HOT_SWAP_MOD_VERSION = MOD_VERSION;
    }
    console.log(`[hot-swap] Loaded v${MOD_VERSION}`);

    const registry = {
        mods: {},
        cleanup: {}
    };

    function logTip(message, type = "tip") {
        if (!message) return;
        if (typeof logMessage === "function") {
            logMessage(message, type);
        } else {
            console.log(`[hot-swap] ${message}`);
        }
    }

    function normalizeModInput(url) {
        if (!url) return "";
        let val = String(url).trim();
        if (typeof normalizeMod === "function") {
            return normalizeMod(val);
        }
        val = val.replace(/\/$/g, "").replace(/ /g, "_");
        return val.toLowerCase();
    }

    function toModUrl(url) {
        if (!url) return "";
        if (typeof modToURL === "function") return modToURL(url);
        if (url.match(/^https?:\/\//)) return url;
        if (url.match(/\.[a-z.]+\//i)) return `https://${url}`;
        return `https://r74ncom.github.io/GenTown-Mods/${url}`;
    }

    function stripCache(url) {
        if (!url) return "";
        return url.split("#")[0].split("?")[0];
    }

    function getModKey(url) {
        if (!url) return "";
        return stripCache(toModUrl(url));
    }

    function ensureEntry(baseUrl) {
        if (!baseUrl) return null;
        if (!registry.mods[baseUrl]) {
            registry.mods[baseUrl] = {
                key: baseUrl,
                baseUrl,
                events: new Set(),
                actions: [],
                scripts: [],
                loadedAtDay: null,
                legacy: false
            };
        }
        return registry.mods[baseUrl];
    }

    function getCurrentScriptUrl() {
        if (typeof document !== "undefined" && document.currentScript && document.currentScript.src) {
            return document.currentScript.src;
        }
        if (typeof window !== "undefined" && window.__hotSwapCurrentUrl) return window.__hotSwapCurrentUrl;
        return "";
    }

    function registerCleanup(fn, url) {
        if (typeof fn !== "function") return false;
        const key = getModKey(url || getCurrentScriptUrl());
        if (!key) return false;
        if (!registry.cleanup[key]) registry.cleanup[key] = [];
        registry.cleanup[key].push(fn);
        return true;
    }

    function callCleanup(key) {
        const list = registry.cleanup[key] || [];
        list.forEach((fn) => {
            try { fn(); } catch (e) { console.warn("[hot-swap] Cleanup failed", e); }
        });
        delete registry.cleanup[key];
    }

    function trackEvent(id, data, sourceUrl) {
        const key = getModKey(sourceUrl);
        if (!key) return;
        const entry = ensureEntry(key);
        if (!entry) return;
        entry.events.add(id);
        if (data && typeof data === "object") {
            data._hotSwapMod = key;
        }
    }

    function trackAction(className, func, sourceUrl) {
        const key = getModKey(sourceUrl);
        if (!key) return;
        const entry = ensureEntry(key);
        if (!entry) return;
        entry.actions.push({ className, func });
    }

    function loadMod(url, opts = {}) {
        const normalized = normalizeModInput(url);
        if (!normalized) return false;
        const baseUrl = getModKey(normalized);
        const entry = ensureEntry(baseUrl);
        if (!entry) return false;

        const cacheBust = opts.cacheBust !== false;
        const src = cacheBust
            ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}v=${Date.now()}`
            : baseUrl;

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.hotSwapKey = baseUrl;
        script.dataset.hotSwap = "1";
        window.__hotSwapCurrentUrl = baseUrl;

        script.onload = () => {
            entry.loadedAtDay = typeof planet !== "undefined" ? planet.day : null;
            if (window.__hotSwapCurrentUrl === baseUrl) window.__hotSwapCurrentUrl = "";
            logTip(`${modNameFromUrl(baseUrl)} loaded.`);
        };
        script.onerror = () => {
            if (window.__hotSwapCurrentUrl === baseUrl) window.__hotSwapCurrentUrl = "";
            logTip(`${modNameFromUrl(baseUrl)} failed to load.`, "warning");
        };

        entry.scripts.push(script);
        entry.lastLoadedUrl = src;
        document.body.appendChild(script);

        if (opts.trackSettings && typeof userSettings !== "undefined") {
            if (!userSettings.mods) userSettings.mods = [];
            const normalizedUrl = normalizeModInput(baseUrl);
            if (!userSettings.mods.includes(normalizedUrl)) {
                userSettings.mods.push(normalizedUrl);
                if (typeof saveSettings === "function") saveSettings();
            }
        }
        return true;
    }

    function unloadMod(url, opts = {}) {
        const key = getModKey(url);
        if (!key) return false;
        const entry = registry.mods[key];
        if (!entry) {
            logTip("Mod not tracked by hot-swap manager.", "warning");
            return false;
        }

        if (typeof gameEvents !== "undefined") {
            entry.events.forEach((id) => {
                if (gameEvents[id]) delete gameEvents[id];
                if (typeof dailyEvents !== "undefined" && dailyEvents[id]) delete dailyEvents[id];
                if (typeof randomEvents !== "undefined" && randomEvents[id]) delete randomEvents[id];
                if (typeof metaEvents !== "undefined" && metaEvents[id]) delete metaEvents[id];
            });
        }

        callCleanup(key);

        if (typeof document !== "undefined") {
            const scripts = document.querySelectorAll("script[data-hot-swap='1']");
            scripts.forEach((s) => {
                const src = s.getAttribute("src") || "";
                if (src && stripCache(src) === key) {
                    s.parentElement && s.parentElement.removeChild(s);
                }
            });
        }

        if (opts.removeFromSettings && typeof userSettings !== "undefined" && userSettings.mods) {
            userSettings.mods = userSettings.mods.filter((u) => getModKey(u) !== key);
            if (typeof saveSettings === "function") saveSettings();
        }

        delete registry.mods[key];
        return true;
    }

    function reloadMod(url, opts = {}) {
        unloadMod(url, { removeFromSettings: false });
        return loadMod(url, { cacheBust: true, trackSettings: opts.trackSettings !== false });
    }

    function reloadAll() {
        const keys = listKnownMods().map(m => m.key);
        keys.forEach((key) => reloadMod(key, { trackSettings: false }));
    }

    function listKnownMods() {
        const list = [];
        if (typeof userSettings !== "undefined" && Array.isArray(userSettings.mods)) {
            userSettings.mods.forEach((u) => {
                const key = getModKey(u);
                if (!key) return;
                const entry = ensureEntry(key);
                if (entry && entry.loadedAtDay === null && (!entry.scripts || entry.scripts.length === 0)) {
                    entry.legacy = true;
                }
            });
        }
        Object.values(registry.mods).forEach((entry) => list.push(entry));
        return list;
    }

    function modNameFromUrl(url) {
        if (!url) return "(mod)";
        if (typeof modToName === "function") return modToName(url);
        const parts = url.split("/");
        return parts[parts.length - 1] || url;
    }

    function addHotSwapButton() {
        const list = document.getElementById("actionMainList");
        if (!list || document.getElementById("actionItem-hotSwap")) return;
        const button = document.createElement("span");
        button.className = "actionItem clickable";
        button.id = "actionItem-hotSwap";
        button.innerHTML = "Hot Mods";
        button.addEventListener("click", () => openHotSwapPanel());
        list.appendChild(button);
    }

    function openHotSwapPanel() {
        const items = [];
        items.push({ text: "Load mod URL", func: () => promptLoadMod() });
        items.push({ text: "Reload all (cache-bust)", func: () => { reloadAll(); openHotSwapPanel(); } });
        const mods = listKnownMods();
        if (!mods.length) {
            items.push({ text: "No mods tracked yet." });
        } else {
            mods.forEach((entry) => {
                const label = `${modNameFromUrl(entry.baseUrl)}${entry.legacy ? " (legacy)" : ""}`;
                items.push({ text: label, func: () => openModPanel(entry.baseUrl) });
            });
        }
        if (typeof populateExecutive === "function") {
            populateExecutive(items, "Hot Mods");
        } else if (typeof doPrompt === "function") {
            doPrompt({ type: "choose", title: "Hot Mods", choices: items.filter(i => i.func).map(i => i.text), func: () => {} });
        }
    }

    function openModPanel(url) {
        const key = getModKey(url);
        const entry = registry.mods[key];
        const items = [];
        items.push({ text: "Back", func: () => openHotSwapPanel() });
        items.push({ spacer: true, text: modNameFromUrl(key) });
        items.push({ text: "Reload (cache-bust)", func: () => { reloadMod(key, { trackSettings: false }); openModPanel(key); } });
        items.push({ text: "Unload (events)", func: () => { unloadMod(key, { removeFromSettings: false }); openHotSwapPanel(); } });
        items.push({ text: "Remove from settings", func: () => { unloadMod(key, { removeFromSettings: true }); openHotSwapPanel(); } });
        items.push({ text: "Open URL", func: () => window.open(key, "_blank") });
        if (entry && entry.legacy) {
            items.push({ text: "Legacy mod (loaded before manager): unload may be incomplete." });
        }
        if (typeof populateExecutive === "function") {
            populateExecutive(items, "Hot Mod");
        }
    }

    function promptLoadMod() {
        if (typeof doPrompt !== "function") {
            const url = window.prompt("Enter mod URL or name (.js)");
            if (url) loadMod(url, { trackSettings: true });
            return;
        }
        doPrompt({
            type: "ask",
            title: "Hot Load Mod",
            message: "Enter a mod name (example_mod.js) or full URL.",
            placeholder: ".JS or URL",
            limit: 1000,
            func: (url) => {
                if (!url) return;
                loadMod(url, { trackSettings: true });
            }
        });
    }

    function wrapModApi() {
        if (typeof Mod === "undefined") return;
        if (Mod.event && !Mod.event._hotSwapWrapped) {
            const baseEvent = Mod.event;
            Mod.event = function(id, data) {
                const src = getCurrentScriptUrl();
                if (src) trackEvent(id, data, src);
                return baseEvent(id, data);
            };
            Mod.event._hotSwapWrapped = true;
        }
        if (Mod.action && !Mod.action._hotSwapWrapped) {
            const baseAction = Mod.action;
            Mod.action = function(className, func) {
                const src = getCurrentScriptUrl();
                if (src) trackAction(className, func, src);
                return baseAction(className, func);
            };
            Mod.action._hotSwapWrapped = true;
        }
    }

    function wrapRunMod() {
        if (typeof runMod !== "function" || runMod._hotSwapWrapped) return;
        const baseRunMod = runMod;
        runMod = function(url) {
            const ok = loadMod(url, { trackSettings: false, cacheBust: false });
            if (!ok) baseRunMod(url);
        };
        runMod._hotSwapWrapped = true;
    }

    function initHotSwapUi() {
        addHotSwapButton();
    }

    wrapModApi();
    wrapRunMod();

    if (typeof initExecutive === "function" && !initExecutive._hotSwapInjected) {
        const baseInitExecutive = initExecutive;
        initExecutive = function(...args) {
            const result = baseInitExecutive.apply(this, args);
            try { initHotSwapUi(); } catch {}
            return result;
        };
        initExecutive._hotSwapInjected = true;
    } else {
        setTimeout(() => {
            try { initHotSwapUi(); } catch {}
        }, 800);
    }

    window.HotSwapMods = {
        load: loadMod,
        unload: unloadMod,
        reload: reloadMod,
        reloadAll,
        list: listKnownMods,
        registerCleanup,
        version: MOD_VERSION
    };
})();
