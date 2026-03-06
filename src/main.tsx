import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './ui/routeTree.gen';
import App from './ui/App';
import './index.css';

// Create the router instance
const router = createRouter({
  routeTree,
  defaultPreload: 'intent', // Preload routes on hover
});

// Register router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
  );
}

createRoot(root).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
);
