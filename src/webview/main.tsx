import { render } from 'preact';
import './styles/main.css';
import { App } from './components/App';
import { installKeyboard } from './interaction/keyboard';
import { installScrollSync } from './interaction/sync';
import { onExtensionMessage, postToExtension } from './state/messaging';
import { applyMessage } from './state/store';

const root = document.getElementById('root');
if (root) {
  onExtensionMessage(applyMessage);
  installKeyboard();
  installScrollSync();
  render(<App />, root);
  postToExtension({ type: 'ready' });
}
