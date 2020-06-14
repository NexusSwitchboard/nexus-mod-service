import {SlackMessageId} from "./slackMessageId";
import {logger} from "../../index";
import {getNestedVal, ModuleConfig} from "@nexus-switchboard/nexus-extend";
import {RequestState} from "../request";
import {JiraTicket, JiraConnection, JiraPayload} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection, SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import {createEncodedSlackData, getIssueState, iconFromState, replaceAll} from "../util";
import moduleInstance from "../../index";
import {ChatPostMessageArguments, ChatPostEphemeralArguments, ChatUpdateArguments} from "@slack/web-api";
import {KnownBlock, Block, PlainTextElement, MrkdwnElement} from "@slack/types";

export const claimButton: IssueAction = {
    code: "claim_request",
    name: "Claim",
    style: "primary"
};

export const cancelButton: IssueAction = {
    code: "cancel_request",
    name: "Cancel",
    style: "danger"
};

export const completeButton: IssueAction = {
    code: "complete_request",
    name: "Complete",
    style: "primary"
};

export const viewButton: IssueAction = {
    code: "view_request",
    name: "View Ticket",
    style: "primary",
    url: undefined
};


export type IssueAction = {
    code: string,
    name: string,
    style?: "primary" | "danger",
    url?: string
};

export type JiraIssueSidecarData = {
    issueIdOrKey?: string,
    propertyKey?: string,
    channelId: string,
    threadId: string,
    actionMsgId: string,
    notificationChannelId: string,
    reporterSlackId: string,
    claimerSlackId: string,
    closerSlackId: string
};

export interface ThreadUpdateParams {
    slackUser?: SlackPayload;
    jiraUser?: JiraPayload;
    message?: string;
}

export type ChannelAssignments = {
    notificationChannelId: string,
    conversationChannelId: string
}

/**
 * Helps to manage the slack thread that is used to represent a single request.
 */
export class SlackThread {

    public conversationMessage: SlackMessageId;
    public actionMessageId: SlackMessageId;

    protected _reporterSlackId: string;
    protected _claimerSlackId: string;
    protected _closerSlackId: string;
    protected _ticket: JiraTicket;
    protected slack: SlackConnection;
    protected jira: JiraConnection;
    protected config: ModuleConfig;

    readonly channelRestrictionMode: string;
    protected notificationChannel: string;

    protected cachedPermalinks: Record<string, string>;

    constructor(conversationMessage: SlackMessageId, notificationChannel: string, slack: SlackConnection, jira: JiraConnection, config: ModuleConfig) {
        this.slack = slack;
        this.jira = jira;
        this.config = config;

        this.channelRestrictionMode = this.config.SLACK_CONVERSATION_RESTRICTION || "primary";
        this.conversationMessage = conversationMessage;
        this.cachedPermalinks = {};
        this.notificationChannel = (notificationChannel === this.conversationMessage.channel) ? undefined : notificationChannel;
    }

    public get reporterSlackId(): string {
        return this._reporterSlackId;
    }

    public set reporterSlackId(val: string) {
        this._reporterSlackId = val;
    }

    public get claimerSlackId(): string {
        return this._claimerSlackId;
    }

    public set claimerSlackId(val: string) {
        this._claimerSlackId = val;
    }

    public get closerSlackId(): string {
        return this._closerSlackId;
    }

    public set closerSlackId(val: string) {
        this._closerSlackId = val;
    }

    public get channel(): string {
        return this.conversationMessage.channel;
    }

    public get ts(): string {
        return this.conversationMessage.ts;
    }

    public get notificationChannelId(): string {
        return this.notificationChannel;
    }

    public get ticket(): JiraTicket {
        return this._ticket;
    }

