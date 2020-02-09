import {ChatPostMessageArguments, ChatUpdateArguments} from "@slack/web-api";
import assert from "assert";
import _ from "lodash";

import {JiraConnection, JiraTicket} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection, SlackMessage, SlackPayload, SlackWebApiResponse} from "@nexus-switchboard/nexus-conn-slack";
import {findProperty, getNestedVal, hasOwnProperties, NexusModuleConfig} from "@nexus-switchboard/nexus-extend";

import {dlgServiceRequest, msgRequestSubmitted} from "./slack/blocks";
import moduleInstance from "..";
import {logger} from "..";
import {SlackMessageId} from "./slackMessageId";

const claimButton: IssueAction = {
    code: "claim_request",
    name: "Claim",
    style: "primary"
};

const cancelButton: IssueAction = {
    code: "cancel_request",
    name: "Cancel",
    style: "danger"
};

const completeButton: IssueAction = {
    code: "complete_request",
    name: "Complete",
    style: "primary"
};

export interface IRequestParams {
    slackUserId?: string;
    title?: string;
    description?: string;
    labels?: string[];
    priority?: string;
    messageTs?: string;
    channelId?: string;
    reporterEmail?: string;
}

type JiraPayload = {
    [index: string]: any;
};

export type IssueAction = {
    code: string,
    name: string,
    style?: "primary" | "danger"
};

type UserType = "claimer" | "reporter" | "closer";

/**
 * We group user definitions in all integrations to make sure we can keep both in sync.
 */
type RequestUser = {
    slack: SlackPayload;
    jira: JiraPayload;
};

/**
 * A list of all the user types that could be engaged in this request.  In most cases, these are not
 * filled in for a given request (it depends on the request).
 */
type UsersInvolved = {
    [index in UserType]: RequestUser;
};

/**
 * Represents a single service request.  A service request is sourced in Jira and can be managed through Slack.
 * This class helps maintaining state and performing actions related to the associated request.
 */
export default class ServiceRequest {

    /**
     * Analyzes a message payload and determine if it's a bot message from the given App ID.  If no
     * bot id is given then it just returns whether it's a bot message.
     * @param msg
     * @param botId
     */
    public static isBotMessage(msg: SlackPayload, botId: string) {
        if (msg.subtype && msg.subtype === "bot_message") {
            return msg.bot_id === botId;
        } else {
            return false;
        }
    }

    /**
     * Does a search for a given user based on their email.  Note that this will return an array if there are multiple
     * users with the same email query given (in  the case where you send only a partial email perhaps).  In those cases
     * it will return  the first one found.
     * @param email The email address to search for.
     */
    protected jiraTicket: JiraTicket;

    protected slackMessageId: SlackMessageId;

    protected infraConfig: NexusModuleConfig;

    protected users: UsersInvolved;

    protected slackConnection: SlackConnection;
    protected jiraConnection: JiraConnection;

    constructor(channel: string, ts: string) {

        this.reset(new SlackMessageId(channel, ts));

        this.infraConfig = moduleInstance.getActiveConfig();
        this.slackConnection = moduleInstance.getSlack();
        this.jiraConnection = moduleInstance.getJira();
    }

    public async startDetailCollection(reportingUserId: string, requestText: string, triggerId: string) {

        this.slackConnection.apiAsBot.chat.postMessage({
                channel: this.slackMessageId.channel,
                text: `Request posted by <@${reportingUserId}>: ${requestText}`,
                blocks: msgRequestSubmitted(reportingUserId, requestText, "Gathering Details")
            }
        ).then(async (response: SlackPayload) => {
            const messageTs = findProperty(response, "ts");
            const request = new ServiceRequest(this.slackMessageId.channel, messageTs);

            await request.showCreateModal(triggerId, {
                slackUserId: reportingUserId,
                title: requestText
            });
        });
    }

