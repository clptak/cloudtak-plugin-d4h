// Subject Information parsing — mirrored from incident-manager subjectInfo.ts and
// subjectsPersistence.ts so this plugin can read subjects without a cross-plugin import.
//
// Primary source: Mission Property `s.incident-response.subjects` on the MGMT
// DataSync, an array of `{ initial_information: SubjectForm, lpq }`.
// Fallback: `subject-information` mission logs (older incidents).

export const SUBJECT_KEYWORD = 'subject-information';

export const SUBJECT_NUMBERS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'] as const;

export interface SubjectForm {
    subjectCaseID: string;
    subjectName: string;
    subjectDateOfBirth: string;
    subjectAge: string;
    subjectGender: string;
    subjectProfile: string;
    subjectDescription: string;
    subjectHeight: string;
    subjectWeight: string;
    subjectHairColor: string;
    /** true = Yes, false = No, null = unset */
    subjectFacialHair: boolean | null;
    /** true = Yes, false = No, null = unset */
    subjectGlasses: boolean | null;
    subjectDistinguishingMarks: string;
    subjectClothing: string;
    subjectFootwear: string;
    subjectVehicle: string;
    subjectMedicalConditions: string;
    subjectExperience: string;
    subjectEquipment: string;
    subjectPhoto: string;
    subjectIppFromTak: string;
    subjectIpp: string;
    subjectTimeWentMissing: string;
    subjectTimeReportedMissing: string;
    subjectReportedMissingBy: string;
}

export interface ParsedSubject extends SubjectForm {
    updatedAt: number;
    rawTime: string;
}

export interface SubjectLogInput {
    keywords?: string[];
    created?: string;
    dtg?: string;
}

export function displaySubjectNumber(n: string): string {
    return String(Number.parseInt(n, 10));
}

export function calculateAgeFromDateOfBirth(dob: string, asOf: Date = new Date()): string | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
    if (!match) return null;
    const birth = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(birth.getTime())) return null;

    let age = asOf.getFullYear() - birth.getFullYear();
    const monthDiff = asOf.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < birth.getDate())) age--;
    if (age < 0) return null;
    return String(age);
}

export function effectiveSubjectAge(f: SubjectForm): string {
    if (f.subjectDateOfBirth?.trim()) {
        return calculateAgeFromDateOfBirth(f.subjectDateOfBirth) ?? '';
    }
    return f.subjectAge?.trim() ?? '';
}

function hasValue(value: string | undefined): value is string {
    return !!value?.trim();
}

/** Labels for incident-manager's removed Category field, so old records still resolve. */
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
    hiker: 'Hiker',
    hunter: 'Hunter',
    child: 'Child',
    elderly: 'Elderly',
    mental_illness: 'Mental Illness',
    alzheimer_dementia: "Alzheimer's/Dementia",
    substance_abuse: 'Substance Abuse',
    other: 'Other',
};

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** First non-empty of subjectProfile, the old subjectType, then the old category label. */
export function legacySubjectProfile(raw: { subjectProfile?: unknown; subjectType?: unknown; subjectCategory?: unknown }): string {
    const profile = stringValue(raw.subjectProfile);
    if (profile) return profile;
    const type = stringValue(raw.subjectType);
    if (type) return type;
    const category = stringValue(raw.subjectCategory);
    if (!category) return '';
    return LEGACY_CATEGORY_LABELS[category] ?? category;
}

/** Parse Yes/No from a boolean, keyword, or legacy free text. */
export function parseSubjectYesNo(value: unknown): boolean | null {
    if (value === true || value === false) return value;
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    if (!v) return null;
    if (v === 'true' || v === 'yes' || v === 'y' || v === '1') return true;
    if (v === 'false' || v === 'no' || v === 'n' || v === '0') return false;
    return null;
}

export function formatSubjectYesNo(value: boolean | null | undefined): string {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return '';
}

export function kwValue(keywords: string[] | undefined, prefix: string): string {
    const tag = keywords?.find((k) => k.startsWith(prefix));
    return tag ? tag.slice(prefix.length) : '';
}

export function fieldsFromLog(keywords?: string[]): SubjectForm {
    return {
        subjectCaseID: kwValue(keywords, 'subject:') || '01',
        subjectName: kwValue(keywords, 'name:'),
        subjectDateOfBirth: kwValue(keywords, 'dob:'),
        subjectAge: kwValue(keywords, 'age:'),
        subjectGender: kwValue(keywords, 'gender:'),
        subjectProfile: legacySubjectProfile({
            subjectProfile: kwValue(keywords, 'subjectProfile:'),
            subjectType: kwValue(keywords, 'subjectType:'),
            subjectCategory: kwValue(keywords, 'category:'),
        }),
        subjectDescription: kwValue(keywords, 'description:'),
        subjectHeight: kwValue(keywords, 'height:'),
        subjectWeight: kwValue(keywords, 'weight:'),
        subjectHairColor: kwValue(keywords, 'hairColor:'),
        subjectFacialHair: parseSubjectYesNo(kwValue(keywords, 'facialHair:')),
        subjectGlasses: parseSubjectYesNo(kwValue(keywords, 'glasses:')),
        subjectDistinguishingMarks: kwValue(keywords, 'distinguishingMarks:'),
        subjectClothing: kwValue(keywords, 'clothing:'),
        subjectFootwear: kwValue(keywords, 'footwear:'),
        subjectVehicle: kwValue(keywords, 'vehicle:'),
        subjectMedicalConditions: kwValue(keywords, 'medical:'),
        subjectExperience: kwValue(keywords, 'experience:'),
        subjectEquipment: kwValue(keywords, 'equipment:'),
        subjectPhoto: kwValue(keywords, 'photo:'),
        subjectIppFromTak: kwValue(keywords, 'ippFromTak:'),
        subjectIpp: kwValue(keywords, 'ipp:'),
        subjectTimeWentMissing: kwValue(keywords, 'missing:'),
        subjectTimeReportedMissing: kwValue(keywords, 'reported:'),
        subjectReportedMissingBy: kwValue(keywords, 'reportedBy:'),
    };
}

