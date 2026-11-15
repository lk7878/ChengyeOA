/** Detail output longer than this is truncated into ConvertError.detail. */
const MAX_DETAIL = 2048;
export function convertError(code, message, extra = {}) {
    return { code, message, ...extra };
}
export function truncate(text, max = MAX_DETAIL) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length <= max ? clean : clean.slice(0, max) + `… (+${clean.length - max} chars)`;
}
/** Normalize an unknown thrown value into a ConvertError. */
export function toConvertError(err, fallbackMessage) {
    if (err instanceof Error) {
        return convertError('conversion_failed', fallbackMessage, { detail: truncate(err.stack ?? err.message) });
    }
    return convertError('conversion_failed', fallbackMessage, { detail: truncate(String(err)) });
}