    /**
     * This associated a Jira ticket with this thread.  When this happenss a few things are done:
     *      1. The full ticket details are load from Jira (including infrabot specific properties) - this only
     *          happens if the details are not already loaded.
     *      2. Using the properties from the tickets, it populates various class properties like reporter/claimer/closer
     *          slack IDs along with the notification channel that is associated with this ticket.
     *
     * @param val The JiraTicket - if the `properties` property is not set then it will make a call to
     *              get the full ticket info.
     */
    public async setTicket(val: JiraTicket) {
        const label = this.config.REQUEST_JIRA_SERVICE_LABEL;
        const botProps: JiraIssueSidecarData = getNestedVal(val, `properties.${label}`);
        if (!botProps) {
            throw new Error("A ticket cannot be set which does not have any properties set");
        }

        if (botProps.channelId !== this.channel) {
            throw new Error("A ticket in Jira had bot properties associated with it but they have the wrong channel ID.  Which really shouldn't happen");
        }

        if (botProps.threadId !== this.ts) {
            throw new Error("A ticket in Jira had bot properties associated with it but they have the wrong channel ID.  Which really shouldn't happen");
        }

        this._ticket = await this.loadFullTicketDetails(val);

        // The sidecard data in Jira keeps track of the original reporter and the action message TS.
        //  We need the former because we can't convert jira users to slack users (privacy reason) and we need the
        //  latter because it's slow to pull a full list of replies from the thread just to get the first one.  At
        //  the time of writing this, it was not possible to return just the first reply (grrr..).
        this.actionMessageId = new SlackMessageId(this.channel, botProps.actionMsgId);
        this.reporterSlackId = botProps.reporterSlackId;
        this.claimerSlackId = botProps.claimerSlackId;
        this.closerSlackId = botProps.closerSlackId;
        this.notificationChannel = botProps.notificationChannelId;
    }

    /**
     * Determine which channel should receive the main request conversation and which, if any, should receive
     * notifications.
     * @param originatingChannelId The channel which fielded in the initial request
     * @param primaryChannelId The channel which is configured as the primary (can be undefined)
     * @param conversationMode The configured mode of restricting conversations to primary channel (or not)
     */
    public static determineConversationChannel(originatingChannelId: string, primaryChannelId: string, conversationMode: string): ChannelAssignments {
        if (primaryChannelId) {
            // if a primary channel is set then we should check to see where the request thread should live
            //  based on the SLACK_CONVERSATION_RESTRICTION and the initiating original channel ID
            if (conversationMode === "primary" && primaryChannelId !== originatingChannelId) {
                // if we get there that means that all conversations should happen in the primary channel but
                //  that's not where the original infra request came from.
                return {
                    conversationChannelId: primaryChannelId,
                    notificationChannelId: originatingChannelId
                };
            } else if (conversationMode === "invited" && primaryChannelId !== originatingChannelId) {
                return {
                    conversationChannelId: originatingChannelId,
                    notificationChannelId: primaryChannelId
                };
            }
        }

        return {
            conversationChannelId: originatingChannelId,
            notificationChannelId: undefined
        };

    }

    /**
     * This will create a single string value that serializes slack data for easy search within a Jira ticket.
     * The format for this ID is as follows:
     *  <conversation_channel_id>||<conversation_thread_ts>
     *
     *  So, for example, if there is a notification channel, it might look like this:
     *      CPYJV7N20||1585535418.003600--1585535424.003800
     *
     *  Or without a notification channel
     */
    public serializeId(): string {
        return createEncodedSlackData({
            conversationMsg: this.conversationMessage,
            notificationChannel: this.notificationChannelId
        });
    }

    public setActionThread(ts: string) {
        if (!this.actionMessageId) {
            this.actionMessageId = new SlackMessageId(this.conversationMessage.channel, ts);
        } else {
            this.actionMessageId.ts = ts;
        }
    }

    public async getThreadHeaderMessageId(): Promise<SlackMessageId> {
        try {
            if (!this.conversationMessage.ts) {
                logger("You cannot find a status reply without an existing source thread");
                return undefined;
            }

            return this.actionMessageId;
        } catch (e) {
            logger("Exception thrown: When trying to get the action bar message ID: " + e.toString());
            return undefined;
        }
    }


