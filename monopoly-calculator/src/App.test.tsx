import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => {} }));
import App from './App';
import { STORAGE_KEY } from './engine/storage';

function tap(label: string) {
  const btn = document.querySelector(`button.calc-key[aria-label="${label}"]`)!;
  fireEvent.pointerDown(btn, { button: 0 });
  fireEvent.pointerUp(btn);
}

describe('App (UI)', () => {
  beforeEach(() => localStorage.clear());

  it('starts a game, runs a key sequence, persists and restores it', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Έναρξη παιχνιδιού' }));
    ['Π1', '0', '9', 'ΑΓΟΡΑ'].forEach(tap);
    expect(screen.getByTestId('lcd-text').textContent).toContain('ΕΙΣΑΓΩΓΗ');
    tap('=');
    expect(screen.getByTestId('lcd-text').textContent).toContain('Π1 ΕΙΣΑΓΩΓΗ 09 ΠΛΗΡΩΝΕΙ');
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.game.companies[8].shares).toEqual([5, 0]);
    unmount();

    render(<App />);
    expect(document.querySelector('.keypad')).not.toBeNull();
    fireEvent.keyDown(window, { code: 'Digit0' });
    fireEvent.keyDown(window, { code: 'Digit9' });
    fireEvent.keyDown(window, { code: 'Enter' });
    expect(screen.getByTestId('lcd-text').textContent).toContain('09 ΠΡΟΕΔΡΟΣ Π1');
  });

  it('undo reverts the last operation', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Έναρξη παιχνιδιού' }));
    ['Π2', '2', '2', 'ΑΓΟΡΑ', '='].forEach(tap);
    fireEvent.click(screen.getByRole('button', { name: 'Αναίρεση' }));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.game.companies[21].shares.every((s: number) => s === 0)).toBe(true);
  });

  it('new game asks for confirmation', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Έναρξη παιχνιδιού' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ρυθμίσεις' }));
    fireEvent.click(screen.getByRole('button', { name: 'Νέο παιχνίδι…' }));
    expect(screen.getByRole('dialog', { name: 'Νέο παιχνίδι;' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Άκυρο' }));
    expect(document.querySelector('.keypad')).not.toBeNull();
  });
});
