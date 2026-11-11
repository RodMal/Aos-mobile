import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App.js';
import './ui/styles.css';

// Offline support: the service worker precaches the app and swaps in a new deploy on the next visit.
registerSW({
  immediate: true,
  onRegisterError: (e) => console.warn('service worker registration failed', e),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
