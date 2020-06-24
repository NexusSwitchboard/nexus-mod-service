import {JiraConnection, JiraTicket} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection, SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import {getNestedVal, ModuleConfig} from "@nexus-switchboard/nexus-extend";

import {KnownBlock, Block, PlainTextElement, MrkdwnElement} from "@slack/types";
import {ChatPostMessageArguments, ChatPostEphemeralArguments, ChatUpdateArguments} from "@slack/web-api";

import moduleInstance from "..";
import {logger} from "..";
import {SlackMessageId} from "./slack/slackMessageId";
import {
    createEncodedSlackData, getIssueState, iconFromState, replaceAll,
    SlackRequestInfo
} from "./util";
import {Actor} from "./actor";
import {FlowState, STATE_UNKNOWN} from "./flows";

export type IssueAction = {
    code: string,
    name: string,
    style?: "primary" | "danger",
    url?: string
};

export type IssueField = {
    title: string,
    value: string
}

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

export type ChannelAssignments = {
    notificationChannelId: string,
    conversationChannelId: string
}

export enum RequestState {
    todo = "todo",
    claimed = "claimed",
    complete = "complete",
    cancelled = "cancelled",
    working = "working",
    error = "error",
    unknown = "unknown"
}

export interface IRequestParams {
    slackUserId?: string;
    title?: string;
    description?: string;
    priority?: string;
    messageTs?: string;
    channelId?: string;
    reporterEmail?: string;
    components?: string[];
    labels?: string[];
    notificationChannelId?: string
}

type JiraPayload = {
    [index: string]: any;
};

/**
 * The request state object contains all the information
 * necessary for the client side to render the request for the
 * user.  The request state is prepared by the flows.
 */
export interface IRequestState {
    state: FlowState;
    actions: IssueAction[];
    fields: IssueField[];
    icon: string
}

/**
 * Represents a single service request.  A service request is sourced in Jira and can be managed through Slack.
 * This class helps maintaining state and performing actions related to the associated request.
 *
 * There are a few use cases that can produce this class.  They are:
 *
 *  1. [Slack Trigger] A user has started a new request
 *  2. [Slack Trigger] A user has pressed one of the action buttons in the request thread in Slack.
 *  3. [Slack Trigger] A user has added a reply to the request thread in slack.
 *  4. [Jira Trigger] A jira user has made a change to the ticket in Jira that includes a change to one of the following:
 *                      a. Summary
 *                      b. Description
 *                      c. Status
 *
 *
 * The first thing we do in this class when it's instantiated is try to collect as much information as we can
 * from the payloads that triggered the event.  The event that occurred dictates how much data we get.
 *
 * When coming from Jira, we get a full Jira user object and a full Jira Ticket object.  We also have the information
 * that is stored in issue's hidden properties which include the action thread, the slack id of the user who submitted
 * the request, and possibly the slack ID of the user who claimed it and for the slack user ID of the closer.
 *
 * The initiating user is readonly and is an indication of the system that triggered the creation of this class.
 */
export default class ServiceRequest {

    /**
     * This is the current state of this request as it has been
     * set by the Flow.  The Flows understand state in a way that
     * request objects on their own do not.
     */
    private _state: IRequestState;

    /**
     * Keeps track of the number of update requests that have
     * been made since the last completed request.
     */
    private updateRequestCounter: number = 0;

    /**
     * Shortcut to the connection instance.
     */
    private readonly slack: SlackConnection;

    /**
     * Shortcut to the connection instance.
     */
    private readonly jira: JiraConnection;

    /**
     * Shortcut to the connection instance.
     */
    private readonly config: ModuleConfig;

    // This is the user that acted last on the associated request from Jira.  This will be populated only
    //  when this object was created as a result of a webhook event.  Because the webhook event has
    //  all user data embedded in the event, we can just set the entire object.  Slack user is not always
    //  sent as part of the triggering event so there is a two-step process to load that information.
    // private readonly initiatingJiraUser: JiraPayload;

    // This is the user that acted last on the associated request.  This can be undefined which means that
    //  it was not a slack user that acted last on the request.  If this is undefined, then initiatingJiraUserId _should_
    //  be defined but that is not always the case.
    public readonly triggerActionUser: Actor;

    // This is the data that was received which triggereed the creation of this object.  Only exists when
    //  the trigger came from Jira (as opposed to a slack action).
    private readonly jiraWebhookData: JiraPayload;