    public async update(params: ThreadUpdateParams) {
        await this.updateTopLevelMessage(params.message, params.slackUser, params.jiraUser);
        // await this.updateActionBar();
    }

    /**
     * Retrieves a permalink from a channel and string.  It uses the API call to
     * get the link to ensure that it's correct but it will cache the links if multiple calls with the
     * same channel/ts are made.
     * @param channel The channel of the link
     * @param ts The timestamp of the link.
     */
    public async getPermalink(channel: string, ts: string) {
        let permalink;
        const key = `${channel}|${ts}`;
        if (!(key in this.cachedPermalinks)) {
            const results = await this.slack.apiAsBot.chat.getPermalink({
                channel: this.channel,
                message_ts: this.ts
            });

            if (results.ok) {
                permalink = results.permalink;
            }

            this.cachedPermalinks[key] = permalink as string;
        }

        return this.cachedPermalinks[key]
    }

    public async postMsgToNotificationChannel(actionMsg: string) {
        if (this.notificationChannelId && this.channelRestrictionMode === "primary") {

            const blocks: (KnownBlock | Block)[] = [];

            const state: RequestState = getIssueState(this.ticket, this.config);
            const icon = iconFromState(state, this.config);

            // Ticket Information
            if (this.ticket) {
                const ticketLink: string = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
                blocks.push(this.getSectionBlockFromText(`${icon} *<${ticketLink}|${this.ticket.key} - ${this.ticket.fields.summary}>*`));
            }
            blocks.push(this.getSectionBlockFromText(actionMsg));

            const permaLink = await this.slack.apiAsBot.chat.getPermalink({
                channel: this.channel,
                message_ts: this.ts
            });

            blocks.push(this.getContextBlock([`Follow the conversation <${permaLink.permalink}|here>`]));

            const lines = [];
            lines.push(actionMsg);

            if (this.ticket) {
                lines.push(`*${this.ticket.key} - ${this.ticket.fields.summary}*`);
                lines.push(`Current state: ${getIssueState(this.ticket, this.config)}`)
            }
            const text = lines.join("/n");

            const options: ChatPostMessageArguments = {
                text,
                blocks,
                channel: this.notificationChannelId
            };

            try {
                await this.slack.apiAsBot.chat.postMessage(options);
            } catch (e) {
                logger("Unable to send an update to the notification channel " +
                    "probably because the channel where this was initiated is " +
                    "private to the bot.  Error: " + e.toString());
            }
        }
    }

    /**
     * Posts a message to the right slack thread with a standard error format
     * @param msg
     * @param messageToUpdateTs If given, it will try and replace the given message
     * @param ephemeralUserId
     */
    public async addErrorReply(msg: string, messageToUpdateTs?: string, ephemeralUserId?: string) {
        await this.addReply({text: `:x: ${msg}`}, messageToUpdateTs, ephemeralUserId);
    }

    /**
     * This will add or replace a post to the right channel.  The slack payload given is the same as the payload
     * you would use when posting a message but it will handle replace an exisiting message if a `ts` is given.  It
     * then will return the created or updated ts if successful
     * @param messageParams
     * @param ts
     * @param ephemeralUser
     */
    public async addReply(messageParams: SlackPayload, ts?: string, ephemeralUser?: string): Promise<string> {
        if (ts) {
            const options: ChatUpdateArguments = Object.assign(
                {}, {
                    text: "",
                    channel: this.channel,
                    ts
                }, messageParams);


            try {
                const result = await this.slack.apiAsBot.chat.update(options);
                if (result.ok) {
                    return result.ts as string;
                }
            } catch (e) {
                logger("Exception thrown: Failed to update the top reply in the thread: " + e.toString());
            }

        } else {

            let options: ChatPostEphemeralArguments | ChatPostMessageArguments;
            if (ephemeralUser) {
                options = Object.assign({}, {
                    text: "",
                    channel: this.channel,
                    thread_ts: this.ts,
                    user: ephemeralUser
                }, messageParams)
            } else {
                options = Object.assign({}, {
                    text: "",
                    channel: this.channel,
                    thread_ts: this.ts
                }, messageParams) as ChatPostMessageArguments
            }

            try {
                let result;
                if (ephemeralUser) {
                    result = await this.slack.apiAsBot.chat.postEphemeral(options as ChatPostEphemeralArguments);
                } else {
                    result = await this.slack.apiAsBot.chat.postMessage(options as ChatPostMessageArguments);
                }

                if (result.ok) {
                    return result.ts as string;
                }
            } catch (e) {
                logger("Exception thrown: Unable to create a reply in the thread: " + e.toString());
            }
        }

        return undefined;
    }

