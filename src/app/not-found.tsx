export default function NotFound() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial' }}>
      <h1 style={{ margin: 0 }}>Seite nicht gefunden</h1>
      <p style={{ marginTop: 12 }}>Diese Seite existiert nicht (404).</p>
      <p style={{ marginTop: 12 }}>
        <a href="/" style={{ textDecoration: 'underline' }}>Zur Startseite</a>
      </p>
    </main>
  );
}
