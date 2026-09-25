/** How long a personal file's name and caption may be (round 21, A3, DECISIONS #101). The server is the authority
 * (app/limits.py MAX_NAME_CHARS / MAX_CAPTION_CHARS, a 422 past them); these are the same numbers as input limits, so a person
 * cannot type past what would be refused. If one changes, change both. */
export const PERSONAL_NAME_MAX = 120
export const PERSONAL_CAPTION_MAX = 500
