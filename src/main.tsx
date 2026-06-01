import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Register Service Worker for offline PWA capabilities on production domains only.
// In dev & preview sandboxes, aggressively clear service workers and caches to prevent stale rendering.
const isDevOrPreview = 
  import.meta.env.DEV || 
  window.location.hostname.includes('localhost') || 
  window.location.hostname.includes('ais-dev-') || 
  window.location.hostname.includes('ais-pre-');

if (isDevOrPreview && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().then(() => {
        console.log('[SW] Unregistered active service worker in dev/preview:', registration);
      });
    }
  });
  if ('caches' in window) {
    caches.keys().then((names) => {
      for (const name of names) {
        caches.delete(name).then(() => {
          console.log('[SW] Cleared cache partition:', name);
        });
      }
    });
  }
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('Service Worker registered successfully with scope:', reg.scope);
      })
      .catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
