const SAFE_HTTP_PROTOCOLS = new Set(['http:', 'https:']);


function sanitizeHttpUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return { url: '' };

    try {
        const parsed = new URL(raw);
        if (!SAFE_HTTP_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
            return { url: '', error: 'Meeting link must be a valid http:// or https:// URL.' };
        }

        return { url: parsed.toString() };
    } catch {
        return { url: '', error: 'Meeting link must be a valid http:// or https:// URL.' };
    }
}

function isSafeHttpUrl(value) {
    return Boolean(sanitizeHttpUrl(value).url);
}

module.exports = {
    sanitizeHttpUrl,
    isSafeHttpUrl
};
