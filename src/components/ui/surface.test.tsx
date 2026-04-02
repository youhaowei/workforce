// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Surface } from './surface';
import { PlatformProvider } from '@/ui/context/PlatformProvider';
import type { PlatformActions } from '@/ui/context/PlatformProvider';

function renderSurface(
  props: React.ComponentProps<typeof Surface>,
  platform: Partial<PlatformActions> = {},
) {
  const actions: PlatformActions = {
    platformType: 'web',
    isDesktop: false,
    isMacOS: false,
    ...platform,
  } as PlatformActions;

  return render(
    <PlatformProvider actions={actions}>
      <Surface data-testid="surface" {...props} />
    </PlatformProvider>,
  );
}

describe('Surface', () => {
  it('applies web variant classes by default', () => {
    const { getByTestId } = renderSurface({ variant: 'main' });
    const el = getByTestId('surface');
    expect(el.className).toContain('overflow-hidden');
    expect(el.className).toContain('bg-neutral-bg/80');
  });

  it('applies desktop variant classes when isDesktop', () => {
    const { getByTestId } = renderSurface(
      { variant: 'main' },
      { platformType: 'electron', isDesktop: true },
    );
    const el = getByTestId('surface');
    expect(el.className).toContain('bg-neutral-bg/40');
    expect(el.className).toContain('saturate-[1.2]');
  });

  it('applies only base classes when variant is null', () => {
    const { getByTestId } = renderSurface({ variant: null });
    const el = getByTestId('surface');
    expect(el.className).toBe('overflow-hidden');
  });

  it('applies only base classes when variant is omitted', () => {
    const { getByTestId } = renderSurface({});
    const el = getByTestId('surface');
    expect(el.className).toBe('overflow-hidden');
  });

  it('appends caller-supplied className', () => {
    const { getByTestId } = renderSurface({
      variant: 'panel',
      className: 'custom-class',
    });
    const el = getByTestId('surface');
    expect(el.className).toContain('custom-class');
    expect(el.className).toContain('bg-neutral-bg/90');
  });
});