    /**
     * This is what should be called when someone has claimed an existing ticket (created with handleAddRequest
     * @param slackIdOfUserClaiming
     */
    public async claim(slackIdOfUserClaiming: string): Promise<void> {
        assert(this.slackMessageId, "Service Mod: Attempting to claim a ticket  without a valid slack message ID");

        try {
            await this.loadRequest();
            assert(this.jiraTicket, "Service Mod: Attempting to claim a ticket without a valid jira ticket loaded");

            await this.loadUser("claimer", slackIdOfUserClaiming);
            assert(this.users.claimer.slack, "Service Mod: Attempting to claim a ticket without a " +
                "valid 'claimer' user loaded");

            // Now verify that the ticket is actually in a state where it can be claimed.
            const statusCategory:string = getNestedVal(this.jiraTicket, "fields.status.statusCategory.name");
            if (!statusCategory) {
                logger("Warning: Unable to determine status category of the ticket.  This could be because the jira ticket object json is malformed.");
            }

            if (statusCategory && statusCategory.toLowerCase() !== "to do") {
                await this.postRequestActionError("You can only claim tickets that haven't been started yet.");

            } else {
                const ticket = await this.claimJiraTicket(this.users.claimer, this.jiraTicket);
                if (!ticket) {
                    await this.postRequestActionError("Failed to claim this ticket " +
                        "possibly because the email associated with your slack account is different than the " +
                        "one in Jira.");

                } else {
                    await this.postRequestActionSuccess(
                        `<@${this.users.claimer.slack.id}> was assigned to ticket ${ticket.key}`);
                }
            }
            // Now assign the user and set the ticket "in progress"
        } catch (e) {
            logger("Claim failed with " + e.toString());
            await this.postRequestActionError("The claim failed due to the following problem: " + e.message);
        }
    }

    public async cancel(slackIdOfUserClosing: string): Promise<void> {

        assert(this.slackMessageId, "Service Mod: Attempting to cancel a ticket without a valid slackMessageId set");

        try {
            await this.loadRequest();
            assert(this.jiraTicket, "Service Mod: Attempting to cancel a ticket without a valid jira ticket loaded");

            await this.loadUser("closer", slackIdOfUserClosing);
            assert(this.users.closer, "Service Mod: Attempting to cancel a ticket without a " +
                "valid 'closer' user loaded");

            // now let's try marking it as complete with the right resolution.
            await this.markTicketComplete(this.jiraTicket, this.infraConfig.REQUEST_JIRA_RESOLUTION_DISMISS);
            await this.postRequestActionSuccess(`<@${this.users.closer.slack.id}> successfully dismissed the request.`);

        } catch (e) {
            await this.postRequestActionError("There was a problem closing the request: " + e.toString());
        }
    }

    public async complete(slackIdOfUserCompleting: string) {

        assert(this.slackMessageId, "Service Mod: Attempting to complete a ticket without a valid slackMessageId set");

        try {
            await this.loadRequest();
            assert(this.jiraTicket, "Service Mod: Attempting to cancel a ticket without a valid jiraTicket loaded");

            await this.loadUser("closer", slackIdOfUserCompleting);
            assert(this.users.closer, "Service Mod: Attempting to cancel a ticket without a 'closing' user loaded");

            await this.markTicketComplete(this.jiraTicket, this.infraConfig.REQUEST_JIRA_RESOLUTION_DONE);
            await this.postRequestActionSuccess(`<@${this.users.closer.slack.id}>  successfully marked the request as complete`);

            return true;
        } catch (e) {
            logger("Exception thrown during marking request complete: " + e.toString());
            await this.postRequestActionError("There was a problem completing the request: " + e.toString());

            return false;
        }
    }

