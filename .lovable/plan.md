# BrainGrasp Global Branding Migration

## Goal
Replace StudySound’s product identity with **BrainGrasp**, use **AcademInnovate** as the parent company where appropriate, and make **braingrasp.ai@gmail.com** the official contact without changing functionality or user data.

## Changes
- Replace every user-facing StudySound variation across public pages, authentication, onboarding, the signed-in app, admin screens, notices, error/help text, and generated/downloaded labels.
- Update the homepage, preview, navigation, and calls to action only where branding appears; preserve layouts, styling, positioning, and behavior.
- Update Privacy, Terms, and Support to identify BrainGrasp as a product operated by AcademInnovate, add the official email, and remove outdated placeholder company/contact wording without inventing registration, address, VAT, or legal details.
- Update the footer to show **BrainGrasp — a product of AcademInnovate**, the official email, and an appropriate copyright line.
- Update the browser title, descriptions, social metadata, PWA install name, README, payment checkout labels, AI-generated assessment prompts, and other user-visible backend messages.
- Search user-displayed database values and safely replace old branding/contact text in existing content where found.
- Preserve technical identifiers that could affect existing users or integrations, including database/storage names, local browser storage keys, project URLs, API URLs, OAuth callbacks, IDs, and infrastructure-only user-agent strings.

## Verification
- Run a final case-insensitive search for all specified old names and emails, classify any retained occurrence as infrastructure-only, and remove every remaining user-facing occurrence.
- Check current build diagnostics and verify key public and signed-in screens render BrainGrasp consistently on desktop and mobile.
- Confirm navigation, authentication entry points, payments, audio preview, and existing content remain wired as before.

## Technical notes
- Existing internal keys such as `studysound-offline` and `studysound:*` browser-storage keys stay unchanged to preserve cached downloads, dismissals, and reward state.
- Infrastructure-only crawler/user-agent identifiers may stay unchanged unless they are safely cosmetic; they are not shown to users.
- No database schema, table, column, bucket, identifier, deployment URL, payment endpoint, or account data will be renamed.
