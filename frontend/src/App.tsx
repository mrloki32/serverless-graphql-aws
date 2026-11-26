import { useAuth } from 'react-oidc-context';
import { TaskBoard } from './components/TaskBoard';
import type { AppConfig } from './config';

export function App({ config }: { config: AppConfig }) {
  const auth = useAuth();

  const signOut = async () => {
    await auth.removeUser();
    // Cognito has no OIDC end_session_endpoint; use its hosted-UI logout URL.
    const logoutUri = encodeURIComponent(`${window.location.origin}/`);
    window.location.href = `https://${config.cognitoDomain}/logout?client_id=${config.userPoolClientId}&logout_uri=${logoutUri}`;
  };

  if (auth.isLoading) {
    return (
      <main className="centered">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (auth.error) {
    return (
      <main className="centered">
        <div className="card error">
          <h1>Sign-in failed</h1>
          <p>{auth.error.message}</p>
          <button onClick={() => void auth.signinRedirect()}>Try again</button>
        </div>
      </main>
    );
  }

  if (!auth.isAuthenticated || !auth.user) {
    return (
      <main className="centered">
        <div className="card hero">
          <h1>Task Board</h1>
          <p className="muted">
            React on CloudFront → AppSync → Lambda → private GraphQL on Fargate → RDS PostgreSQL. Changes stream in
            real time.
          </p>
          <button className="primary" onClick={() => void auth.signinRedirect()}>
            Sign in
          </button>
        </div>
        <footer className="muted small">
          {config.stage} · {config.version}
        </footer>
      </main>
    );
  }

  return (
    <TaskBoard
      config={config}
      owner={auth.user.profile.sub}
      email={auth.user.profile.email}
      getToken={() => auth.user?.access_token}
      onSignOut={() => void signOut()}
    />
  );
}
