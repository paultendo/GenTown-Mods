(() => {
  'use strict';
  // Span controls supplied by the base game retain their click handlers and gain keyboard access.
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (!target.matches?.('[role="button"], .actionItem.clickable, .paultendoChronicleToggle')) return;
    if (target.tagName === 'BUTTON' || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!target.hasAttribute('disabled') && target.getAttribute('aria-disabled') !== 'true') target.click();
  }, true);
  const enhance = root => {
    if (!root.querySelectorAll) return;
    for (const control of root.querySelectorAll('[role="button"], .actionItem.clickable, .paultendoChronicleToggle')) {
      if (control.tagName !== 'BUTTON') {
        control.setAttribute('tabindex', '0');
        control.setAttribute('role', 'button');
      }
    }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches('[role="button"], .actionItem.clickable, .paultendoChronicleToggle') && node.tagName !== 'BUTTON') {
        node.setAttribute('tabindex', '0');
        node.setAttribute('role', 'button');
      }
      enhance(node);
    }
  });
  observer.observe(document.getElementById('gameDiv'), { childList: true, subtree: true });
  enhance(document);
  window.addEventListener('load', () => {
    if (!window.gameLoaded || !window.PAULTENDO_MOD_VERSION) {
      const panel = document.getElementById('startupError');
      panel.hidden = false;
      panel.textContent = 'The game could not finish loading. Reload to try again. Your saved world has been kept.';
    }
  });
})();