    public conversationMessage: SlackMessageId;
    public actionMessageId: SlackMessageId;

    protected _reporter: Actor;
    protected _claimer: Actor;
    protected _closer: Actor;

    protected _ticket: JiraTicket;

    readonly channelRestrictionMode: string;
    protected notificationChannel: string;

    protected cachedPermalinks: Record<string, string>;

    public constructor(conversationMsg: SlackMessageId, notificationChannelId?: string, slackUserId?: string, jiraWebhookPayload?: JiraPayload) {
        this.slack = moduleInstance.getSlack();
        this.jira = moduleInstance.getJira();
        this.config = moduleInstance.getActiveModuleConfig()

        if (!ServiceRequest.config.REQUEST_JIRA_SERVICE_LABEL) {
            throw new Error("The REQUEST_JIRA_SERVICE_LABEL config must be set.");
        }

        this.channelRestrictionMode = this.config.SLACK_CONVERSATION_RESTRICTION || "primary";
        this.conversationMessage = conversationMsg;
        this.cachedPermalinks = {};
        this.notificationChannel = (notificationChannelId === this.conversationMessage.channel) ? undefined : notificationChannelId;

        this.triggerActionUser = new Actor({
            slackUserId: slackUserId || undefined,
            jiraRawUser: jiraWebhookPayload ? getNestedVal(jiraWebhookPayload, "user") : undefined
        });

        this.jiraWebhookData = jiraWebhookPayload;

        this._state = {
            state: STATE_UNKNOWN,
            actions: [],
            fields: [],
            icon: ""
        }
    }

    public get state(): IRequestState {
        return this._state;
    }

    public set state(state: IRequestState) {
        this._state = state;
    }

    /**
     * If true, then a Jira action is what triggered the creation of this 
     */
    public get isJiraTriggered(): boolean {
        return this.triggerActionUser.source === "jira";
    };

    /**
     * If true, then a slack action is what triggered the creation of this 
     */
    public get isSlackTriggered(): boolean {
        return this.triggerActionUser.source === "slack";
    };

    /**
     * Ensures that the slack thread has been updated with the proper data given the last action
     * that was taken.  This will only allow one update at a time.  If multiple requests are sent
     * in quick session, only the first one will be processed.  Once it is complete, additional requests
     * will be handled.
     */
    public async updateSlackThread() {
        this.updateRequestCounter++;
        if (this.updateRequestCounter == 1){
            await this.update().finally(()=>{
                this.updateRequestCounter = 0;
            });
        }
    }


    /**
     * Re-initializes the request object by using the triggering user and conversation in slack.
     * It will re-load Jira ticket data using the slack data stored in the object.  Or, if the trigger was Jira,
     * it will use the stored jira event data to complete the ticket data and set the ticket.
     */
    public async init() {

        try {

            if (this.isSlackTriggered) {
                const ticket = await this.findTicketFromSlackData({
                    notificationChannel: this.notificationChannelId,
                    conversationMsg: this.conversationMessage
                });

                if (ticket) {
                    await this.setTicket(ticket);
                }

            } else if (this.isJiraTriggered) {

                const issue = this.jiraWebhookData.issue;
                if (this.jiraWebhookData.properties) {
                    const props: { [index: string]: any } = {};
                    this.jiraWebhookData.properties.forEach((prop: any) => {
                        props[prop.key] = prop.value;
                    });

                    issue.properties = props;
                }
                await this.setTicket(issue);
            }
        } catch (e) {
            logger(`Exception thrown: Unable to find to reset the request object:` + e.toString());
        }
    }

    /**
     * Search for a ticket based on a unique Slack TS value (slack timestamp).
     */
    protected async findTicketFromSlackData(slackData: SlackRequestInfo): Promise<any> {
        try {
            const label = ServiceRequest.config.REQUEST_JIRA_SERVICE_LABEL;
            const jql = `labels in ("${createEncodedSlackData(slackData)}") and labels in ("${label}-request")`;
            const results = await this.jira.api.issueSearch.searchForIssuesUsingJqlPost({
                jql,
                fields: ["*all"],
                properties: [label]
            });

            if (results.total >= 1) {
                return results.issues[0];
            } else {
                return undefined;
            }
        } catch (e) {
            logger("Exception thrown: Unable to search for tickets by slack ts field: " + e.toString());
            return undefined;
        }
    }

