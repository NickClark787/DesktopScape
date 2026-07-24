/**
 * Store behavior around style switching. The zustand store is a plain
 * singleton, so these run in node without a DOM (localStorage access is
 * guarded behind typeof window checks).
 */
import { describe, expect, it } from 'vitest';
import { useApp } from '@/state/store';

describe('setStyle', () => {
  it('a manual style change clears pinned overrides', () => {
    const st = useApp.getState();
    st.setStanceOverride('rapid');
    st.setAttackStyleOverride('stab');
    st.setStyle('magic');
    expect(useApp.getState().stanceOverride).toBeNull();
    expect(useApp.getState().attackStyleOverride).toBeNull();
    expect(useApp.getState().style).toBe('magic');
    expect(useApp.getState().loadout.style).toBe('magic');
    expect(useApp.getState().loadout.attackStyle).toBe('magic');
  });

  it('keepOverrides preserves pins for the optimizer auto-switch', () => {
    const st = useApp.getState();
    st.setStanceOverride('rapid');
    st.setAttackStyleOverride('stab');
    st.setStyle('ranged', { keepOverrides: true });
    expect(useApp.getState().stanceOverride).toBe('rapid');
    expect(useApp.getState().attackStyleOverride).toBe('stab');
    expect(useApp.getState().style).toBe('ranged');
    expect(useApp.getState().loadout.style).toBe('ranged');
  });

  it('melee resets the loadout attack style to slash', () => {
    useApp.getState().setStyle('melee');
    expect(useApp.getState().loadout.attackStyle).toBe('slash');
  });
});
