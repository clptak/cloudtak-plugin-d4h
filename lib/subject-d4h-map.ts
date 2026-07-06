import type { SubjectForm } from './subject-info.ts';
import { effectiveSubjectAge } from './subject-info.ts';
import type { D4HInvolvedPersonCreate, D4HInvolvedOutcome } from './d4h-client.ts';

export interface InvolvedPersonFormState {
    name: string;
    age: string;
    dateOfBirth: string;
    sex: string;
    involvementTypeId: number | '';
    outcomeId: number | '';
    nationality: string;
    areaKnowledge: string;
    cause: string;
    handover: string;
    spinalInjury: string;
    transfer: string;
    assistance: string;
    contact: string;
    involvementNotes: string;
}

export function blankInvolvedPersonForm(): InvolvedPersonFormState {
    return {
        name: '',
        age: '',
        dateOfBirth: '',
        sex: '',
        involvementTypeId: '',
        outcomeId: '',
        nationality: '',
        areaKnowledge: '',
        cause: '',
        handover: '',
        spinalInjury: '',
        transfer: '',
        assistance: '',
        contact: '',
        involvementNotes: '',
    };
}

function mapSex(gender: string): string {
    const g = gender.trim().toLowerCase();
    if (g === 'male') return 'MALE';
    if (g === 'female') return 'FEMALE';
    if (g === 'other') return 'OTHER';
    return '';
}

function noteLine(label: string, value?: string): string | null {
    const v = value?.trim();
    return v ? `${label}: ${v}` : null;
}

/** Subject-only fields → involvementNotes (D4H has no direct columns for these). */
function involvementNotesFromSubject(s: SubjectForm): string {
    const lines = [
        noteLine('Category', s.subjectCategory),
        noteLine('Description', s.subjectDescription),
        noteLine('Height', s.subjectHeight),
        noteLine('Weight', s.subjectWeight),
        noteLine('Hair color', s.subjectHairColor),
        noteLine('Facial hair', s.subjectFacialHair),
        noteLine('Glasses', s.subjectGlasses),
        noteLine('Distinguishing marks', s.subjectDistinguishingMarks),
        noteLine('Clothing', s.subjectClothing),
        noteLine('Footwear', s.subjectFootwear),
        noteLine('Vehicle', s.subjectVehicle),
        noteLine('Medical conditions', s.subjectMedicalConditions),
        noteLine('Experience', s.subjectExperience),
        noteLine('Equipment', s.subjectEquipment),
        noteLine('IPP', s.subjectIppFromTak || s.subjectIpp),
        noteLine('Time went missing', s.subjectTimeWentMissing),
        noteLine('Time reported missing', s.subjectTimeReportedMissing),
        noteLine('Reported missing by', s.subjectReportedMissingBy),
    ].filter((l): l is string => !!l);
    return lines.join('\n');
}

/** Pre-fill D4H involved-person fields from a mission subject log. */
export function involvedPersonFormFromSubject(s: SubjectForm): InvolvedPersonFormState {
    const age = effectiveSubjectAge(s);
    return {
        ...blankInvolvedPersonForm(),
        name: s.subjectName.trim(),
        dateOfBirth: s.subjectDateOfBirth.trim(),
        age,
        sex: mapSex(s.subjectGender),
        involvementNotes: involvementNotesFromSubject(s),
    };
}

function normalizeDateOfBirth(v: string): string | undefined {
    const trimmed = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return undefined;
}

function positiveInt(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.trunc(n);
}

export function buildInvolvedPersonPayload(
    incidentId: number,
    form: InvolvedPersonFormState,
    customFieldValues: Array<{ id: number; value: number[] | string }>,
    opts?: {
        outcomes?: D4HInvolvedOutcome[];
    },
): D4HInvolvedPersonCreate {
    const resolvedIncidentId = positiveInt(incidentId);
    const involvementTypeId = positiveInt(form.involvementTypeId);
    if (resolvedIncidentId == null || involvementTypeId == null) {
        throw new Error('Incident and involvement type are required.');
    }

    const payload: D4HInvolvedPersonCreate = {
        incidentId: resolvedIncidentId,
        involvementTypeId,
    };

    const name = form.name.trim().slice(0, 100);
    if (name) payload.name = name;

    const dob = normalizeDateOfBirth(form.dateOfBirth);
    if (dob) {
        payload.dateOfBirth = dob;
    } else {
        // Swagger: age exclusiveMinimum 0, maximum 666.
        const ageNum = Number.parseInt(form.age.trim(), 10);
        if (Number.isFinite(ageNum) && ageNum > 0 && ageNum <= 666) payload.age = ageNum;
    }

    if (form.sex) payload.sex = form.sex as D4HInvolvedPersonCreate['sex'];
    if (form.nationality) payload.nationality = form.nationality as D4HInvolvedPersonCreate['nationality'];
    if (form.areaKnowledge) payload.areaKnowledge = form.areaKnowledge as D4HInvolvedPersonCreate['areaKnowledge'];
    if (form.cause) payload.cause = form.cause as D4HInvolvedPersonCreate['cause'];
    if (form.handover) payload.handover = form.handover as D4HInvolvedPersonCreate['handover'];
    if (form.spinalInjury) payload.spinalInjury = form.spinalInjury as D4HInvolvedPersonCreate['spinalInjury'];
    if (form.transfer) payload.transfer = form.transfer as D4HInvolvedPersonCreate['transfer'];

    const assistance = form.assistance.trim();
    if (assistance) payload.assistance = assistance;

    const contact = form.contact.trim();
    if (contact) payload.contact = contact;

    const notes = form.involvementNotes.trim();
    if (notes) payload.involvementNotes = notes;

    const outcomeId = positiveInt(form.outcomeId);
    const allowedOutcomes = (opts?.outcomes ?? []).filter((o) => o.involvementTypeId === involvementTypeId);
    if (outcomeId != null && allowedOutcomes.some((o) => o.id === outcomeId)) {
        payload.outcomeId = outcomeId;
    }

    if (customFieldValues.length) payload.customFieldValues = customFieldValues;

    return payload;
}
