const DEFAULT_DASHBOARD_URL = 'https://d-k-b.github.io/tcg_binder/';

async function initializeExtension() {
  if (chrome.storage?.local?.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
  const saved = await chrome.storage.local.get('dashboardUrl');
  if (!saved.dashboardUrl) {
    await chrome.storage.local.set({ dashboardUrl: DEFAULT_DASHBOARD_URL });
  }

  // Chrome and Edge both support opening an extension side panel from its
  // toolbar action. Keeping this in the worker also makes the keyboard command
  // behave like a click on the pinned extension icon.
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.warn('Unable to enable action-click side panel', error));
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch((error) => console.error('Extension install failed', error));
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension().catch((error) => console.error('Extension startup failed', error));
});

initializeExtension().catch((error) => console.error('Extension initialization failed', error));
