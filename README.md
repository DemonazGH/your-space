# Personal Guide / Персональный путеводитель

Mobile-first bilingual pilot for voluntary self-reflection. Six questions, optional text, skip/pause, local draft, answer review and explicit JSON export. No analytics, external fonts, API keys, cloud transmission, or diagnostic scoring.

## Preview

Run `node server.js`, open http://127.0.0.1:4173. Run `node --test tests/*.test.js` for question schema checks.

## Deployment

Create a GitHub repository, push the project to its main branch, and enable GitHub Pages with GitHub Actions as source. The workflow publishes only the four allowlisted public assets. Never commit participant exports or identifying information. GitHub Pages hosting is public; noindex is not access control.

## Pilot limits

Answers remain in localStorage in the same browser until deleted. They are readable to others using that browser profile. Downloads contain plain-text answers. The participant decides whether to share a file. There is no automatic collection, parent dashboard, authentication, or automatic next-set generation in this pilot. A private authenticated backend is required before automatic collection; never send answers to a public repository or Issues. Browser/device changes do not sync progress.

## Next-set review

Review only an explicitly shared export. Separate quoted observations, competing explanations, unknowns and follow-up questions. Never infer a diagnosis, motivation or symptom from a skipped question or single choice. Respect a request not to continue. Give the participant a way to correct summaries. Update questions only as a new block with a new storage key and stable choice IDs, preserving the previous export schema.
