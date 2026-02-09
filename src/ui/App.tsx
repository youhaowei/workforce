/**
 * App - Root component for Workforce desktop application
 *
 * Renders the main Shell component which contains:
 * - Header with profile status
 * - Message list with virtual scrolling
 * - Message input
 * - Status bar
 */

import { Shell } from './components/Shell';

export default function App() {
  return <Shell />;
}
