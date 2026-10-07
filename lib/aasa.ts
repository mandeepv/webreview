// Apple's associated-domains file for open.kinderwell.app (SPEC-21 §4.2),
// served by app/.well-known/apple-app-site-association/route.ts: lets the
// iOS app claim the sign-in links at /k/*, so tapping one opens the app
// instead of Safari. iOS fetches it through Apple's CDN when the app is
// installed, so a change here can take a day or more to reach phones.
//
// Served on every host: open.kinderwell.app (the links we hand out) and
// kinderwell.app (the link page's "Open Kinderwell", lib/link-page.ts).
// Team 8B52Q4QNLH is the account the app was transferred to (2026-08-21).
// One bundle id: dev builds use com.kinderwell.app too (the app's eas.json;
// the .dev bundle was retired with the bundle split). The app's side of the
// pair is associatedDomains: applinks:open.kinderwell.app and
// applinks:kinderwell.app (app.config.js).
export const AASA = {
  applinks: {
    details: [
      {
        appIDs: ['8B52Q4QNLH.com.kinderwell.app'],
        components: [{ '/': '/k/*', comment: 'SPEC-21 one-time sign-in links' }],
      },
    ],
  },
};
