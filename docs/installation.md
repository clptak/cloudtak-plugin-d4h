# Installation

## Install

```bash
./scripts/install.sh [/path/to/CloudTAK]
# then rebuild/restart the CloudTAK API image and web UI
```

Copies `server/plugin-d4h.ts` + `server/d4h-sync.ts` into `api/stateless/routes/` and
symlinks the web plugin under `api/web/plugins/d4h`.

Requires **CloudTAK 13.124+**. Those route files are compiled and OXLinted with the API
image (`npm run lint && npm run build`). They declare `security: Auth.security(...)` for
header JWTs. They do not accept `?token=`.

A CloudTAK update does not delete extra files in `api/stateless/routes/`. After pulling
this plugin, run `./scripts/install.sh` again so the copies match, then rebuild the API
image. Confirm the running tree has the new routes:

```bash
grep -n "Auth.security" "$CLOUDTAK/api/stateless/routes/plugin-d4h.ts"
# expect several Auth.security lines, and no @ts-nocheck
grep -n "@ts-nocheck\|eslint-disable" "$CLOUDTAK/api/stateless/routes/plugin-d4h.ts" "$CLOUDTAK/api/stateless/routes/d4h-sync.ts" || true
```

## Configuration

### Server sync (system admin)

In the plugin Config tab → **Server sync**:

- Region, context, context ID, D4H token (stored in Postgres)
- Default TAK groups (applied to every synced row)
- Sync interval minutes (15–1440; in-process timer, single API replica)

Then **Sync now** once (or wait for the interval). Operators open the plugin and get the
last shared roster immediately from cache, then a quick refresh from `/api/d4h/roster`.

### Local connection (fallback / writes)

Still available in Config for Submit flows and when the server route is not installed:

- Region, context, context ID, D4H Personal Access Token → Capacitor `Preferences`

## Cross-plugin consumption

```ts
import { std } from '../../src/std.ts';
const { members } = await std('/api/d4h/members') as { members: import('./lib/d4h-types.ts').D4HMember[] };
```

See [STATUS.md](STATUS.md) for tables, endpoints, and filters.