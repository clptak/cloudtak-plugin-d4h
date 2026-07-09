# cloudtak-plugin-d4h

CloudTAK plugin — D4H Team Manager roster, incidents, and cross-plugin personnel/equipment source.

## Features

- Sync operational personnel, equipment, external resources, and incidents from D4H
- Submit incidents, rosters, and involved persons from DataSync missions
- Share normalized roster data via CloudTAK `db.kv` for other plugins

## Configuration

Users provide their own D4H credentials in the plugin Config tab:

- Region, context (`team` / `organization`), context ID
- D4H Personal Access Token (stored per device in Capacitor `Preferences`)

No credentials are bundled with this plugin.

## Security

See [SECURITY.md](SECURITY.md) for the no-secrets policy, token handling, and a pre-publish checklist.

## License

GNU Affero General Public License v3 — see [LICENSE](LICENSE).
