import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './index.css';

const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
  throw new Error('Root element not found.');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
