import { WebStorageStateStore } from 'oidc-client-ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import { App } from './App';
import { loadConfig } from './config';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

loadConfig()
  .then((config) => {
    root.render(
      <StrictMode>
        <AuthProvider
          authority={`https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`}
          client_id={config.userPoolClientId}
          redirect_uri={`${window.location.origin}/`}
          post_logout_redirect_uri={`${window.location.origin}/`}
          response_type="code" // Authorization Code + PKCE (no client secret in the browser)
          scope="openid email profile"
          automaticSilentRenew
          // Tokens live in sessionStorage: cleared when the tab closes.
          userStore={new WebStorageStateStore({ store: window.sessionStorage })}
          onSigninCallback={() => window.history.replaceState({}, document.title, window.location.pathname)}
        >
          <App config={config} />
        </AuthProvider>
      </StrictMode>,
    );
  })
  .catch((err: Error) => {
    root.render(
      <main className="centered">
        <div className="card error">
          <h1>Configuration error</h1>
          <p>{err.message}</p>
        </div>
      </main>,
    );
  });