export function subjectNumberFromLog(keywords?: string[]): string | null {
    if (!keywords?.includes(SUBJECT_KEYWORD)) return null;
    const tag = keywords.find((k) => k.startsWith('subject:'));
    if (!tag) return null;
    const num = tag.slice('subject:'.length);
    return (SUBJECT_NUMBERS as readonly string[]).includes(num) ? num : null;
}

export function parseSubjectsFromLogs(logs: SubjectLogInput[]): ParsedSubject[] {
    const byNumber = new Map<string, ParsedSubject>();
    for (const log of logs) {
        const number = subjectNumberFromLog(log.keywords);
        if (!number) continue;
        const raw = log.dtg || log.created || '';
        const epoch = raw ? Date.parse(raw) : 0;
        const prev = byNumber.get(number);
        if (!prev || epoch >= prev.updatedAt) {
            byNumber.set(number, {
                ...fieldsFromLog(log.keywords),
                subjectCaseID: number,
                updatedAt: epoch,
                rawTime: raw,
            });
        }
    }
    return [...byNumber.values()].sort(
        (a, b) => Number.parseInt(a.subjectCaseID, 10) - Number.parseInt(b.subjectCaseID, 10),
    );
}

export function hasFilledSubjectFields(f: SubjectForm): boolean {
    return [
        f.subjectName, f.subjectDateOfBirth, f.subjectAge, f.subjectGender, f.subjectProfile,
        f.subjectDescription, f.subjectHeight, f.subjectWeight, f.subjectHairColor,
        f.subjectDistinguishingMarks, f.subjectClothing,
        f.subjectFootwear, f.subjectVehicle, f.subjectMedicalConditions, f.subjectExperience,
        f.subjectEquipment,
    ].some((v) => hasValue(v))
        || f.subjectFacialHair !== null
        || f.subjectGlasses !== null;
}

const STRING_INFO_KEYS = [
    'subjectCaseID', 'subjectName', 'subjectDateOfBirth', 'subjectAge', 'subjectGender',
    'subjectDescription', 'subjectHeight', 'subjectWeight', 'subjectHairColor',
    'subjectDistinguishingMarks', 'subjectClothing', 'subjectFootwear', 'subjectVehicle',
    'subjectMedicalConditions', 'subjectExperience', 'subjectEquipment', 'subjectPhoto',
    'subjectIppFromTak', 'subjectIpp', 'subjectTimeWentMissing', 'subjectTimeReportedMissing',
    'subjectReportedMissingBy',
] as const satisfies readonly (keyof SubjectForm)[];

/** One `initial_information` record from incident_response.subjects → SubjectForm. */
export function subjectFormFromInitialInformation(info: unknown): SubjectForm {
    const raw = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>;
    const form = fieldsFromLog([]);
    for (const key of STRING_INFO_KEYS) {
        const value = raw[key];
        if (typeof value === 'string') form[key] = value;
    }
    form.subjectProfile = legacySubjectProfile(raw);
    form.subjectFacialHair = parseSubjectYesNo(raw.subjectFacialHair);
    form.subjectGlasses = parseSubjectYesNo(raw.subjectGlasses);
    if (!form.subjectCaseID) form.subjectCaseID = '01';
    return form;
}

/**
 * Parse incident_response.subjects (the `s.incident-response.subjects`
 * property value): `[{ initial_information, lpq }]`. Malformed entries and
 * legacy `{}` values are skipped. Last entry per subject number wins.
 */
export function subjectsFromSchemaValue(value: unknown): ParsedSubject[] {
    if (!Array.isArray(value)) return [];
    const byNumber = new Map<string, ParsedSubject>();
    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const info = (entry as { initial_information?: unknown }).initial_information;
        if (!info || typeof info !== 'object') continue;
        const form = subjectFormFromInitialInformation(info);
        byNumber.set(form.subjectCaseID, { ...form, updatedAt: 0, rawTime: '' });
    }
    return [...byNumber.values()].sort(
        (a, b) => Number.parseInt(a.subjectCaseID, 10) - Number.parseInt(b.subjectCaseID, 10),
    );
}