    public async create(params: IRequestParams): Promise<boolean> {

        await this.updateTopLevelMessage("Creating ticket...", params.title, params.slackUserId);

        // First let's get information about the user who submitted the request.  We'll use this
        //  to set the reporter on the ticket.
        if (!await this.loadUser("reporter", params.slackUserId)) {
            await this.postRequestActionError("For some reason I couldn't get information about the " +
                "person who posted the initial message");

            return false;
        }

        // check to see if there is already a request associated with this.
        const existingTicket = await this.findJiraTicketBySlackMessage(this.slackMessageId);
        if (existingTicket) {
            await this.postRequestActionError("There is already a request associated with this message: " +
                `<${this.jiraConnection.keyToWebLink(this.infraConfig.JIRA_HOST, existingTicket.key)}|` +
                `${existingTicket.key} - ${existingTicket.fields.summary}>`);
            return false;
        }

        // Now we will construct the ticket parameter starting with the labels.  We submit the
        //  encoded form of the slack message id in order to connect the jira ticket with the
        //  message which started it all.
        const requiredLabels = ["infrabot-request", this.slackMessageId.buildRequestId()];
        params.labels = params.labels ? requiredLabels.concat(params.labels) : requiredLabels;

        const ticket = await this.createTicket(params);

        // DEBUGGING: Comment the above expression and uncomment the below to test this method
        //  without adding a new ticket every time.
        // const ticket = await findJiraTicketBySlackMessage(infraConfig, "1577815243.000200");

        if (ticket) {
            this.jiraTicket = ticket;

            // Generate the slack message that has all the actions that can be performed on the request
            //  after it has been created.
            const reply = this.issueToSlackMessage(
                `A request has been started by <@${this.users.reporter.slack.id}> `, ticket,
                [claimButton, completeButton, cancelButton]);

            const originalMessage = await this.findStatusReplyMessage();
            const originalTs = originalMessage ? originalMessage.ts : undefined;
            await this.postRequestActionUpdate(reply, originalTs);

            this.updateTopLevelMessage("Ticket created", this.jiraTicket.fields.summary,
                this.users.reporter.slack.id);

            return true;
        } else {
            return false;
        }
    }

    /**
     * Posts a message to the right slack thread with a standard error format
     * @param msg
     * @param messageToUpdateTs If given, it will try and replace the given message
     */
    public async postRequestActionError(msg: string, messageToUpdateTs?: string) {
        return this.postRequestActionUpdate({text: `:x: ${msg}`}, messageToUpdateTs);
    }

    /**
     * Posts a message to the right slack thread with a standard success format.
     * @param msg
     * @param messageToUpdateTs If given, it will try and replace the given message
     */
    public async postRequestActionSuccess(msg: string, messageToUpdateTs?: string) {
        return this.postRequestActionUpdate({text: `:white_check_mark: ${msg}`}, messageToUpdateTs);
    }

    /**
     * This will add or replace a post to the right channel.  The slack payload given is the same as the payload
     * you would use when posting a message but it will handle things like
     * @param messageParams
     * @param updateSpecificMessageTs
     */
    public async postRequestActionUpdate(messageParams: SlackPayload, updateSpecificMessageTs?: string) {
        assert(this.slackMessageId.valid(), "Service Mod: Attempting to post a slack update for a ticket without a valid slack message ID");

        if (updateSpecificMessageTs) {
            const options: ChatUpdateArguments = Object.assign(
                {}, {
                    text: "",
                    channel: this.slackMessageId.channel,
                    ts: this.slackMessageId.ts
                }, messageParams);

            return await this.slackConnection.apiAsBot.chat.update(options);
        } else {
            const options: ChatPostMessageArguments = Object.assign({}, {
                text: "",
                channel: this.slackMessageId.channel,
                thread_ts: this.slackMessageId.ts
            }, messageParams);

            return await this.slackConnection.apiAsBot.chat.postMessage(options);
        }
    }

    public async addComment(text: string): Promise<JiraPayload> {
        assert(this.slackMessageId.valid(), "Service Mod: Attempting to add a ticket comment without a valid slack message ID");
        assert(this.jiraTicket, "Service Mod: Attempting to add a ticket comment without a valid jiraTicket");

        return await this.jiraConnection.api.issueComments.addComment({
            issueIdOrKey: this.jiraTicket.key,
            body: this.jiraConnection.transformDescriptionText(text, 2)
        });
    }

