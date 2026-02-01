import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('@bridge/index', () => import('../bridge/__mocks__/tauri'));
vi.mock('../bridge/index', () => import('../bridge/__mocks__/tauri'));
vi.mock('../bridge/tauri', () => import('../bridge/__mocks__/tauri'));
