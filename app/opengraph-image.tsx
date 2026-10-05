import { ImageResponse } from 'next/og';

// The 1200×630 preview shown when a Kinderwell link is shared (Messages,
// WhatsApp, Facebook) and by Meta's crawler (review P2-5). Generated at build
// time from the brand tokens in tailwind.config.ts — no design file to keep
// in sync. Next attaches it to every page's og:image / twitter:image.
export const alt = 'Kinderwell — calmer hard moments, closer kids';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#eee9dc',
          color: '#23211e',
        }}
      >
        <div style={{ fontSize: 40, letterSpacing: 2, color: '#8f4526', textTransform: 'uppercase' }}>Kinderwell</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 78, lineHeight: 1.08, maxWidth: 980 }}>Calmer hard moments,</div>
          <div style={{ fontSize: 78, lineHeight: 1.08, color: '#2f6b4a', fontStyle: 'italic' }}>closer kids.</div>
        </div>
        <div style={{ fontSize: 30, color: 'rgba(35,33,30,0.65)', maxWidth: 900 }}>
          Short, science-based lessons for the parenting moments that keep going wrong.
        </div>
      </div>
    ),
    size
  );
}
