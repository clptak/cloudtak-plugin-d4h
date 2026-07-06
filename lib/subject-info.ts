// Subject Information parsing — mirrored from incident-manager subjectInfo.ts
// so this plugin can read subject logs from DataSync missions without a cross-plugin import.

export const SUBJECT_KEYWORD = 'subject-information';

export const SUBJECT_NUMBERS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'] as const;

export interface SubjectForm {
    subjectCaseID: string;
    subjectName: string;
    subjectDateOfBirth: string;
    subjectAge: string;
    subjectGender: string;
    subjectCategory: string;
    subjectDescription: string;
    subjectHeight: string;
    subjectWeight: string;
    subjectHairColor: string;
    subjectFacialHair: string;
    subjectGlasses: string;
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
        subjectCategory: kwValue(keywords, 'category:'),
        subjectDescription: kwValue(keywords, 'description:'),
        subjectHeight: kwValue(keywords, 'height:'),
        subjectWeight: kwValue(keywords, 'weight:'),
        subjectHairColor: kwValue(keywords, 'hairColor:'),
        subjectFacialHair: kwValue(keywords, 'facialHair:'),
        subjectGlasses: kwValue(keywords, 'glasses:'),
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
        f.subjectName, f.subjectDateOfBirth, f.subjectAge, f.subjectGender, f.subjectCategory,
        f.subjectDescription, f.subjectHeight, f.subjectWeight, f.subjectHairColor,
        f.subjectFacialHair, f.subjectGlasses, f.subjectDistinguishingMarks, f.subjectClothing,
        f.subjectFootwear, f.subjectVehicle, f.subjectMedicalConditions, f.subjectExperience,
        f.subjectEquipment,
    ].some((v) => hasValue(v));
}