    public async updateTopLevelMessage(msg?: string, slackUser?: SlackPayload, jiraUser?: JiraPayload) {

        const blocks = this.buildTextBlocks(msg, true, slackUser, jiraUser);
        const plainText = this.buildPlainTextString(msg, slackUser, jiraUser);

        // the source request was an APP post which means we can update it without extra permissions.
        await this.slack.apiAsBot.chat.update({
            channel: this.channel,
            ts: this.ts,
            as_user: true,
            text: plainText,
            blocks
        });
    }

    protected getSectionBlockFromText(sectionTitle: string, fields?: (PlainTextElement | MrkdwnElement)[]): (KnownBlock | Block) {
        return {
            type: "section",
            text: {
                type: "mrkdwn",
                text: sectionTitle
            },
            fields
        };
    }

    protected getContextBlock(text: string[]): (KnownBlock | Block) {
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

    /**
     * Creates the text blocks that should be used to as the thread's top level message.  If you want
     * a purely text-based version of this, then use the buildPlainTextString
     * @param customMsg
     * @param compact
     * @param slackUser
     * @param jiraUser
     */
    public buildTextBlocks(customMsg: string, compact: boolean, slackUser?: SlackPayload, jiraUser?: JiraPayload): (KnownBlock | Block)[] {

        const blocks: (KnownBlock | Block)[] = [];

        const state: RequestState = getIssueState(this.ticket, this.config);
        const icon = iconFromState(state, this.config);

        // Ticket Information (if a ticket is given)
        let description = "";
        if (this.ticket) {

            const fields = this.getParticipantsAsFields(slackUser, jiraUser);
            fields.push(this.getPriorityField());
            fields.push(this.getComponentField());

            const ticketLink: string = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const sectionTitle = `${icon} *<${ticketLink}|${this.ticket.key} - ${this.ticket.fields.summary}>*`;
            blocks.push(this.getSectionBlockFromText(sectionTitle, fields));

            description = this.ticket.fields.description || undefined;
        }

        if (customMsg) {
            blocks.push(this.getContextBlock([customMsg]));
        }

        // Add the description at the end so that only the description is hidden
        //  by Slack when the message is too long.
        if (description && !compact) {

            // Replace all newlines with quote markdown characters so that
            // it will appear with gray line to the left.  Also restrict the length
            //  of the output to < 3000 characters which is the limit for
            //  text blocks in slack.
            const indentedDescription = SlackThread.getIndentedDescription(description);

            blocks.push(this.getSectionBlockFromText("> " + indentedDescription));
        }

        return blocks.concat(this.buildActionBlocks());
    }

    public static getIndentedDescription(description: string) {
        return replaceAll(description,
            {"\n": "\n> "}).substr(0, 500);
    }

    private static getBestUserString(slackUser: SlackPayload, jiraUser: JiraPayload) {
        // Prefer to use the Slack user for rendering in slack.
        let userStr: string;
        if (slackUser) {
            userStr = `<@${slackUser.id}>`;
        } else if (jiraUser) {
            userStr = jiraUser.displayName;
        } else {
            userStr = "Unknown User";
        }
        return userStr;
    }

    /**
     * Sends a message to the reporter with information about the ticket
     * that was just completed and a link to the conversation where it all went down.
     */
    public async notifyReporterOfCompletion() {
        if (this.reporterSlackId) {
            const permalink = await this.getPermalink(this.channel, this.ts);
            const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const text = `:tada: Another one bites the dust!\nThe request you submitted (<${jiraLink}|${this.ticket.key}>) has been marked complete.  <${permalink}|Click here to visit the thread in Slack>`;
            await this.notifyUserDirectly(this.reporterSlackId, text);
        }
    }

    /**
     * Sends a message to the reporter with information about the ticket
     * that was just completed and a link to the conversation where it all went down.
     */
    public async notifyReporterOfClaimedTicket() {
        if (this.reporterSlackId) {
            const permalink = await this.getPermalink(this.channel, this.ts);
            const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const text = `:rocket: Guess what?\nThe request you submitted (<${jiraLink}|${this.ticket.key}>) has been claimed!  <${permalink}|Click here to visit the thread in Slack>`;
            await this.notifyUserDirectly(this.reporterSlackId, text);
        }
    }

    /**
     * Sends a message to the reporter with information about the ticket
     * that was just completed and a link to the conversation where it all went down.
     */
    public async notifyReporterOfCreatedTicket() {
        if (this.reporterSlackId) {
            const permalink = await this.getPermalink(this.channel, this.ts);
            const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const text = `:star: Nicely done!\nTicket <${jiraLink}|${this.ticket.key}> has been created and ` +
                `a <${permalink}|thread has been started>. Next steps are for someone on the team to claim ` +
                `your request and start work on it.  Use the slack thread referenced here to chat with your ` +
                `friendly helper.`;

            await this.notifyUserDirectly(this.reporterSlackId, text);
        }
    }

    /**
     * Sends a message to the reporter with information about the ticket
     * that was just completed and a link to the conversation where it all went down.
     */
    public async notifyReporterOfCancelledTicket() {
        if (this.reporterSlackId) {
            const permalink = await this.getPermalink(this.channel, this.ts);
            const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const text = `:face_with_hand_over_mouth: Hmmm...\nThe request you submitted (<${jiraLink}|${this.ticket.key}>) has been cancelled.  If that's a surprise to you, <${permalink}|check out the thread in the main service channel>`;
            await this.notifyUserDirectly(this.reporterSlackId, text);
        }
    }

    /**
     * Utility function to send a message to a user through direct message.
     * @param slackUserId The ID of the user to send to
     * @param msg The message to send.
     */
    public async notifyUserDirectly(slackUserId: string, msg: string) {
        const text = msg;
        const options: ChatPostMessageArguments = {
            text,
            blocks: [this.getSectionBlockFromText(msg)],
            channel: slackUserId,
            as_user: true
        };

        try {
            await this.slack.apiAsBot.chat.postMessage(options);
        } catch (e) {
            logger("Unable to notify the user directly probably because the app does not have the necessary permissions.  Error: " + e.toString());
        }
    }


    public buildActionBlocks() {
        const state = getIssueState(this.ticket, this.config);
        const actions = this.getMessageActions(state);

        const blocks: (KnownBlock | Block)[] = [];

        if (actions.length > 0) {
            blocks.push({
                type: "actions",
                block_id: "infra_request_actions",
                elements: actions.map((a) => {
                    return {
                        type: "button",
                        text: {
                            type: "plain_text",
                            emoji: true,
                            text: a.name
                        },
                        style: a.style,
                        value: a.code,
                        url: a.url ? a.url : undefined
                    };
                })
            });
        }
        return blocks;
    }

    /**
     * Used to render the right action buttons in a message based on issue properties.
     */
    private getMessageActions(state: RequestState): IssueAction[] {

        if (this.ticket) {
            const newViewButton = Object.assign({}, viewButton);
            newViewButton.url = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);

            if (state === RequestState.complete || state === RequestState.cancelled) {
                return [newViewButton];
            } else if (state === RequestState.todo) {
                return [claimButton, cancelButton, newViewButton];
            } else if (state === RequestState.claimed) {
                return [completeButton, cancelButton, newViewButton];
            }

            // ALL OTHER STATES WILL SHOW NO ACTIONS.
        }

        return [];
    }

