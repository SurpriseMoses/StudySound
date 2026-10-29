# Temporary administrator-only access

The owner requested administrator-only access until explicit launch approval.

## Enforcement
- All public application tables with RLS and storage objects receive an additional restrictive admin-only policy.
- The Data API pre-request function denies anonymous/non-admin requests, including security-definer RPCs; trusted service-role requests are exempt.
- An app-owned before-insert Auth lifecycle trigger rejects registration for all providers. Hosted Auth booleans were deliberately left unchanged because their current values could not be read safely; the trigger is the effective registration block. Hosted signup rejection was verified (500 from Auth, no account created).
- Learner generation, quiz, upload, reward, invitation and checkout edge functions now independently require admin access. Internal service-role calls remain allowed.
- Paystack webhooks, verified payment reconciliation and cancellation are unchanged to avoid stranding prior purchases or preventing subscription cancellation.
- The frontend app-wide gate hides public previews and learner pages. Login and password recovery remain available; signed-in non-admin users see the closed screen.

## Verification
Anonymous preview is hidden; signup tab is absent. A real administrator session opened Business overview and passed the hosted role check. Anonymous direct document reads and audio, quiz, checkout and invitation requests returned 401. Hosted registration was rejected. Access-rule and app-gate tests cover anonymous users, existing learners, admins and verification errors.

## Deployment and limits
Database and edge restrictions are already live. The frontend must be published with Publish → Update before the closed screen replaces the current public website.
Previously downloaded/offline content, public CDN sample assets and already-issued signed links cannot be retrospectively recalled; signed links remain valid until expiry. This prevents new protected access, not copying of content already obtained.

## Reopening
Only on explicit owner launch approval: remove the app-owned registration trigger, remove restrictive prelaunch policies, reset the authenticator pre-request setting, remove edge gates and restore frontend registration/public routes. Preserve existing roles, accounts, balances, payment evidence and other RLS rules. Repeat administrator/learner/anonymous access tests before reopening.