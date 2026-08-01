# Security

## Secrets policy

**Never commit secrets to this repository.**

That includes:

- D4H Personal Access Tokens (Bearer tokens)
- CloudTAK session tokens
- API keys, passwords, or private keys
- Production hostnames, team/org IDs, or deployment-specific overlay mappings tied to a live operation

Credentials are entered at runtime in the plugin UI. They are not part of the source tree.

## Runtime token handling

### Hybrid (preferred)

- **Server D4H token:** System admin pastes in Config → Server sync. Stored in CloudTAK
  Postgres (`d4h_config.token`). Used only by the API for periodic / admin sync.
  Never written to `db.kv` or returned by `GET /api/d4h/config` (redacted: `tokenConfigured`).
- **Roster reads:** Authenticated JWT → group-filtered Postgres rows via `/api/d4h/*`.
- **Local cache:** `db.kv` keys `d4h:roster` / `d4h:meta` hold the *already-authorized*
  response for snappy remounts — never the D4H token.

### Local fallback / writes

- **Local D4H token:** Still stored in Capacitor `Preferences` (`d4h-config-v1`) for
  Submit Incident / Roster / Subject and for Sync when the server route is not configured.
- **CloudTAK session token:** Read from `Preferences` key `token` when the plugin falls
  back to CloudTAK's `/api/proxy` (CSP-blocked direct fetch). Not stored in this repo.

Treat device access as equivalent to any local token. Prefer server-held credentials for
shared roster sync so operators do not each hold a long-lived D4H PAT in the browser.

## Access control

Roster visibility is gated by TAK channel/group membership on the server (`groups TEXT[]`
on each row ∩ caller's active TAK groups). System and agency admins see all rows.
Write/sync endpoints require `Auth.as_user(..., { admin: true })` (system admin).

## Files intentionally excluded from git

`.gitignore` blocks local-only artifacts that may contain tokens or org-specific data:

- `docs/HANDOFF-incident-entry.md`
- `docs/d4h_swagger.json`
- `spike/**/.env*`
- `spike/**/*.local.sh`

Do not force-add these before publishing.

## Pre-publish checklist

Before making the repository public:

1. `git status` — confirm no `.env`, swagger dump, or handoff docs are staged.
2. Search tracked files for accidental secrets:
   ```bash
   rg -i '(password|api[_-]?key|secret|bearer [a-zA-Z0-9]{20,}|ghp_|sk-|AKIA)' .
   ```
3. Search for org-specific identifiers you do not want public (team IDs, production hostnames, real names in comments).
4. Review `lib/overlay-field-map.ts` — should contain only template/example rows, not live deployment mappings.
5. Run `npm run check` (or `scripts/check-like-docker.sh`) to ensure sanitization did not break the build.

## Reporting vulnerabilities

If you discover a security issue in this plugin, please report it privately to the repository maintainer rather than opening a public issue with exploit details.

## Git history and PII

Older commits may contain sample data from development spikes (e.g. real member names in comment examples). **Redacting current files does not remove data from git history.**

If zero historical exposure is required before going public:

1. Install [git-filter-repo](https://github.com/newren/git-filter-repo).
2. Replace sensitive strings across all commits, e.g.:
   ```bash
   git filter-repo --replace-text <(printf 'Example, Member==>Example, Member\n12345==>12345\n')
   ```
3. Force-push to the remote (rewrites all commit SHAs — coordinate with any collaborators).
4. Rotate any credentials that were ever committed, even if later removed.

**Decision for this repo:** Sanitize current tracked content; perform a history rewrite only if you need prior commits to contain no identifiable sample data. If the repo has never been pushed publicly, rewriting before the first public push is low-risk and recommended.
