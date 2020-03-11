import assert from "assert";

import { IWebhookPayload, JiraConnection, JiraTicket } from "@nexus-switchboard/nexus-conn-jira";
import { SlackConnection, SlackPayload, SlackWebApiResponse } from "@nexus-switchboard/nexus-conn-slack";
import { findProperty, getNestedVal, hasOwnProperties, ModuleConfig } from "@nexus-switchboard/nexus-extend";

import { getCreateRequestModalView } from "./slack/createRequestModal";
import moduleInstance from "..";
import { logger } from "..";
import { SlackMessageId } from "./slackMessageId";
import { JiraIssueSidecarData, RequestThread } from "./requestThread";
import { prepTitleAndDescription, replaceAll } from "./util";

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
    reporterEmail?: string,
    components?: string[]
    labels?: string[];
}

export interface ServiceComponent {
    id: string,
    name: string,
    description: string
}

type JiraPayload = {
    [index: string]: any;
};

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
     * Analyzes a message payload and determine if it's a bot message from the given App ID.  If no
     * bot id is given then it just returns whether it's a bot message.
     * @param msg
     * @param username
     */
    public static isBotMessage(msg: SlackPayload, username: string) {
        if (msg.subtype && msg.subtype === "bot_message") {
            return msg.username.toLowerCase() === username.toLowerCase();
        } else {
            return false;
        }
    }

    // stored information about the slack thread associated with the request. You can use this
    //  to get things like the top level message, the first reply, and other useful utilities
    protected thread: RequestThread;

    protected slackToJiraUserMap: { [index: string]: JiraPayload };
    protected slackUserIdToProfileMap: { [index: string]: SlackPayload };

    protected initiatingSlackUser: SlackPayload;

    // stores the configuration information for the module.
    protected config: ModuleConfig;
    protected slack: SlackConnection;
    protected jira: JiraConnection;

    protected components: ServiceComponent[];

    // This is the user that acted last on the associated request.  This can be undefined which means that
    //  it was not a slack user that acted last on the request.  If this is undefined, then initiatingJiraUserId _should_
    //  be defined but that is not always the case.
    private readonly initiatingSlackUserId: string;

    // This is the user that acted last on the associated request from Jira.  This will be populated only
    //  when this object was created as a result of a webhook event.  Because the webhook event has
    //  all user data embedded in the event, we can just set the entire object.  Slack user is not always
    //  sent as part of the triggering event so there is a two-step process to load that information.
    readonly initiatingJiraUser: JiraPayload;

    // This is the data that was received which triggereed the creation of this object.  Only exists when
    //  the trigger came from Jira (as opposed to a slack action).
    private readonly jiraWebhookData: IWebhookPayload;

    private constructor(channel: string, ts: string, slackUserId?: string, jiraWebhookPayload?: IWebhookPayload) {
        this.config = moduleInstance.getActiveModuleConfig();
        this.slack = moduleInstance.getSlack();
        this.jira = moduleInstance.getJira();
        this.slackUserIdToProfileMap = {};
        this.slackToJiraUserMap = {};

        if (!this.config.REQUEST_JIRA_SERVICE_LABEL) {
            throw new Error("The REQUEST_JIRA_SERVICE_LABEL config must be set.");
        }

        this.thread = new RequestThread(ts, channel, this.slack, this.jira, this.config);
        this.initiatingSlackUserId = slackUserId;
        this.initiatingJiraUser = jiraWebhookPayload ? getNestedVal(jiraWebhookPayload, "user") : undefined;
        this.jiraWebhookData = jiraWebhookPayload;
    }

    /**
     * If true, then a Jira action is what triggered the creation of this thread.
     */
    public get isJiraTriggered(): boolean {
        return this.jiraWebhookData !== undefined;
    };

    /**
     * If true, then a slack action is what triggered the creation of this thread.
     */
    public get isSlackTriggered(): boolean {
        return this.initiatingSlackUserId !== undefined;
    };

    /**
     * Factory method to create a new Request object.  This should be called when you expect to have the ticket
     * already setup as a thread in the Slack channel.  This will attach to it and return the new ServiceRequest object
     * filled in with all the right values.
     * @param slackUserId
     * @param channelId
     * @param ts
     */
    public static async loadThreadFromSlackEvent(slackUserId: string, channelId: string, ts: string): Promise<ServiceRequest> {
        const request = new ServiceRequest(channelId, ts, slackUserId);
        await request.reset();
        return request;
    }

    /**
     * Factory method to create a new Request object.  This should be called when a Jira webhook has been called
     * because a registered event was triggered.
     * @param sideCardData
     * @param webhookPayload
     */
    public static async loadThreadFromJiraEvent(sideCardData: JiraIssueSidecarData,
                                                webhookPayload: IWebhookPayload): Promise<ServiceRequest> {

        const jiraAccountId = getNestedVal(webhookPayload, "user.accountId");
        if (!jiraAccountId) {
            logger("Couldn't identify the Jira user that triggered the webhook event so skipping creation of service request object");
            return undefined;
        }

        const request = new ServiceRequest(sideCardData.channelId, sideCardData.threadId, undefined, webhookPayload);
        await request.reset();
        return request;
    }

    /**
     * This static method should be used  when there is no existing thread for the request.  This will
     * do the work of posting the top level message and displaying the modal that collects input from the user.
     *
     * @param slackUserId
     * @param channelId
     * @param requestText
     * @param triggerId
     */
    public static async startNewRequest(slackUserId: string, channelId: string, requestText: string, triggerId: string) {

        const slack = moduleInstance.getSlack();
        const config = moduleInstance.getActiveModuleConfig();


        slack.apiAsBot.chat.postMessage({
                channel: channelId,
                text: `${config.REQUEST_EDITING_SLACK_ICON} <@${slackUserId}> is working on a new request:\n*${requestText ? requestText : "_No info on the request yet..._"}*`
            }
        ).then(async (response: SlackPayload) => {
            const messageTs = findProperty(response, "ts");
            const request = new ServiceRequest(channelId, messageTs, slackUserId);

            await request.reset();
            await request.showCreateModal(triggerId, {
                slackUserId,
                title: requestText
            });

            return request;
        });
    }

    public async setTicket(ticket: JiraTicket) {
        await this.thread.setTicket(ticket);
    }

    public get ticket(): JiraTicket {
        return this.thread.ticket;
    }

    /**
     * This is what should be called when someone has claimed an existing ticket (created with handleAddRequest)
     */
    public async claim(): Promise<void> {
        try {
            // Now verify that the ticket is actually in a state where it can be claimed.
            const statusCategory: string = getNestedVal(this.ticket, "fields.status.statusCategory.name");
            if (!statusCategory) {
                logger("Warning: Unable to determine status category of the ticket.  This could be because the jira ticket object json is malformed.");
            }

            if (statusCategory && statusCategory.toLowerCase() !== "to do") {
                await this.thread.addErrorReply("You can only claim tickets that haven't been started yet.");

            } else {
                const ticket = await this.claimJiraTicket();
                if (!ticket) {
                    await this.thread.addErrorReply("Failed to claim this ticket.  This could be for one of these reasons:\n " +
                        "1. The user in slack who is trying to claim the ticket does not have a Jira user (with the same email) \n" +
                        "2. The transition configuration for going from 'Open' to 'In Progress' is not correct in your .nexus file.\n" +
                        "3. The 'In Prgress' status configured does not match the status in the project");

                } else {
                    await this.setTicket(ticket);
                    await this.thread.update(undefined, this.initiatingSlackUser, this.initiatingJiraUser);
                }
            }
            // Now assign the user and set the ticket "in progress"
        } catch (e) {
            logger("Claim failed with " + e.toString());
            await this.thread.addErrorReply("The claim failed due to the following problem: " + e.message);
        }
    }

    public async cancel(): Promise<void> {

        try {
            // now let's try marking it as complete with the right resolution.
            const ticket = await this.markTicketComplete(this.ticket, this.config.REQUEST_JIRA_RESOLUTION_DISMISS);
            if (ticket) {
                await this.setTicket(ticket);
                await this.thread.update(undefined, this.initiatingSlackUser, this.initiatingJiraUser);
            } else {
                await this.thread.addErrorReply("Failed to cancel this ticket.  This could be for one of these reasons:\n " +
                    "1. The user in slack who is trying to cancel the ticket does not have a Jira user (with the same email)\n" +
                    "2. The transition configuration for going from the current state to 'Done/Complete' is not correct in your .nexus file.\n" +
                    "3. The statuses configured in .nexus do not match the status in the project");

            }

        } catch (e) {
            logger("Cancel failed with " + e.toString());
            await this.thread.addErrorReply("There was a problem closing the request: " + e.toString());
        }
    }

    public async complete(): Promise<void> {

        assert(this.thread, "Service Mod: Attempting to complete a ticket without a valid thread set");

        try {
            const ticket = await this.markTicketComplete(this.ticket, this.config.REQUEST_JIRA_RESOLUTION_DONE);
            if (ticket) {
                await this.setTicket(ticket);
                await this.thread.update(undefined, this.initiatingSlackUser, this.initiatingJiraUser);
            } else {
                await this.thread.addErrorReply("Failed to complete this ticket.  This could be for one of these reasons:\n " +
                    "1. The user in slack who is trying to complete the ticket does not have a Jira user (with the same email)\n" +
                    "2. The transition configuration for going from the current state to 'Done/Complete' is not correct in your .nexus file." +
                    "3. The statuses configured in .nexus do not match the status in the project");

            }
        } catch (e) {
            logger("Complete failed with " + e.toString());
            await this.thread.addErrorReply("There was a problem completing the request: " + e.toString());
        }
    }

    public getThread() : RequestThread {
        return this.thread;
    };

    public async create(params: IRequestParams): Promise<boolean> {

        try {

            await this.thread.update("Working on your request...",this.initiatingSlackUser, this.initiatingJiraUser);

            // check to see if there is already a request associated with this.
            if (this.ticket) {
                await this.thread.addErrorReply("There is already a request associated with this message: " +
                    `<${this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key)}|` +
                    `${this.ticket.key} - ${this.ticket.fields.summary}>`);
                return false;
            }

            // Now we will construct the ticket parameter starting with the labels.  We submit the
            //  encoded form of the slack message id in order to connect the jira ticket with the
            //  message which started it all.
            const requiredLabels = [`${this.config.REQUEST_JIRA_SERVICE_LABEL}-request`, this.thread.serializeId()];
            params.labels = params.labels ? requiredLabels.concat(params.labels) : requiredLabels;

            const ticket = await this.createTicket(params);
            if (ticket) {
                await this.setTicket(ticket);
                this.thread.reporterSlackId = this.initiatingSlackUserId;
                await this.thread.update(undefined, this.initiatingSlackUser, this.initiatingJiraUser);

                return true;
            } else {
                await this.thread.update("There was a problem submitting the issue to Jira.",this.initiatingSlackUser, this.initiatingJiraUser);
                return false;
            }
        } catch (e) {
            logger("Exception thrown: During ticket creation:  " + e.toString());
            return false;
        }
    }

    /**
     * Takes the given text and adds a comment to the associated jira ticket.
     * @param slackEventPayload
     */
    public async addCommentFromMessageEvent(slackEventPayload: SlackPayload): Promise<JiraPayload> {

        try {

            const messageTs = findProperty(slackEventPayload, "ts");
            const text = findProperty(slackEventPayload, "text");
            const permaLink = await this.slack.apiAsBot.chat.getPermalink({
                channel: this.thread.channel,
                message_ts: messageTs
            });

            const slackDisplayName =
                findProperty(this.initiatingSlackUser, "display_name") ||
                findProperty(this.initiatingSlackUser, "real_name");

            const nameReplacementText = await this.replaceSlackUserIdsWithNames(text);
            const finalText = `\n${nameReplacementText}\n~Comment posted in [Slack|${permaLink.permalink}] by ${slackDisplayName}~`;

            return await this.jira.api.issueComments.addComment({
                issueIdOrKey: this.ticket.key,
                body: this.jira.transformDescriptionText(finalText, 2)
            });
        } catch (e) {
            logger("Exception thrown: During an attempt to post a comment to Jira: " + e.toString());
            return undefined;
        }
    }


    /**
     * This will show the infra request modal and use the message that triggered it to prepopulate it.
     * @param triggerId
     * @param requestParams
     */
    protected async showCreateModal(triggerId: string, requestParams?: IRequestParams): Promise<boolean> {

        try {
            const requestId = this.thread.serializeId();
            const components = await this.getJiraComponents();

            if (components.length === 0) {
                logger("Failed to show modal because the project does not have any components");
                return false;
            }

            const modal = await this.slack.apiAsBot.views.open({
                trigger_id: triggerId,
                view: getCreateRequestModalView(requestParams, components, requestId)
            });

            return modal.ok;

        } catch (e) {
            logger("Exception thrown: Trying to show the create modal: " + e.toString());
            return false;
        }
    }

    protected async reset() {

        try {

            if (this.isSlackTriggered) {
                const ticket = await this.getTicketFromMessageId(this.thread.slackMessageId);

                if (ticket) {
                    this.setTicket(ticket);
                }

                this.initiatingSlackUser = await this.getSlackUser(this.initiatingSlackUserId);

            } else if (this.isJiraTriggered) {

                const issue = this.jiraWebhookData.issue;
                if (this.jiraWebhookData.properties){
                    const props:{[index: string]: any} = {};
                    this.jiraWebhookData.properties.forEach((prop: any) => {
                        props[prop.key] = prop.value;
                    });

                    issue.properties = props;
                }
                this.setTicket(issue);
            }
        } catch (e) {
            logger(`Exception thrown: Unable to find to reset the request object:` + e.toString());
        }
    }

    protected async getJiraUserFromEmail(email: string): Promise<JiraPayload> {
        try {
            if (email in this.slackToJiraUserMap) {
                return this.slackToJiraUserMap[email];
            }

            const users = await this.jira.api.userSearch.findUsers({
                query: email
            });
            if (users && users.length > 0) {
                this.slackToJiraUserMap[email] = users[0];
                return users[0];
            } else {
                return undefined;
            }

        } catch (e) {
            logger(`Unable to find a user with the email address ${email} due to the following error: ${e.message}`);
            return undefined;
        }
    }

    protected async getSlackUser(userId: string): Promise<SlackPayload> {
        try {
            if (userId in this.slackUserIdToProfileMap) {
                return this.slackUserIdToProfileMap[userId];
            }

            const userInfo = await this.slack.apiAsBot.users.info({ user: userId }) as SlackWebApiResponse;
            if (userInfo && userInfo.ok) {
                this.slackUserIdToProfileMap[userId] = userInfo.user;
                return userInfo.user;
            } else {
                return undefined;
            }
        } catch (e) {
            logger("Exception thrown: Trying to get user details from a user ID: " + e.toString());
            return undefined;
        }
    }

    /**
     * Search for a ticket based on a unique Slack TS value (slack timestamp).
     */
    protected async getTicketFromMessageId(message: SlackMessageId): Promise<any> {
        try {
            const label = this.config.REQUEST_JIRA_SERVICE_LABEL;
            const jql = `labels in ("${message.buildRequestId()}") and labels in ("${label}-request")`;
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
     * Creates a request ticket in Jira.
     */
    protected async createTicket(request: IRequestParams): Promise<JiraTicket> {
        try {
            // Get the priority ID from a given priority name.
            let priorityId = await this.jira.getPriorityIdFromName(request.priority);
            if (!priorityId) {
                logger(`Unable to find the priority "${request.priority}" so defaulting to medium (2)`);
                priorityId = 2;
            }

            // Note: In ticket creation, we remove invalid characters from title -
            //  jira will reject any summary that has a newline in it, for example
            // tslint:disable-next-line:prefer-const
            let { title, description } = prepTitleAndDescription(request.title, request.description);

            // Check to see if we need to show the name of the reporter.  We do this in the case
            //  where the reporter has a slack user but not a jira user.  In the latter case,
            //  we put the user's name in the description for reference.
            const jiraUser = await this.getJiraUserFromEmail(getNestedVal(this.initiatingSlackUser, "profile.email"));
            const fromName = jiraUser ? undefined : getNestedVal(this.initiatingSlackUser, "profile.real_name");

            if (fromName) {
                description += `\nSubmitted by ${fromName}`;
            }

            const params = {
                fields: {
                    summary: title,
                    description: this.jira.transformDescriptionText(description, 2),
                    project: {
                        key: this.config.REQUEST_JIRA_PROJECT
                    },
                    issuetype: {
                        id: this.config.REQUEST_JIRA_ISSUE_TYPE_ID
                    },
                    priority: {
                        id: priorityId.toString()
                    },
                    labels: request.labels || [],
                    components: request.components ? request.components.map((c) => {
                        return { id: c };
                    }) : []
                },
                properties: [
                    {
                        key: this.config.REQUEST_JIRA_SERVICE_LABEL,
                        value: {
                            channelId: this.thread.channel,
                            threadId: this.thread.ts,
                            actionMsgId: this.thread.actionMessageId.ts,
                            reporterSlackId: this.initiatingSlackUserId,
                            claimerSlackId: "",
                            closerSlackId: ""
                        }
                    }
                ]
            };

            // first create the issue
            const result = await this.jira.api.issues.createIssue(params);

            // we purposely set the epic after the ticket is created to avoid an epic setting error from
            //  preventing  ticket creation.  Sometimes, depending on the configuration of the project, this may
            //  fail while the basic values in the initial ticket creation will almost always succeed.
            if (this.config.REQUEST_JIRA_EPIC) {
                await this.setEpic(result.key, this.config.REQUEST_JIRA_EPIC);
            }

            // we purposely set the reporter after the ticket is created to avoid a reporter setting error from
            //  preventing  ticket creation.  Sometimes, depending on the configuration of the project, this may
            //  fail while the basic values in the initial ticket creation will almost always succeed.
            if (jiraUser) {
                await this.setReporter(result.key, jiraUser);
            }

            return await this.getJiraIssue(result.key);

        } catch (e) {
            logger("JIRA createIssue failed: " + e.toString());
            return undefined;
        }
    }

    /**
     * Puts a request in progress using the given key to find the existing ticket and the given
     * email to set the assignee.
     */
    protected async claimJiraTicket(): Promise<JiraTicket> {
        if (!this.ticket) {
            throw new Error("The jira ticket to claim has not yet been loaded.");
        }

        if (!this.config || !hasOwnProperties(this.config, [
            "REQUEST_JIRA_START_TRANSITION_ID"])) {
            throw Error("Necessary configuration values for infra module not found for this action");
        }

        try {
            const email = getNestedVal(this.initiatingSlackUser, "profile.email");
            const jiraUser = email ? await this.getJiraUserFromEmail(email) : undefined;
            if (jiraUser) {
                try {
                    await this.jira.api.issues.assignIssue({
                        issueIdOrKey: this.ticket.key,
                        accountId: jiraUser.accountId
                    });
                } catch (e) {
                    logger("Exception thrown: Unable to  assign issue to given user: " + e.toString());
                    return null;
                }
            }

            await this.jira.api.issues.transitionIssue({
                issueIdOrKey: this.ticket.key,
                transition: {
                    id: this.config.REQUEST_JIRA_START_TRANSITION_ID // Start Progress
                },
                fields: undefined,
                update: undefined,
                historyMetadata: undefined,
                properties: undefined
            });

            await this.updateIssueProperties({
                claimerSlackId: this.initiatingSlackUserId
            });

            return await this.getJiraIssue(this.ticket.key);
        } catch (e) {
            logger("Exception thrown: Unable to transition the given issue: " + e.toString());
            return undefined;
        }
    }


    /**
     * This will save the infrabot properties on the  associated jira ticket (in  Jira).  This includes
     * the action message ID and the originating slack user.
     */
    protected async updateIssueProperties(updates: any) {
        if (!this.ticket) {
            return;
        }

        const label = this.config.REQUEST_JIRA_SERVICE_LABEL;
        const botProps = getNestedVal(this.ticket, `properties.${label}`);
        const updatedBotProps = Object.assign({ propertyKey: label, issueIdOrKey: this.ticket.key }, botProps, updates);

        try {
            await this.jira.api.issueProperties.setIssueProperty(updatedBotProps);
        } catch (e) {
            logger("Exception thrown: Unable to set issue property data on an issue: " + e.toString());
        }
    }

    /**
     * Marks the given request as complete with  the  given resolution   value.
     */
    protected async markTicketComplete(ticket: JiraTicket, resolutionName: string): Promise<JiraTicket> {

        let resolutionId = await this.jira.getResolutionIdFromName(resolutionName);
        if (!resolutionId) {
            logger(`Unable to find the resolution "${resolutionName}" so defaulting to 'Done'`);
            resolutionId = 1; // Done
        }

        if (!this.config || !hasOwnProperties(this.config, [
            "REQUEST_JIRA_COMPLETE_TRANSITION_ID"])) {
            throw Error("Necessary configuration values for infra module not found for this action");
        }

        try {
            await this.jira.api.issues.transitionIssue({
                issueIdOrKey: ticket.key,
                transition: {
                    id: this.config.REQUEST_JIRA_COMPLETE_TRANSITION_ID
                },
                fields: {
                    resolution: {
                        id: resolutionId
                    }
                },
                update: undefined,
                historyMetadata: undefined,
                properties: undefined
            });

            await this.updateIssueProperties({
                closerSlackId: this.initiatingSlackUserId
            });

            return await this.getJiraIssue(ticket.key);

        } catch (e) {
            logger("Unable to transition the given issue: " + e.toString());
            return undefined;
        }
    }

    /**
     * Use this to pull jira issues from Jira.  This will ensure that the
     * object returned will contain the necessary properties to function
     * properly.
     * @param key
     */
    private async getJiraIssue(key: string): Promise<JiraTicket> {
        const label = this.config.REQUEST_JIRA_SERVICE_LABEL;
        return await this.jira.api.issues.getIssue({
            issueIdOrKey: key,
            fields: ["*all"],
            properties: [label]
        });
    }

    /**
     * For a given string, this will find all slack user IDs in the form <@{ID}>
     *     and replace with the actual name of the user (if found).
     * @param msg The message to search for slack user IDs in.
     * @return The message with replacements made.
     */
    private async replaceSlackUserIdsWithNames(msg: string): Promise<string> {
        const ids: Record<string, any> = {};
        for (const m of msg.matchAll(/<@(?<id>[A-Z0-9]*)>/gi)) {
            ids[m.groups.id] = "";
        }

        const replacements: Record<string, any> = {};
        if (Object.keys(ids).length > 0) {
            await Promise.all(Object.keys(ids).map(async (id) => {
                return this.getSlackUser(id)
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

    private async setReporter(jiraKey: string, user: JiraPayload) {
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


    private async setEpic(jiraKey: string, epicKey: string) {
        // now try and set the epic. This may not always be allowed because the project is not setup
        // to set the epic on creation (or at all).
        try {
            const fields: Record<string, any> = {};
            const params = {
                issueIdOrKey: jiraKey,
                fields
            };

            if (this.config.REQUEST_JIRA_EPIC_LINK_FIELD) {
                const epicLinkField: string = this.config.REQUEST_JIRA_EPIC_LINK_FIELD;
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

    /**
     * Retrieves all the components for the configured service project.  If the components havae already
     * been retrieved for this instance of the request, then return them without making a request to jira.
     */
    private async getJiraComponents(): Promise<ServiceComponent[]> {

        if (this.components) {
            return this.components;
        }

        try {
            const components = await this.jira.api.projectComponents.getProjectComponents({
                projectIdOrKey: this.config.REQUEST_JIRA_PROJECT
            });

            this.components = components.map((c: JiraPayload) => {
                return {
                    id: c.id,
                    name: c.name,
                    description: c.description
                };
            });

            return this.components;

        } catch (e) {
            logger("Exception thrown: Cannot retrieve components from Jira: " + e.toString());
            return [];
        }
    }
}
