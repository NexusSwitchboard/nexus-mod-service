/**
 * Given a map of from -> to strings, this will replace all occurrences
 * of each in the given string and return the string with replacements
 * @param str The string to modify
 * @param mapObj The map of strings to map from/to
 */
import { SlackPayload } from "@nexus-switchboard/nexus-conn-slack";
import { getNestedVal } from "@nexus-switchboard/nexus-extend";
import { SlackMessageId } from "./slack/slackMessageId";
import { logger } from "../index";

export function replaceAll(str: string, mapObj: Record<string, string>) {
    const re = new RegExp(Object.keys(mapObj).join('|'), 'gi');

    return str.replace(re, (matched: string) => {
        return mapObj[matched];
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

/**
 * Slack API errors have useful information in them if you dig deep enough.  This
 * will do that and return a single string to you.
 * @param err
 */
export function getMessageFromSlackErr(err: SlackPayload): string {
    const topMsg = err.toString();
    const detailMsg = getNestedVal(err, "data.response_metadata.messages")

    return `${topMsg} (${detailMsg})`
}

export type SlackRequestInfo = {
    conversationMsg: SlackMessageId,
    notificationChannel: string
};

/**
 * We store slack conversation information in Jira labels by encoding the data that needs to be
 * easily searchable.  We also use this encoded form when passing information through modals in the
 * metadata parameter.
 * @param data
 */
export function parseEncodedSlackData(data: string): SlackRequestInfo {
        try {
            const parts = data.split(/\|\||--/g);
            let channel: string;
            let ts: string;

            // get the conversation channel and ts
            if (parts.length >= 2) {
                [channel, ts] = parts.slice(0,2);
            }

            return {
                conversationMsg: new SlackMessageId(channel, ts),
                notificationChannel: undefined
            }
        } catch (e) {
            logger("Received invalid request ID - could not parse.");
            return {
                conversationMsg: undefined,
                notificationChannel: undefined
            };
        }
}

/**
 * Generate an encoded form of most important slack message data.  This is only necessary during the period between
 * when a user has begun entering data and before a ticket has been created.  Since we use Jira ticket properties
 * to store information about the associated slack request, we have no place to store this information before the
 * ticket is created.  Instead, we encode that data into a single string and use it as "metadata" or "context data"
 * in various places including slack modals and jira labels.  This helps recreate the association in cases when
 * other methods are not working or not available.
 *
 * @param data
 */
export function createEncodedSlackData(data: SlackRequestInfo): string {
    return `${data.conversationMsg.channel}||${data.conversationMsg.ts}`;
}
