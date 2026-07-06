// Swagger enums for POST /incident-involved-persons (subset labels for UI).

export const D4H_SEX_OPTIONS = [
    { value: 'MALE', label: 'Male' },
    { value: 'FEMALE', label: 'Female' },
    { value: 'OTHER', label: 'Other' },
] as const;

export const D4H_AREA_KNOWLEDGE_OPTIONS = [
    { value: 'UNFAMILIAR', label: 'Unfamiliar' },
    { value: 'FAMILIAR', label: 'Familiar' },
] as const;

export const D4H_CAUSE_OPTIONS = [
    { value: 'NO_DATA', label: 'No data' },
    { value: 'ACCIDENTAL', label: 'Accidental' },
    { value: 'INTENTIONAL_SELF', label: 'Intentional (self)' },
    { value: 'INTENTIONAL_OTHER', label: 'Intentional (other)' },
    { value: 'UNDETERMINED', label: 'Undetermined' },
] as const;

export const D4H_HANDOVER_OPTIONS = [
    { value: 'NO_FURTHER_ASSISTANCE', label: 'No further assistance' },
    { value: 'HOSPITAL', label: 'Hospital' },
    { value: 'ONSITE_FACILITY', label: 'On-site facility' },
] as const;

export const D4H_SPINAL_INJURY_OPTIONS = [
    { value: 'SUSPECTED', label: 'Suspected' },
    { value: 'CLEARED', label: 'Cleared' },
    { value: 'NOT_INDICATED', label: 'Not indicated' },
    { value: 'UNDETERMINED', label: 'Undetermined' },
] as const;

export const D4H_TRANSFER_OPTIONS = [
    { value: 'SELF', label: 'Self' },
    { value: 'HOSPITAL', label: 'Hospital' },
] as const;

/** ISO 3166-1 alpha-2 codes accepted by D4H `nationality` (swagger enum). */
export const D4H_NATIONALITY_CODES = [
    'AF', 'AL', 'DZ', 'AD', 'AO', 'AG', 'AR', 'AM', 'AU', 'AT', 'AZ', 'BS', 'BH', 'BD', 'BB', 'BY', 'BE', 'BZ',
    'BJ', 'BT', 'BO', 'BA', 'BW', 'BR', 'BN', 'BG', 'BF', 'BI', 'KH', 'CM', 'CA', 'CV', 'CF', 'TD', 'CL', 'CN',
    'CO', 'KM', 'CG', 'CD', 'CR', 'CI', 'HR', 'CU', 'CY', 'CZ', 'DK', 'DJ', 'DM', 'DO', 'EC', 'EG', 'SV', 'GQ',
    'ER', 'EE', 'ET', 'FJ', 'FI', 'FR', 'GA', 'GM', 'GE', 'DE', 'GH', 'GR', 'GD', 'GT', 'GN', 'GW', 'GY', 'HT',
    'VA', 'HN', 'HU', 'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IL', 'IT', 'JM', 'JP', 'JO', 'KZ', 'KE', 'KI', 'KR',
    'KP', 'KW', 'KG', 'LA', 'LV', 'LB', 'LS', 'LR', 'LY', 'LI', 'LT', 'LU', 'MK', 'MG', 'MW', 'MY', 'MV', 'ML',
    'MT', 'MH', 'MR', 'MU', 'MX', 'FM', 'MD', 'MC', 'MN', 'MA', 'MZ', 'MM', 'NA', 'NR', 'NP', 'NL', 'NZ', 'NI',
    'NE', 'NG', 'NO', 'OM', 'PK', 'PW', 'PA', 'PG', 'PY', 'PE', 'PH', 'PL', 'PT', 'QA', 'RO', 'RU', 'RW', 'KN',
    'LC', 'VC', 'WS', 'SM', 'ST', 'SA', 'SN', 'RS', 'SC', 'SL', 'SG', 'SK', 'SI', 'SB', 'SO', 'ZA', 'ES', 'LK',
    'SD', 'SR', 'SZ', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TZ', 'TH', 'TL', 'TG', 'TO', 'TT', 'TN', 'TR', 'TM', 'TV',
    'UG', 'UA', 'AE', 'GB', 'US', 'UY', 'UZ', 'VU', 'VE', 'VN', 'VG', 'YE', 'ZM', 'ZW', 'XK',
] as const;

const NATIONALITY_NAMES: Record<string, string> = {
    US: 'United States',
    CA: 'Canada',
    GB: 'United Kingdom',
    AU: 'Australia',
    MX: 'Mexico',
};

export function nationalityLabel(code: string): string {
    const name = NATIONALITY_NAMES[code];
    return name ? `${name} (${code})` : code;
}

export const D4H_NATIONALITY_OPTIONS = [
    ...['US', 'CA', 'GB', 'AU', 'MX'].filter((c) => D4H_NATIONALITY_CODES.includes(c as typeof D4H_NATIONALITY_CODES[number])),
    ...D4H_NATIONALITY_CODES.filter((c) => !['US', 'CA', 'GB', 'AU', 'MX'].includes(c)).sort(),
].map((code) => ({ value: code, label: nationalityLabel(code) }));