    /**
     * This will save the infrabot properties on the  associated jira ticket (in  Jira).  This includes
     * the action message ID and the originating slack user.
     */
    public async updateIssueProperties(updates: any) {
        if (!this.ticket) {
            return;
        }

        const label = ServiceRequest.config.REQUEST_JIRA_SERVICE_LABEL;
        const botProps = getNestedVal(this.ticket, `properties.${label}`);
        const updatedBotProps = Object.assign({propertyKey: label, issueIdOrKey: this.ticket.key}, botProps, updates);

        try {
            await this.jira.api.issueProperties.setIssueProperty(updatedBotProps);
        } catch (e) {
            logger("Exception thrown: Unable to set issue property data on an issue: " + e.toString());
        }
    }


    /**
     * Use this to pull jira issues from Jira.  This will ensure that the
     * object returned will contain the necessary properties to function
     * properly.
     * @param key
     */
    public async getJiraIssue(key: string): Promise<JiraTicket> {
        const label = ServiceRequest.config.REQUEST_JIRA_SERVICE_LABEL;
        return await this.jira.api.issues.getIssue({
            issueIdOrKey: key,
            fields: ["*all"],
            properties: [label]
        });
    }

    public async setReporter(jiraKey: string, user: JiraPayload) {
        // now try and set the reporter.  This may not be allowed because the API key being used
        //  does not have sufficient permissions.
        try {
            await this.jira.api.issues.editIssue({
                issueIdOrKey: jiraKey,
                fields: {
                    reporter: {
                        accountId: user.accountId || undefined
                    }
                }
            });
        } catch (e) {
            logger("Unable to set the reporter possibly because the API key given " +
                "does not have 'Modify Reporter' permissions: " + e.toString());
        }
    }


    public async setEpic(jiraKey: string, epicKey: string) {
        // now try and set the epic. This may not always be allowed because the project is not setup
        // to set the epic on creation (or at all).
        try {
            const fields: Record<string, any> = {};
            const params = {
                issueIdOrKey: jiraKey,
                fields
            };

            if (ServiceRequest.config.REQUEST_JIRA_EPIC_LINK_FIELD) {
                const epicLinkField: string = ServiceRequest.config.REQUEST_JIRA_EPIC_LINK_FIELD;
                params.fields[epicLinkField] = epicKey;
            } else {

                // if REQUEST_JIRA_EPIC_LINK_FIELD is not set then we assume that this is a new style
                // project where the relationship between epic and (other) is just a parent child relationship.
                params.fields = {
                    parent: {
                        key: epicKey
                    }
                };
            }
            await this.jira.api.issues.editIssue(params);
        } catch (e) {
            logger("Unable to set the epic possibly because the project is not setup properly: " +
                e.toString());
        }
    }

    public static get config() {
        return moduleInstance.getActiveModuleConfig();
    }



    public get reporter(): Actor {
        return this._reporter;
    }

    public set reporter(val: Actor) {
        this._reporter = val;
    }

    public get claimer(): Actor {
        return this._claimer;
    }

    public set claimer(val: Actor) {
        this._claimer = val;
    }

    public get closer(): Actor {
        return this._closer;
    }

