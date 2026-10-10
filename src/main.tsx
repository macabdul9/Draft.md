import { render } from 'preact';
import App from './app/App';
import './styles/app.css';
render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('focus', () => {
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.update())
      .catch(() => {
        /* An offline session keeps using the installed shell. */
      });
  });
}
