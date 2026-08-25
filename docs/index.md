# CloudTAK D4H PLUGIN

[CloudTAK](https://github.com/dfpc-coe/CloudTAK/) plugin — [D4H](https://www.d4h.com/) [Team Manager](https://help.d4h.com/category/701-d4h-team-manager-a-beginners-guide) roster, incidents, and cross-plugin personnel/equipment source.

## Features

- Sync operational personnel, equipment, external resources, and incidents from D4H
- **Hybrid persistence:** server-side Postgres sync on a schedule + local `db.kv` cache for instant UI
- Group-filtered `/api/d4h/*` reads for other plugins
- Submit incidents, rosters, and involved persons from DataSync missions

!!! tip "Quick Start"
Ready to deploy?  Proceed directly to the Installation Guide.

---

### `docs/installation.md` (Build & Deployment)

```markdown
# Installation & Configuration