    public set closer(val: Actor) {
        this._closer = val;
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
     * This associated a Jira ticket with this   When this happenss a few things are done:
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
        this.reporter = new Actor({slackUserId: botProps.reporterSlackId});
        this.claimer = new Actor({slackUserId: botProps.claimerSlackId});
        this.closer = new Actor({slackUserId: botProps.closerSlackId});
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

    /**
     * Updates the thread with the most recently known information about the status of the request.
     * @param customMsg
     */
    public async update(customMsg?: string) {
        try{
            const blocks = this.buildTextBlocks(customMsg, true);
            const plainText = this.buildPlainTextString(customMsg);

            // the source request was an APP post which means we can update it without extra permissions.
            await this.slack.apiAsBot.chat.update({
                channel: this.channel,
                ts: this.ts,
                as_user: true,
                text: plainText,
                blocks
            });
        } catch(e) {
            logger("Failed to update the request thread: " + e.toString());
        }
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

            const text = await this.renderMessageForSlack(actionMsg);
            const options: ChatPostMessageArguments = {
                text,
                blocks: [this.getSectionBlockFromText(text)],
                channel: this.notificationChannelId,
                as_user: true
            };

            try {
                await this.slack.apiAsBot.chat.postMessage(options);
            } catch (e) {
                logger("Unable to send a message to the notification channel probably because the app " +
                       "does not have the necessary permissions.  Error: " + e.toString());
            }
        }
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
     */
    public buildTextBlocks(customMsg?: string, compact?: boolean): (KnownBlock | Block)[] {

        const blocks: (KnownBlock | Block)[] = [];

        const state: RequestState = getIssueState(this.ticket, this.config);
        const icon = iconFromState(state, this.config);

        // Ticket Information (if a ticket is given)
        let description = "";
        if (this.ticket) {

            const fields = this.getStateFields();
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
            const indentedDescription = ServiceRequest.getIndentedDescription(description);

            blocks.push(this.getSectionBlockFromText("> " + indentedDescription));
        }

        return blocks.concat(this.buildActionBlocks());
    }

    public static getIndentedDescription(description: string) {
        return replaceAll(description,
            {"\n": "\n> "}).substr(0, 500);
    }

    public async renderMessageForSlack(text: string): Promise<string> {
        let permalink = "";
        if (text.indexOf("{{threadLink}}") > -1) {
            // only make a call to permalink if there is actually a variable in the
            //  in the string asking for it.
            permalink = await this.getPermalink(this.channel, this.ts);
        }

        const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);

        return replaceAll(text,
            {
                "{{reporter}}": this.reporter.getBestUserStringForSlack(),
                "{{claimer}}": this.claimer.getBestUserStringForSlack(),
                "{{closer}}": this.claimer.getBestUserStringForSlack(),
                "{{ticketKey}}": this.ticket ? this.ticket.key : "[Invalid]",
                "{{ticketLink}}": jiraLink,
                "{{threadLink}}": permalink
            });
    }


    /**
     * Utility function to send a message to a user through direct message.
     * @param actor The user to notify
     * @param msg The message to send.
     */
    public async postMsgToUser(actor: Actor, msg: string) {

        if (!actor.slackUserId) {
            throw new Error("Failed to notify user directly because slack user ID could not be found.  Message not sent: " + msg);
        }

        msg = await this.renderMessageForSlack(msg);

        const text = msg;
        const options: ChatPostMessageArguments = {
            text,
            blocks: [this.getSectionBlockFromText(msg)],
            channel: actor.slackUserId,
            as_user: true
        };

        try {
            await this.slack.apiAsBot.chat.postMessage(options);
        } catch (e) {
            logger("Unable to notify the user directly probably because the app does not have the necessary permissions.  Error: " + e.toString());
        }
    }


    public buildActionBlocks() {
        const actions = this.getMessageActions();

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
    private getMessageActions(): IssueAction[] {
        return this.state.actions;
    }

    public buildPlainTextString(customMsg?: string): string {

        const lines: string[] = [];

        // Ticket Information (if a ticket is given)
        let description: string;
        if (this.ticket) {
            lines.push(`*${this.ticket.key} - ${this.ticket.fields.summary}*`);
            description = this.ticket.fields.description || undefined;
        }

        // This takes the fields and converts them to flat text.
        const participants = this.getStateFields();
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
            lines.push(ServiceRequest.getIndentedDescription(description));
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

    /**
     * SLACK WIDGET
     * Assembles the priority field block so that it shows the accurate state of the
     * ticket's priority.
     */
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

    /**
     * SLACK WIDGET
     * Assembles the priority field block so that it shows the accurate state of the
     * ticket's priority.
     */
    private getComponentField(): (MrkdwnElement | PlainTextElement) {

        const components = getNestedVal(this.ticket, "fields.components");

        if (components) {
            const componentNames = components.map((c: any) => c.name);

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
     * SLACK WIDGET
     *
     * This will take information about the slack or Jira user that performed the last action
     * and combine that with the known reporter of the issue to return two at most two field objects
     * that can be displayed as part of the top level issue message.
     */
    private getStateFields(): (MrkdwnElement | PlainTextElement)[] {
        if (!this.state || !this.state.fields) {
            return [];
        }

        return this.state.fields.map((field) => {
            return {
                type:"mrkdwn",
                text:`*${field.title}*\n${field.value}`
            }
        });
    }



    /**
     * Analyzes a message payload and determine if it's a bot message from the given App ID.  If no
     * bot id is given then it just returns whether it's a bot message.
     * @param msg
     * @param specificBotname
     */
    public static isBotMessage(msg: SlackPayload, specificBotname?: string) {
        return msg.bot_profile && (!specificBotname || specificBotname === msg.bot_profile.name);
    }

}