    public buildPlainTextString(customMsg: string, slackUser?: SlackPayload, jiraUser?: JiraPayload): string {

        const lines: string[] = [];

        // Ticket Information (if a ticket is given)
        let description: string;
        if (this.ticket) {
            lines.push(`*${this.ticket.key} - ${this.ticket.fields.summary}*`);
            description = this.ticket.fields.description || undefined;
        }

        // This takes the fields and converts them to flat text.
        const participants = this.getParticipantsAsFields(slackUser, jiraUser);
        participants.forEach((p) => {
            lines.push(p.text)
        });

        // Add whatever custom message was passed into this (if any)
        if (customMsg) {
            lines.push(customMsg);
        }

        // Add the description at the end so that only the description is hidden
        //  by Slack when the message is too long.
        if (description) {
            lines.push(SlackThread.getIndentedDescription(description));
        }

        return lines.join("\n");
    };

    /**
     * This will ensure that either the given ticket has all the necessary
     * properties and values to allow this class to function as intended or
     * it will attempt to get more information.  Either way, it will return
     * the ticket with the new info.
     * @param ticket
     */
    protected async loadFullTicketDetails(ticket: JiraTicket): Promise<JiraTicket> {
        const label = moduleInstance.getActiveModuleConfig().REQUEST_JIRA_SERVICE_LABEL;
        const botProps = getNestedVal(ticket, `properties.${label}`);
        if (!botProps) {
            return await this.jira.api.issues.getIssue({
                issueIdOrKey: ticket.key,
                fields: ["*all"],
                properties: [label]
            });
        } else {
            return ticket;
        }
    }


