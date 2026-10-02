/* Local launcher: use the bundled overhaul exactly once, independent of saved mod URLs. */
(() => {
  'use strict';
  const ownMods = new Set(['paultendo-mod.js', 'hot-swap-mod.js']);
  const isBundledMod = value => {
    try { return ownMods.has(new URL(value, location.href).pathname.split('/').pop()); }
    catch { return false; }
  };
  window.GenTownLocal = { errors: [], isBundledMod };
  function showError(message) {
    window.GenTownLocal.errors.push(message);
    const panel = document.getElementById('startupError');
    panel.hidden = false;
    panel.textContent = `GenTown needs attention: ${message}. Your saved world is still stored in this browser. Reload to try again, or use Saves to export your world.`;
  }
  window.addEventListener('error', event => {
    if (event.message) showError(event.message);
    else if (event.target?.tagName === 'SCRIPT') showError('A game script could not load');
  }, true);
  window.addEventListener('unhandledrejection', event => showError(event.reason?.message || String(event.reason)));

  // Keep the upstream storage format. Failed writes leave the previous save intact.
  const storageSet = R74n.set;
  R74n.set = function(key, value) {
    try { return storageSet.call(this, key, value); }
    catch (error) { showError(`Could not save to this browser (${error.name}). Export your world from Saves`); }
  };
  // Prevent a legacy enabled-mod URL from racing the bundled script at startup.
  const getSettings = R74n.get;
  R74n.get = function(key) {
    const raw = getSettings.call(this, key);
    if (key !== 'GenTownSettings' || !raw) return raw;
    try {
      const settings = JSON.parse(raw);
      if (Array.isArray(settings.mods)) settings.mods = settings.mods.filter(value => !isBundledMod(value));
      return JSON.stringify(settings);
    } catch {
      showError('Saved settings could not be read; default controls will be used');
      return '{}';
    }
  };
})();
