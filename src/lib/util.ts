import {KnownBlock, Block, PlainTextElement, MrkdwnElement} from "@slack/types";
import {SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import {JiraTicket} from "@nexus-switchboard/nexus-conn-jira";
import {getNestedVal} from "@nexus-switchboard/nexus-extend";
import {SlackMessageId} from "./slack/slackMessageId";
import {logger} from "../index";
import {IRequestState, IssueAction, IssueField, RequestState} from "./request";
import {Actor} from "./actor";
import _ from "lodash";
import {ServiceIntent} from "./intents";

export const noop = () => {};

/**
 * Given a map of from -> to strings, this will replace all occurrences
 * of each in the given string and return the string with replacements
 * @param str The string to modify
 * @param mapObj The map of strings to map from/to
 */
export function replaceAll(str: string, mapObj: Record<string, string>): string {
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
        return {title, description};
    }

    const ELLIPSIS = '...';
    const MAX_LENGTH = 255;
    const SLICE_INDEX = MAX_LENGTH - ELLIPSIS.length;
    // prepend the rest of the title to the beginning of the description.
    description = ELLIPSIS + title.slice(SLICE_INDEX) +
        (description ? `\n\n${description}` : '');

    // and remove the extra from the title.
    title = title.slice(0, SLICE_INDEX) + ELLIPSIS;

    return {title, description};

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
            [channel, ts] = parts.slice(0, 2);
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


export function iconFromState(state: RequestState, intent: ServiceIntent): string {

    const statusToIconMap: Record<RequestState, string> = {
        [RequestState.working]: intent.config.text.emojiWorking || ":clock1:",
        [RequestState.error]: intent.config.text.emojiError || ":x:",
        [RequestState.complete]: intent.config.text.emojiCompleted || ":white_circle:",
        [RequestState.todo]: intent.config.text.emojiSubmitted || ":black_circle:",
        [RequestState.cancelled]: intent.config.text.emojiCancelled || ":red_circle:",
        [RequestState.claimed]: intent.config.text.emojiClaimed || ":large_blue_circle:",
        [RequestState.unknown]: ":red_circle"
    };

    return state in statusToIconMap ? statusToIconMap[state] : ":question:";
}

/**
 * Maps an issue's status to a request state.
 */
export function getIssueState(ticket: JiraTicket, intent: ServiceIntent): RequestState {

    if (!ticket) {
        return RequestState.working;
    }

    const cat: string = getNestedVal(ticket, "fields.status.statusCategory.name");

    if (["undefined", "to do", "new"].indexOf(cat.toLowerCase()) >= 0) {
        return RequestState.todo;
    } else if (["indeterminate", "in progress"].indexOf(cat.toLowerCase()) >= 0) {
        return RequestState.claimed;
    } else if (["complete", "done"].indexOf(cat.toLowerCase()) >= 0) {
        const resolution: string = getNestedVal(ticket, "fields.resolution.name");
        if (resolution) {
            if (resolution.toLowerCase() === intent.getJiraConfig().resolutionDone.toLowerCase()) {
                return RequestState.complete;
            } else {
                return RequestState.cancelled;
            }
        }
        return RequestState.complete;
    } else {
        return RequestState.unknown;
    }
}


/**
 * For a given string, this will find all slack user IDs in the form <@{ID}>
 *     and replace with the actual name of the user (if found).
 * @param msg The message to search for slack user IDs in.
 * @return The message with replacements made.
 */
export async function replaceSlackUserIdsWithNames(msg: string): Promise<string> {
    const ids: Record<string, any> = {};
    for (const m of msg.matchAll(/<@(?<id>[A-Z0-9]*)>/gi)) {
        ids[m.groups.id] = "";
    }

    const replacements: Record<string, any> = {};
    if (Object.keys(ids).length > 0) {
        await Promise.all(Object.keys(ids).map(async (id) => {
            return Actor.getSlackUserDataFromSlackId(id)
                .then((user) => {
                    replacements[`<@${id}>`] = getNestedVal(user, "real_name");
                })
                .catch((e) => {
                    logger("Unable to get slack user for ID " + id + ": " + e.toString());
                });
        }));

        return replaceAll(msg, replacements);
    }

    return msg;
}

export async function delay(t: number, v?: any) {
    return new Promise(function(resolve) {
        setTimeout(resolve.bind(null, v), t)
    });
}

/**
 * Safely create two would-be arrays into a new array.  This simply handles
 * corner cases where one or both of the arrays are either not defined or not arrays.
 * @param arr1
 * @param arr2
 */
export function safeArrayMerge<T>(arr1: T[], arr2: T[]): T[] {
    arr1 = _.isArray(arr1) ? arr1 : []
    arr2 = _.isArray(arr2) ? arr2 : []

    if (arr1 && !arr2) {
        return [...arr1];
    } else if (arr2 && !arr1) {
        return [...arr2];
    } else if (!arr2 && !arr1) {
        return [];
    } else {
        return arr1.concat(arr2);
    }
}

export function mergeRequestStates(state1: IRequestState, state2: IRequestState): IRequestState {
    if (state1 && !state2) {
        return state1;
    } else if (state2 && !state1) {
        return state2;
    } else if (!state2 && !state1) {
        return {
            actions: [] as IssueAction[],
            fields: [] as IssueField[],
            icon: "",
            state: ""
        };
    } else {
        return {
            state: state1.state ? state1.state : state2.state,
            icon: state1.icon ? state1.icon : state2.icon,
            actions: safeArrayMerge<IssueAction>(state1.actions, state2.actions),
            fields: safeArrayMerge<IssueField>(state1.fields, state2.fields),
        };
    }
}

export function getSectionBlockFromText(sectionTitle: string, fields?: (PlainTextElement | MrkdwnElement)[]): (KnownBlock | Block) {
    return {
        type: "section",
        text: {
            type: "mrkdwn",
            text: sectionTitle
        },
        fields
    };
}

export function getContextBlock(text: string[]): (KnownBlock | Block) {
    const elements = text.map((t) => {
        return {
            type: "mrkdwn",
            text: t
        };
    });

    return {
        type: "context",
        elements
    };
}
