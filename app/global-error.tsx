'use client';

// Last resort when the root layout itself fails: no fonts, no Shell — plain
// HTML with the brand colors and a way back.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#eee9dc', color: '#23211e', fontFamily: '-apple-system, Segoe UI, sans-serif' }}>
        <main style={{ maxWidth: 480, margin: '0 auto', padding: '64px 24px' }}>
          <h1 style={{ fontSize: 28, fontWeight: 500 }}>Something went wrong.</h1>
          <p style={{ lineHeight: 1.6, opacity: 0.7 }}>Sorry about that. Please try again.</p>
          <button
            onClick={reset}
            style={{ marginTop: 24, width: '100%', padding: '16px 24px', borderRadius: 999, border: 0, background: '#4F8F8B', color: '#fbf7ef', fontSize: 17, fontWeight: 600 }}
          >
            Try again
          </button>
          <p style={{ marginTop: 16, textAlign: 'center' }}>
            <a href="/start" style={{ color: '#4F8F8B' }}>Start over</a>
          </p>
        </main>
      </body>
    </html>
  );
}
