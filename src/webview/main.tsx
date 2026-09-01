import { render } from 'preact';
import './styles/main.css';

function App() {
  return <main class="ctm-app" />;
}

const root = document.getElementById('root');
if (root) {
  render(<App />, root);
}
