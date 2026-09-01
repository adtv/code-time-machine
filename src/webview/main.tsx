import { render } from 'preact';
import './styles/main.css';
import { App } from './components/App';
import { installKeyboard } from './interaction/keyboard';
import { onExtensionMessage, postToExtension } from './state/messaging';
import { applyMessage } from './state/store';

const root = document.getElementById('root');
if (root) {
  onExtensionMessage(applyMessage);
  installKeyboard();
  render(<App />, root);
  postToExtension({ type: 'ready' });
}
