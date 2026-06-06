/** Equipment status: OPERATIONAL or a D4H variant prefixed with OPERATIONAL (e.g. OPERATIONAL_READY). */
export function isOperationalEquipmentStatus(status?: string): boolean {
    if (!status) return false;
    return status.trim().toUpperCase().startsWith('OPERATIONAL');
}