    /**
     * Attempts to find and store the jira ticket associated with the stored or given message Id.  If successful,
     * the jiraTicket property is set and associated values are reset.
     * @param messageId The ID of the message (a combination of channel and ts)
     */
    public async loadRequest(messageId?: SlackMessageId): Promise<boolean> {

        if (!messageId) {
            messageId = this.slackMessageId;
        }

        const messageIsDifferent = !this.slackMessageId || !_.isEqual(messageId, this.slackMessageId);

        // If the message in the instance is not set or different than the one given, then
        //  (re)initialize the request-related properties in the instance.
        if (messageIsDifferent) {
            this.reset(this.slackMessageId);
        }

        // Only load a new ticket if it's different
        if (!this.jiraTicket || messageIsDifferent) {
            this.jiraTicket = await this.findJiraTicketBySlackMessage(messageId);
        }

        return !!(this.jiraTicket);
    }

    /**
     * Converts a slack user to a jira user object.
     * @param slackUserId
     */
    public async getUserInfoFromSlackUserId(slackUserId: string): Promise<RequestUser> {
        const slackUser = await this.getSlackUser(slackUserId);
        if (slackUser) {
            return {
                slack: slackUser,
                jira: await this.getJiraUser(slackUser.profile.email)
            };
        } else {
            return undefined;
        }
    }

    public async updateTopLevelMessage(newState: string, requestText: string, slackUserId: string) {

        // the source request was an APP post which means we can update it without extra permissions.
        await this.slackConnection.apiAsBot.chat.update({
            channel: this.slackMessageId.channel,
            ts: this.slackMessageId.ts,
            as_user: true,
            text: `${newState} - ${requestText}`,
            blocks: msgRequestSubmitted(slackUserId, requestText, newState)
        });
    }

    /**
     * This will show the infra request modal and use the message that triggered it to prepopulate it.
     * @param triggerId
     * @param requestParams
     */
    protected async showCreateModal(triggerId: string, requestParams?: IRequestParams): Promise<boolean> {

        assert(this.slackMessageId.valid(), "Service Mod: Attempting to show a slack modal for a ticket without a valid slack message ID");

        const requestId = this.slackMessageId.buildRequestId();

        const modal = await this.slackConnection.apiAsBot.views.open({
            trigger_id: triggerId,
            view: dlgServiceRequest(requestParams, requestId)
        });

        return modal.ok;
    }

    protected reset(messageId: SlackMessageId) {
        this.slackMessageId = messageId;

        this.users = {
            claimer: {
                slack: undefined,
                jira: undefined
            },
            reporter: {
                slack: undefined,
                jira: undefined
            },
            closer: {
                slack: undefined,
                jira: undefined
            }
        };
    }

    protected async getJiraUser(email: string): Promise<Record<string, any>> {

        try {
            const users = await this.jiraConnection.api.userSearch.findUsers({
                query: email
            });
            if (users && users.length > 0) {
                return users[0];
            } else {
                return undefined;
            }
        } catch (e) {
            logger(`Unable to find a user with the email address ${email} due to the following error: ${e.message}`);
            return undefined;
        }
    }

    /**
     * Loads the slack and jira user details from a given slack user ID
     * @param type
     * @param slackUserId
     */
    protected async loadUser(type: UserType, slackUserId: string): Promise<boolean> {

        if (!this.users[type].slack || this.users[type].slack.id !== slackUserId) {
            this.users[type] = await this.getUserInfoFromSlackUserId(slackUserId);
        }

        return !_.isUndefined(this.users[type].slack) && !_.isUndefined(this.users[type].jira);
    }

    protected async getSlackUser(userId: string): Promise<SlackPayload> {
        const userInfo = await this.slackConnection.apiAsBot.users.info({user: userId}) as SlackWebApiResponse;
        if (userInfo && userInfo.ok) {
            return userInfo.user;
        } else {
            return undefined;
        }
    }

