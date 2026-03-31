import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AppProvider } from './contexts/AppContext.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ModalProvider } from './contexts/ModalContext.jsx';
import App from './App.jsx';
import { init as initDatabase } from '../js/db.js';
import { getApiKey, saveApiKey, getPreferences, savePreferences } from '../js/storage.js';
import { resolveAssetURL } from '../js/platform.js';
import '../styles.css';

let initialized = false;

async function bootstrap() {
  if (initialized) return;
  initialized = true;

  // Seed from .env.js if present (dev convenience — file is gitignored).
  // Loaded at runtime via resolveAssetURL since Vite can't bundle dotfiles.
  try {
    const envUrl = resolveAssetURL('.env.js');
    const envResp = await fetch(envUrl);
    if (!envResp.ok) throw new Error('no .env.js');
    const envText = await envResp.text();
    // Parse the exported ENV object from the JS module text
    const match = envText.match(/export\s+const\s+ENV\s*=\s*(\{[\s\S]*?\});/);
    if (!match) throw new Error('no ENV export');
    const ENV = JSON.parse(match[1]
      .replace(/'/g, '"')
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/(\w+)\s*:/g, '"$1":')
    );
    if (ENV.apiKey) await saveApiKey(ENV.apiKey);
    if (ENV.name) {
      const prefs = await getPreferences();
      await savePreferences({ ...prefs, name: ENV.name });
    }
    // Store credentials for form pre-fill (not auto-login)
    if (ENV.email || ENV.password) {
      globalThis.__envCredentials = { email: ENV.email || '', password: ENV.password || '' };
    }
  } catch (e) { console.error('[1111] .env.js load failed:', e.message || e); }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <HashRouter>
        <AppProvider>
          <AuthProvider>
            <ModalProvider>
              <App />
            </ModalProvider>
          </AuthProvider>
        </AppProvider>
      </HashRouter>
    </React.StrictMode>
  );
}

// Initialize database, then mount React
initDatabase().then(bootstrap).catch((err) => {
  console.error('[1111] Failed to initialize database:', err);
  document.getElementById('root').textContent = 'Failed to load. Please reload the extension.';
});
