# cloudtak-plugin-d4h

CloudTAK plugin — D4H Team Manager roster, incidents, and cross-plugin personnel/equipment source.

## Features

- Sync operational personnel, equipment, external resources, and incidents from D4H
- **Hybrid persistence:** server-side Postgres sync on a schedule + local `db.kv` cache for instant UI
- Group-filtered `/api/d4h/*` reads for other plugins
- Submit incidents, rosters, and involved persons from DataSync missions

## Install

```bash
./scripts/install.sh [/path/to/CloudTAK]
# then rebuild/restart the CloudTAK API image and web UI
```

Copies `server/plugin-d4h.ts` + `server/d4h-sync.ts` into `api/stateless/routes/` and
symlinks the web plugin under `api/web/plugins/d4h`.

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

## Security

See [SECURITY.md](SECURITY.md) for the no-secrets policy, token handling, and a pre-publish checklist.

## License

GNU Affero General Public License v3 — see [LICENSE](LICENSE).
