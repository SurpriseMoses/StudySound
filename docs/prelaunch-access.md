# Temporary administrator-only access

The owner requested administrator-only inside pages until explicit launch approval. Public home/legal pages and Free Preview remain available; attempted registration displays “No sign-ups are currently accepted.”

## Enforcement
- Application tables and storage objects retain restrictive admin-only policies except read-only preview metadata and listed preview files; separate restrictive write guards preserve administrator-only modifications.
- The Data API pre-request function denies anonymous/non-admin requests, including RPCs; only GET/HEAD `/preview_videos` and trusted service-role requests are exempt.
- An app-owned before-insert Auth lifecycle trigger rejects registration for all providers. Hosted Auth booleans were deliberately left unchanged because their current values could not be read safely; the trigger is the effective registration block. Hosted signup rejection was verified (500 from Auth, no account created).
- Learner generation, quiz, upload, reward, invitation and checkout edge functions now independently require admin access. Internal service-role calls remain allowed.
- Paystack webhooks, verified payment reconciliation and cancellation are unchanged to avoid stranding prior purchases or preventing subscription cancellation.
- Public home/legal pages, Free Preview, login and recovery remain open. Inside pages remain blocked for visitors and non-admin users.

## Verification
Anonymous preview is public; signup tab is absent. A real administrator session opened Business overview and passed the hosted role check. Anonymous direct document reads and audio, quiz, checkout and invitation requests returned 401. Hosted registration was rejected. Access-rule and app-gate tests cover anonymous users, existing learners, admins and verification errors.

## Deployment and limits
Database and edge restrictions are already live. The frontend must be published with Publish → Update before public previews become visible again on the published website.
Previously downloaded/offline content, public CDN sample assets and already-issued signed links cannot be retrospectively recalled; signed links remain valid until expiry. This prevents new protected access, not copying of content already obtained.

## Reopening
Only on explicit owner launch approval: remove the app-owned registration trigger, remove restrictive prelaunch policies, reset the authenticator pre-request setting, remove edge gates and restore frontend registration/public routes. Preserve existing roles, accounts, balances, payment evidence and other RLS rules. Repeat administrator/learner/anonymous access tests before reopening.