    private getPriorityField(): (MrkdwnElement | PlainTextElement) {

        const jiraPriority = getNestedVal(this.ticket, "fields.priority");

        if (jiraPriority) {
            const priorityInfo = moduleInstance.preparedPriorities.find((p) => {
                return p.jiraId === jiraPriority.id
            });

            const emoji = getNestedVal(priorityInfo, 'slackEmoji');

            return {
                type: "mrkdwn",
                text: `*Priority*\n` +
                    `${emoji ? priorityInfo.slackEmoji : ""} ` +
                    `${jiraPriority.name}`
            }
        } else {
            return {
                type: "mrkdwn",
                text: `*Priority*\nNot Set`
            }
        }
    }

    private getComponentField(): (MrkdwnElement | PlainTextElement) {

        const components = getNestedVal(this.ticket, "fields.components");

        if (components) {
            const componentNames = components.map((c: any)=>c.name);

            return {
                type: "mrkdwn",
                text: `*Category*\n${componentNames.join(', ')}`
            }
        } else {
            return {
                type: "mrkdwn",
                text: `*Components*\nNot Set`
            }
        }
    }

    /**
     * This will take information about the slack or Jira user that performed the last action
     * and combine that with the known reporter of the issue to return two at most two field objects
     * that can be displayed as part of the top level issue message.
     * @param slackUser
     * @param jiraUser
     */
    private getParticipantsAsFields(slackUser: SlackPayload, jiraUser: JiraPayload): (MrkdwnElement | PlainTextElement)[] {

        const state = getIssueState(this.ticket, this.config);
        const userStr = SlackThread.getBestUserString(slackUser, jiraUser);

        const fields: (MrkdwnElement | PlainTextElement)[] = [
            {
                type: "mrkdwn",
                text: `*Reported by*\n<@${this.reporterSlackId}>`
            }
        ];


        if (state === RequestState.claimed) {
            fields.push({
                type: "mrkdwn",
                text: `*Claimed by*\n ${userStr}`
            });
        } else if (state === RequestState.complete) {
            fields.push({
                type: "mrkdwn",
                text: `*Completed by*\n ${userStr}`
            });
        } else if (state === RequestState.cancelled) {
            fields.push({
                type: "mrkdwn",
                text: `*Cancelled by*\n ${userStr}`
            });
        }

        return fields;
    }

}
