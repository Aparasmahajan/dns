import React from 'react';
import ReactDOM from 'react-dom/client';
// HashRouter: URLs like index.html#/records work when the file is opened straight from disk.
import { HashRouter } from 'react-router-dom';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './styles.css';
import App from './App';
import { AuthProvider } from './auth';
import { ToastProvider } from './components/Toast';
import { SCHEDULER_POLL_MS } from './mock/changes';
import { schedulerTick } from './mock/server';

// The change scheduler runs in this browser while the portal is open (Active site only).
window.setInterval(() => {
  try {
    if (schedulerTick() > 0) window.dispatchEvent(new CustomEvent('portal:changed'));
  } catch (e) {
    console.error('Scheduler tick failed', e);
  }
}, SCHEDULER_POLL_MS);

// Another tab changed the data: refresh counters here too.
window.addEventListener('storage', () => window.dispatchEvent(new CustomEvent('portal:changed')));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>,
);
