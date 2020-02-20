/**
 * Given a map of from -> to strings, this will replace all occurrences
 * of each in the given string and return the string with replacements
 * @param str The string to modify
 * @param mapObj The map of strings to map from/to
 */
export function replaceAll(str: string, mapObj: Record<string, string>) {
    const re = new RegExp(Object.keys(mapObj).join('|'), 'gi');

    return str.replace(re, (matched: string) => {
        return mapObj[matched.toLowerCase()];
    });
}

/**
 * This will take the title string and, if it's longer than
 * 255 characters, take the extra and insert it at the beginning of the
 * description given.
 * @param title
 * @param description
 */
export function prepTitleAndDescription(title: string, description: string) {

    // replace characters that would cause problems in ticket summaries.
    if (title) {
        title = replaceAll(title, {
            '\n': ' ',
            '<': '',
            '>': '',
            '@': '(at)'
        });
    } else {
        title = '';
    }

    if (title.length <= 255) {
        // make sure we are returning valid strings
        description = description || '';
        return { title, description };
    }

    const ELLIPSIS = '...';
    const MAX_LENGTH = 255;
    const SLICE_INDEX = MAX_LENGTH - ELLIPSIS.length;
    // prepend the rest of the title to the beginning of the description.
    description = ELLIPSIS + title.slice(SLICE_INDEX) +
        (description ? `\n\n${description}` : '');

    // and remove the extra from the title.
    title = title.slice(0, SLICE_INDEX) + ELLIPSIS;

    return { title, description };

}
