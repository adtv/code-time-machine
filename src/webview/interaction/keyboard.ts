import { postToExtension } from '../state/messaging';
import { navigate, revisions, setActive } from '../state/store';

/**
 * Global keyboard shortcuts. Positive navigation = older.
 *   J / PageDown / Alt+↓  → older      K / PageUp / Alt+↑ → newer
 *   Alt+Home → newest      Alt+End → oldest        R → refresh
 * Plain arrow keys are left to the focused element (scrolling code).
 */
export function installKeyboard(target: Window = window): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || isEditable(event.target)) {
      return;
    }
    const handled = handleKey(event);
    if (handled) {
      event.preventDefault();
    }
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

export function handleKey(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (mod) {
    return false;
  }
  switch (event.key) {
    case 'j':
    case 'J':
    case 'PageDown':
      navigate(+1);
      return true;
    case 'k':
    case 'K':
    case 'PageUp':
      navigate(-1);
      return true;
    case 'ArrowDown':
      if (event.altKey) {
        navigate(+1);
        return true;
      }
      return false;
    case 'ArrowUp':
      if (event.altKey) {
        navigate(-1);
        return true;
      }
      return false;
    case 'Home':
      if (event.altKey) {
        setActive(0);
        return true;
      }
      return false;
    case 'End':
      if (event.altKey) {
        setActive(revisions.value.length - 1);
        return true;
      }
      return false;
    case 'r':
    case 'R':
      postToExtension({ type: 'refresh' });
      return true;
    default:
      return false;
  }
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}
