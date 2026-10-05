import Home from './home-client';

// kinderwell.app/ is the BRAND homepage (organic, press, App Store "Developer
// Website" traffic). Paid traffic belongs on /start, the message-matched ad
// landing; next.config.mjs redirects any ad parameter arriving here to /start
// with its query intact, so this page can stay static.
export default function Page() {
  return <Home />;
}
