import { getCodeView } from '../rendering/registry';
import { postToExtension } from '../state/messaging';
import { activeRevision, navigate, revisions, setActive } from '../state/store';
import { jumpToChange } from './changeNavigation';

/**
 * Global keyboard shortcuts. Positive navigation = older.
 *   J / PageDown / Alt+↓  → older      K / PageUp / Alt+↑ → newer
 *   Alt+Home → newest      Alt+End → oldest        R → refresh
 *   N / F7 → next change block   P / Shift+F7 → previous change block
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
    case 'n':
    case 'N':
      return jumpToChange(activeCodeView(), 1);
    case 'p':
    case 'P':
      return jumpToChange(activeCodeView(), -1);
    case 'F7':
      return jumpToChange(activeCodeView(), event.shiftKey ? -1 : 1);
    default:
      return false;
  }
}

function activeCodeView() {
  const id = activeRevision.value?.id;
  return id === undefined ? undefined : getCodeView(id);
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}