    protected issueToSlackMessage(msg: string, issue: JiraTicket, actions: IssueAction[]): ChatPostMessageArguments {

        const issueLink = this.jiraConnection.keyToWebLink(this.infraConfig.JIRA_HOST, issue.key);

        return {
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `${msg}:\n*<${issueLink}|${issue.key} - ${issue.fields.summary}>*`
                    }
                },
                {
                    type: "section",
                    fields: [
                        {
                            type: "mrkdwn",
                            text: `*Reporter:*\n${issue.fields.reporter ? issue.fields.reporter.name : "Unknown"}`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Submitted On:*\n${this.jiraConnection.friendlyDateString(issue.fields.created)}`
                        }
                    ]
                },
                {
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
                            value: a.code
                        };
                    })
                }
            ]
        } as ChatPostMessageArguments;
    }

    /**
     * Creates a request ticket in Jira.
     */
    protected async createTicket(request: IRequestParams): Promise<JiraTicket> {
        assert(this.infraConfig.REQUEST_JIRA_ISSUE_TYPE_ID, "Service Mod: Attempting to create a ticket without a valid Jira Issue Type config  set");
        assert(this.infraConfig.REQUEST_JIRA_PROJECT, "Service Mod: Attempting to create a ticket without a valid Jira Project config  set");

        let priorityId = await this.jiraConnection.getPriorityIdFromName(request.priority);
        if (!priorityId) {
            logger(`Unable to find the priority "${request.priority}" so defaulting to medium (2)`);
            priorityId = 2;
        }

        try {
            // Note: In ticket creation, we remove invalid characters from title -
            //  jira will reject any summary that has a newline in it, for example

            const params = {
                fields: {
                    summary: this.cleanTitle(request.title),
                    description: this.jiraConnection.transformDescriptionText(
                        `${request.description || "No Description Given"}\n` +
                        `Submitted by ${this.users.reporter.slack.profile.real_name}`, 2),
                    project: {
                        key: this.infraConfig.REQUEST_JIRA_PROJECT
                    },
                    issuetype: {
                        id: this.infraConfig.REQUEST_JIRA_ISSUE_TYPE_ID
                    },
                    priority: {
                        id: priorityId.toString()
                    },
                    labels: request.labels || []
                }
            };

            // first create the issue
            const result = await this.jiraConnection.api.issues.createIssue(params);

            // we purposely set the epic after the ticket is created to avoid an epic setting error from
            //  preventing  ticket creation.  Sometimes, depending on the configuration of the project, this may
            //  fail while the basic values in the initial ticket creation will almost always succeed.
            if (this.infraConfig.REQUEST_JIRA_EPIC) {
                await this.setEpic(result.key, this.infraConfig.REQUEST_JIRA_EPIC);
            }

            // we purposely set the reporter after the ticket is created to avoid a reporter setting error from
            //  preventing  ticket creation.  Sometimes, depending on the configuration of the project, this may
            //  fail while the basic values in the initial ticket creation will almost always succeed.
            if (this.users.reporter.jira) {
                await this.setReporter(result.key, this.users.reporter.jira);
            }

            return await this.jiraConnection.api.issue.getIssue({issueIdOrKey: result.key});

        } catch (e) {
            logger("JIRA createIssue failed: " + e.toString());
            return undefined;
        }
    }

    /**
     * Puts a request in progress using the given key to find the existing ticket and the given
     * email to set the assignee.
     */
    protected async claimJiraTicket(user: RequestUser, ticket: JiraTicket): Promise<JiraTicket> {
        if (!user.slack || !user.jira) {
            throw new Error("Users have not been loaded prior to initiating a claim");
        }

        if (!ticket) {
            throw new Error("The jira ticket to claim has not yet been loaded.");
        }

        if (!this.infraConfig || !hasOwnProperties(this.infraConfig, [
            "REQUEST_JIRA_START_TRANSITION_ID"])) {
            throw Error("Necessary configuration values for infra module not found for this action");
        }

        try {
            if (user.jira) {
                try {
                    await this.jiraConnection.api.issues.assignIssue({
                        issueIdOrKey: ticket.key,
                        accountId: user.jira.accountId
                    });
                } catch (e) {
                    logger("Unable to  assign issue to given user: " + e.toString());
                    return null;
                }
            } else {
                try {
                    // verifies that  the  issue is there.
                    await this.jiraConnection.api.issue.getIssue({issueIdOrKey: ticket.key});
                } catch (e) {
                    logger("Unable to find the issue with ID" + ticket.key);
                    return null;
                }
            }

            await this.jiraConnection.api.issues.transitionIssue({
                issueIdOrKey: ticket.key,
                transition: {
                    id: this.infraConfig.REQUEST_JIRA_START_TRANSITION_ID, // Start Progress
                },
                fields: undefined,
                update: undefined,
                historyMetadata: undefined,
                properties: undefined
            });

            return await this.jiraConnection.api.issue.getIssue({issueIdOrKey: ticket.key});
        } catch (e) {
            logger("Unable to transition the given issue: " + e.toString());
            return undefined;
        }
    }

    /**
     * Marks the given request as complete with  the  given resolution   value.
     */
    protected async markTicketComplete(ticket: JiraTicket, resolutionName: string): Promise<JiraTicket> {

        let resolutionId = await this.jiraConnection.getResolutionIdFromName(resolutionName);
        if (!resolutionId) {
            logger(`Unable to find the resolution "${resolutionName}" so defaulting to 'Done'`);
            resolutionId = 1; // Done
        }

        if (!this.infraConfig || !hasOwnProperties(this.infraConfig, [
            "REQUEST_JIRA_COMPLETE_TRANSITION_ID"])) {
            throw Error("Necessary configuration values for infra module not found for this action");
        }

        try {
            await this.jiraConnection.api.issues.transitionIssue({
                issueIdOrKey: ticket.key,
                transition: {
                    id: this.infraConfig.REQUEST_JIRA_COMPLETE_TRANSITION_ID, // Start Progress
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

            return await this.jiraConnection.api.issue.getIssue({issueIdOrKey: ticket.key});

        } catch (e) {
            logger("Unable to transition the given issue: " + e.toString());
            return undefined;
        }
    }

    /**
     * Search for a ticket based on a unique Slack TS value (slack timestamp).
     */
    protected async findJiraTicketBySlackMessage(message: SlackMessageId): Promise<JiraTicket> {
        try {
            const jql = `labels in ("${message.buildRequestId()}") and labels in ("infrabot-request")`;
            logger("Running JQL tin find Slack Message: " + jql);
            const results = await this.jiraConnection.api.issueSearch.searchForIssuesUsingJqlPost({
                jql,
                fields: ["*all"]
            });

            if (results.total === 1) {
                return results.issues[0];
            } else if (results.total > 1) {
                logger("There was more than one ticket that had that label - returning the first one");
                return results.issues[0];
            } else {
                logger("A ticket could not be found that matches the slack message ID given: " + message.toString());
                return undefined;
            }
        } catch (e) {
            logger("Unable to search for tickets by slack ts field: " + e.toString());
            return undefined;
        }
    }

    protected async findStatusReplyMessage(): Promise<SlackMessage> {
        if (!this.slackMessageId.ts) {
            throw new Error("You cannot find a status reply without an existing source thread");
        }

        try {
            const messages = await this.slackConnection.getChannelThread(this.slackMessageId.channel,
                this.slackMessageId.ts);

            for (const m of messages) {
                if (m.text.toLowerCase().search("a request has been started") >= 0) {
                    return m;
                }
            }

            return undefined;
        } catch (e) {
            logger("Unable to find status reply message due to this error: " + e.toString());
            return undefined;
        }
    }

    protected cleanTitle(source: string): string {
        return source.replace(/\n/g, " ");
    }

    private async setReporter(jiraKey: string, user: JiraPayload) {
        // now try and set the reporter.  This may not be allowed because the API key being used
        //  does not have sufficient permissions.
        try {
            await this.jiraConnection.api.issues.editIssue({
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

            if (this.infraConfig.REQUEST_JIRA_EPIC_LINK_FIELD) {
                const epicLinkField: string = this.infraConfig.REQUEST_JIRA_EPIC_LINK_FIELD;
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
            await this.jiraConnection.api.issues.editIssue(params);
        } catch (e) {
            logger("Unable to set the epic possibly because the project is not setup properly: " +
                e.toString());
        }
    }
}
