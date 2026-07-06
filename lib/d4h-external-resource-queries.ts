// Search terms used to pull the External Resource Tracker catalog from D4H.
//
// D4H exposes no GET /resources list endpoint — only GET /search with
// resource_type=Resource and a required query (min 3 chars). We run several
// queries and dedupe by id. Add terms here if sync misses agencies you see
// under Intelligence → Resources (match words likely in the title).

export const EXTERNAL_RESOURCE_SEARCH_QUERIES = [
    'county',
    'sheriff',
    'office',
    'forest',
    'ranger',
    'service',
    'national',
    'park',
    'monument',
    'fire',
    'rescue',
    'tribal',
    'nation',
    'municipal',
    'helicopter',
    'aviation',
    'bureau',
    'management',
    'police',
    'department',
    'medical',
    'hospital',
    'state',
    'federal',
    'agency',
    'sar',
] as const;
