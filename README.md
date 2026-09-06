# Artsiom’s Personal Guide / Персональный путеводитель Артёма

Mobile-first bilingual guide for voluntary self-reflection. Six questions, optional text, skip/pause, local draft, review and JSON export. Private access links enable consent-based cloud autosave. No analytics, external fonts, public credentials or diagnostic scoring.

## Preview

Run `node server.js`, open http://127.0.0.1:4173. Run `node --test tests/*.test.js` for question schema checks.

## Deployment

Create a GitHub repository, push the project to its main branch, and enable GitHub Pages with GitHub Actions as source. The workflow publishes only the four allowlisted public assets. Never commit participant exports or identifying information. GitHub Pages hosting is public; noindex is not access control.

## Private autosave

The public site is a local-only demo. A private fragment link enables cloud mode; the access key is removed from the address bar and retained in sessionStorage. Test and participant links have separate local drafts and server-enforced repository namespaces. Keep links private. They grant write access, not read access, and are bearer credentials. Shared browser profiles are not private from other people using the profile.

After explicit consent, changes are debounced and saved through the Cloudflare Worker to `DemonazGH/personal-guide-data`. Network failures keep the draft locally and retry while the page is open. The UI only confirms remote saving after acknowledgement. Device changes do not restore answers from the server. The Worker offers no answer-read endpoint.

Server configuration is in `worker/wrangler.jsonc`. Deploy with `node node_modules/wrangler/bin/wrangler.js deploy --config worker/wrangler.jsonc`. Required secrets: `GITHUB_TOKEN` (fine-grained, Contents write, only the private data repository), `TEST_TOKEN_HASH`, `PARTICIPANT_TOKEN_HASH` (SHA-256 hashes of independent 32-byte random hex tokens). No raw credentials belong in code, Git, logs or public assets. Worker request logging is disabled. CORS is defense-in-depth; bearer authentication enforces access. Rotate the GitHub token before its configured expiry.

Records: `test/<session UUID>/first-steps-v1.json` and `participant/<session UUID>/first-steps-v1.json`. The Worker validates the question schema, ignores any client-provided mode, rejects stale revisions, and acknowledges only successful storage. Concurrent revisions retry using GitHub file SHAs. Tests cover auth, origin, namespace isolation, Unicode, stale writes, consent and offline queue behavior.

Cloudflare processes the submitted answers and GitHub stores them. The welcome screen discloses this before consent. Removing answers on a device does not delete remote records. Git retains previous commits; a full remote erasure requires removing the history containing those records, not merely deleting a current file. No automated deletion or AI analysis is performed.

## Pilot limits

Downloads contain plain-text answers. The participant can review answers and download a copy. There is no dashboard or automatic next-set generation yet. Never send answers to a public repository or Issues. The local demo never transmits answers. The first block and following questions remain manually reviewed.

## Next-set review

Review only an explicitly shared export. Separate quoted observations, competing explanations, unknowns and follow-up questions. Never infer a diagnosis, motivation or symptom from a skipped question or single choice. Respect a request not to continue. Give the participant a way to correct summaries. Update questions only as a new block with a new storage key and stable choice IDs, preserving the previous export schema.
