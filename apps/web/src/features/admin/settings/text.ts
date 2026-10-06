/** The same normalization the shared schemas apply before checking a text. */
export const normalize = (value: string): string => value.normalize('NFC').trim();

/** Length as the API counts it, so the remaining-characters counter never disagrees with the server. */
export const charCount = (value: string): number => normalize(value).length;
