import {JiraConnection, JiraTicket} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection, SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import {getNestedVal, hasOwnProperties, findProperty, ModuleConfig} from "@nexus-switchboard/nexus-extend";
import {PagerDutyConnection} from "@nexus-switchboard/nexus-conn-pagerduty";

import {KnownBlock, Block, PlainTextElement, MrkdwnElement} from "@slack/types";
import {ChatPostMessageArguments, ChatPostEphemeralArguments, ChatUpdateArguments} from "@slack/web-api";

import moduleInstance from "..";
import {logger} from "..";
import {SlackMessageId} from "./slack/slackMessageId";
import {
    createEncodedSlackData, getIssueState, iconFromState, noop,
    prepTitleAndDescription, replaceAll, replaceSlackUserIdsWithNames,
    SlackRequestInfo
} from "./util";
import {Actor} from "./actor";
import {FlowState, STATE_NO_TICKET} from "./flows";


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
    private _state: FlowState = STATE_NO_TICKET;

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

    /**
     * Shortcut to the connection instance.
     */
    private readonly pagerDuty: PagerDutyConnection;

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
        this.pagerDuty = moduleInstance.getPagerDuty();
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

        this.state = STATE_NO_TICKET;
    }

    public get state(): FlowState {
        return this._state;
    }

    public set state(state: FlowState) {
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
            await this.update().then(()=>{
                this.updateRequestCounter = 0;
            }).finally(()=>{
                this.updateRequestCounter = 0;
            });
        }
    }

    /**
     * This is what should be called when someone has claimed an existing ticket
     */
    public async claim(): Promise<ServiceRequest> {
        try {
            // Now verify that the ticket is actually in a state where it can be claimed.
            const statusCategory: string = getNestedVal(this.ticket, "fields.status.statusCategory.name");
            if (!statusCategory) {
                logger("Warning: Unable to determine status category of the ticket.  This could be because the jira ticket object json is malformed.");
            }

            if (statusCategory && statusCategory.toLowerCase() === "to do") {
                const ticket = await this.claimJiraTicket();
                if (ticket) {
                    await this.setTicket(ticket);

                    const reporterStr = this.reporter.getBestUserStringForSlack();
                    const notificationMsg = `Ticket submitted by ${reporterStr} was claimed and started`;

                    this.postMsgToNotificationChannel(notificationMsg).then(noop);
                    this.notifyReporterOfClaimedTicket().then(noop);
                }
            }

        } catch (e) {
            logger("Claim failed with " + e.toString());
        }

        return this;
    }

    public async cancel(): Promise<ServiceRequest> {

        try {
            // now let's try marking it as complete with the right resolution.
            const ticket = await this.markTicketComplete(this.ticket, ServiceRequest.config.REQUEST_JIRA_RESOLUTION_DISMISS);
            if (ticket) {
                await this.setTicket(ticket);

                const reporterStr = this.reporter.getBestUserStringForSlack();
                const notificationMsg = `Ticket submitted by ${reporterStr} was closed without resolution`;

                this.postMsgToNotificationChannel(notificationMsg).then(noop);
                this.notifyReporterOfCancelledTicket().then(noop);
            }
        } catch (e) {
            logger("Cancel failed with " + e.toString());
        }

        return this;
    }

    public async complete(): Promise<ServiceRequest> {
        try {
            const ticket = await this.markTicketComplete(this.ticket, ServiceRequest.config.REQUEST_JIRA_RESOLUTION_DONE);
            if (ticket) {
                await this.setTicket(ticket);

                const reporterStr = this.reporter.getBestUserStringForSlack();
                const notificationMsg = `Ticket submitted by ${reporterStr} was completed`;

                await this.postMsgToNotificationChannel(notificationMsg);
                await this.notifyReporterOfCompletion()

            }
        } catch (e) {
            logger("Complete failed with " + e.toString());
        }

        return this;
    }

    public async commentFromSlack(payload: SlackPayload): Promise<boolean> {
        try {
            logger("Received thread comment - sending to Jira...");
            const messageTs = findProperty(payload, "ts");
            const text = findProperty(payload, "text");
            const permaLink = await this.slack.apiAsBot.chat.getPermalink({
                channel: this.channel,
                message_ts: messageTs
            });

            const slackUser = await this.triggerActionUser.getRawSlackUser();
            const slackDisplayName =
                findProperty(slackUser, "display_name") ||
                findProperty(slackUser, "real_name");

            const nameReplacementText = await replaceSlackUserIdsWithNames(text);
            const finalText = `\n${nameReplacementText}\n~Comment posted in [Slack|${permaLink.permalink}] by ${slackDisplayName}~`;

            const jiraPayload = await this.jira.api.issueComments.addComment({
                issueIdOrKey: this.ticket.key,
                body: this.jira.transformDescriptionText(finalText, 2)
            });

            return !!jiraPayload;

        } catch (e) {
            logger("Exception thrown: During an attempt to post a comment to Jira: " + e.toString());
            return false;
        }
    }

    public async create(params: IRequestParams): Promise<ServiceRequest> {

        try {

            // check to see if there is already a request associated with this.
            if (this.ticket) {
                logger("There is already a request associated with this message: " + this.ticket.key);
                return this;
            }

            // Now we will construct the ticket parameter starting with the labels.  We submit the
            //  encoded form of the slack message id in order to connect the jira ticket with the
            //  message which started it all.
            const requiredLabels = [`${ServiceRequest.config.REQUEST_JIRA_SERVICE_LABEL}-request`, this.serializeId()];
            params.labels = params.labels ? requiredLabels.concat(params.labels) : requiredLabels;

            this.reporter = this.triggerActionUser;
            const reporterStr = this.triggerActionUser.getBestUserStringForSlack();

            const ticket = await this.createTicket(params);
            if (ticket) {
                await this.setTicket(ticket);
                await this.updateSlackThread()

                //
                // POST A REPLY IN THE REQUEST THREAD
                //
                this.addReply({
                    blocks: this.getRequestReplyMsgBlocks(params)
                })
                    .catch((e) => {
                        logger("Exception thrown while posting to notification channel: " + e.toString());
                    })

                //
                // POST A MESSAGE IN THE NOTIFICATION CHANNEL
                //      (if request came from a non-primary channel)
                //
                this.postMsgToNotificationChannel(
                    `Request submitted by ${reporterStr} was created successfully`
                )
                    .catch((e) => {
                        logger("Exception thrown while posting to notification channel: " + e.toString());
                    });

                //
                // POST A DM TO THE REPORTER
                //      (if reporter slack ID is known)
                //
                this.notifyReporterOfCreatedTicket()
                    .catch((e) => {
                        logger("Exception thrown while posting to reporter's DM channel: " + e.toString());
                    });

                // // Now check to see if we need to send a pager duty alert
                // const priorityInfo = moduleInstance.lookupPriorityByJiraId(params.priority);
                // if (priorityInfo && priorityInfo.triggersPagerDuty) {
                //     this.createPagerDutyAlert(params).catch((e) => {
                //         logger("Exception thrown when trying to send pager duty alert: " + e.toString());
                //     });
                // }
            } else {
                await this.postMsgToNotificationChannel(
                    `Request submitted by ${reporterStr} failed to create a ticket.`);
            }
        } catch (e) {
            logger("Exception thrown: During ticket creation:  " + e.toString());

            await this.postMsgToNotificationChannel(
                "There was an error during ticket creation:" + e.toString());
        }

        return this;
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
     * Creates a request ticket in Jira.
     */
    protected async createTicket(request: IRequestParams): Promise<JiraTicket> {
        try {

            // Note: In ticket creation, we remove invalid characters from title -
            //  jira will reject any summary that has a newline in it, for example
            // tslint:disable-next-line:prefer-const
            let {title, description} = prepTitleAndDescription(request.title, request.description);

            // Check to see if we need to show the name of the reporter.  We do this in the case
            //  where the reporter has a slack user but not a jira user.  In the latter case,
            //  we put the user's name in the description for reference.
            await this.triggerActionUser.loadBestRawObject();
            const fromName = this.triggerActionUser.realName;

            if (fromName) {
                description += `\nSubmitted by ${fromName}`;
            }

            const params = {
                fields: {
                    summary: title,
                    description: this.jira.transformDescriptionText(description, 2),
                    project: {
                        key: ServiceRequest.config.REQUEST_JIRA_PROJECT
                    },
                    issuetype: {
                        id: ServiceRequest.config.REQUEST_JIRA_ISSUE_TYPE_ID
                    },
                    priority: {
                        id: request.priority
                    },
                    labels: request.labels || [],
                    components: request.components ? request.components.map((c) => {
                        return {id: c};
                    }) : []
                },
                properties: [
                    {
                        key: ServiceRequest.config.REQUEST_JIRA_SERVICE_LABEL,
                        value: {
                            channelId: this.channel,
                            threadId: this.ts,
                            actionMsgId: this.actionMessageId ? this.actionMessageId.ts : "",
                            notificationChannelId: this.notificationChannelId,
                            reporterSlackId: this.triggerActionUser.slackUserId,
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
            if (ServiceRequest.config.REQUEST_JIRA_EPIC) {
                await this.setEpic(result.key, ServiceRequest.config.REQUEST_JIRA_EPIC);
            }

            // we purposely set the reporter after the ticket is created to avoid a reporter setting error from
            //  preventing  ticket creation.  Sometimes, depending on the configuration of the project, this may
            //  fail while the basic values in the initial ticket creation will almost always succeed.
            const jiraUser = await this.triggerActionUser.getRawJiraUser();
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
     * Creates a PagerDuty alert if priority is critical
     */
    public async createPagerDutyAlert(request: IRequestParams) {
        try {
            const ticketLink = this.jira.keyToWebLink(ServiceRequest.config.JIRA_HOST, this.ticket.key);
            let description = `${this.ticket.key}\n${ticketLink}\n-----\n`;
            if (!request.description) {
                description += "No description given";
            } else {
                description += request.description;
            }

            // create an alert in pagerduty
            return await this.pagerDuty.api.incidents.createIncident(
                ServiceRequest.config.PAGERDUTY_FROM_EMAIL,
                {
                    incident: {
                        type: "incident",
                        title: `${this.ticket.key} - ${this.ticket.summary}`,
                        service: {
                            id: ServiceRequest.config.PAGERDUTY_SERVICE_DEFAULT,
                            type: "service_reference"
                        },
                        body: {
                            type: "incident_body",
                            details: description
                        },
                        escalation_policy: {
                            id: ServiceRequest.config.PAGERDUTY_ESCALATION_POLICY_DEFAULT,
                            type: "escalation_policy_reference"
                        }
                    }
                });
        } catch (e) {
            logger("PagerDuty alert failed: " + e.toString());
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

        if (!ServiceRequest.config || !hasOwnProperties(ServiceRequest.config, [
            "REQUEST_JIRA_START_TRANSITION_ID"])) {
            throw Error("Necessary configuration values for infra module not found for this action");
        }

        try {
            await this.triggerActionUser.loadBestRawObject();
            const jiraUser = await this.triggerActionUser.getRawJiraUser();
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
                    id: ServiceRequest.config.REQUEST_JIRA_START_TRANSITION_ID // Start Progress
                },
                fields: undefined,
                update: undefined,
                historyMetadata: undefined,
                properties: undefined
            });

            await this.updateIssueProperties({
                claimerSlackId: this.triggerActionUser.slackUserId
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
     * Marks the given request as complete with  the  given resolution   value.
     */
    protected async markTicketComplete(ticket: JiraTicket, resolutionName: string): Promise<JiraTicket> {

        let resolutionId = await this.jira.getResolutionIdFromName(resolutionName);
        if (!resolutionId) {
            logger(`Unable to find the resolution "${resolutionName}" so defaulting to 'Done'`);
            resolutionId = 1; // Done
        }

        if (!ServiceRequest.config || !hasOwnProperties(ServiceRequest.config, [
            "REQUEST_JIRA_COMPLETE_TRANSITION_ID"])) {
            throw Error("Necessary configuration values for infra module not found for this action");
        }

        try {
            await this.jira.api.issues.transitionIssue({
                issueIdOrKey: ticket.key,
                transition: {
                    id: ServiceRequest.config.REQUEST_JIRA_COMPLETE_TRANSITION_ID
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
                closerSlackId: this.triggerActionUser.slackUserId
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
        const label = ServiceRequest.config.REQUEST_JIRA_SERVICE_LABEL;
        return await this.jira.api.issues.getIssue({
            issueIdOrKey: key,
            fields: ["*all"],
            properties: [label]
        });
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

            const fields = this.getParticipantsAsFields();
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

    /**
     * Sends a message to the reporter with information about the ticket
     * that was just completed and a link to the conversation where it all went down.
     */
    public async notifyReporterOfCompletion() {
        if (this.reporter) {
            const permalink = await this.getPermalink(this.channel, this.ts);
            const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const text = `:tada: Another one bites the dust!\nThe request you submitted (<${jiraLink}|${this.ticket.key}>) has been marked complete.  <${permalink}|Click here to visit the thread in Slack>`;
            await this.notifyUserDirectly(this.reporter, text);
        }
    }

    /**
     * Sends a message to the reporter with information about the ticket
     * that was just completed and a link to the conversation where it all went down.
     */
    public async notifyReporterOfClaimedTicket() {
        if (this.reporter) {
            const permalink = await this.getPermalink(this.channel, this.ts);
            const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const text = `:rocket: Guess what?\nThe request you submitted (<${jiraLink}|${this.ticket.key}>) has been claimed!  <${permalink}|Click here to visit the thread in Slack>`;
            await this.notifyUserDirectly(this.reporter, text);
        }
    }

    /**
     * Sends a message to the reporter with information about the ticket
     * that was just completed and a link to the conversation where it all went down.
     */
    public async notifyReporterOfCreatedTicket() {
        if (this.reporter) {
            const permalink = await this.getPermalink(this.channel, this.ts);
            const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const text = `:star: Nicely done!\nTicket <${jiraLink}|${this.ticket.key}> has been created and ` +
                `a <${permalink}|thread has been started>. Next steps are for someone on the team to claim ` +
                `your request and start work on it.  Use the slack thread referenced here to chat with your ` +
                `friendly helper.`;

            await this.notifyUserDirectly(this.reporter, text);
        }
    }

    /**
     * Sends a message to the reporter with information about the ticket
     * that was just completed and a link to the conversation where it all went down.
     */
    public async notifyReporterOfCancelledTicket() {
        if (this.reporter) {
            const permalink = await this.getPermalink(this.channel, this.ts);
            const jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
            const text = `:face_with_hand_over_mouth: Hmmm...\nThe request you submitted (<${jiraLink}|${this.ticket.key}>) has been cancelled.  If that's a surprise to you, <${permalink}|check out the thread in the main service channel>`;
            await this.notifyUserDirectly(this.reporter, text);
        }
    }

    /**
     * Utility function to send a message to a user through direct message.
     * @param actor The user to notify
     * @param msg The message to send.
     */
    public async notifyUserDirectly(actor: Actor, msg: string) {

        if (!actor.slackUserId) {
            throw new Error("Failed to notify user directly because slack user ID could not be found.  Message not sent: " + msg);
        }
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

    public buildPlainTextString(customMsg?: string): string {

        const lines: string[] = [];

        // Ticket Information (if a ticket is given)
        let description: string;
        if (this.ticket) {
            lines.push(`*${this.ticket.key} - ${this.ticket.fields.summary}*`);
            description = this.ticket.fields.description || undefined;
        }

        // This takes the fields and converts them to flat text.
        const participants = this.getParticipantsAsFields();
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
    private getParticipantsAsFields(): (MrkdwnElement | PlainTextElement)[] {

        const fields: (MrkdwnElement | PlainTextElement)[] = [];
        if (this.reporter) {
            const reporterStr = this.reporter.getBestUserStringForSlack();
            fields.push(
                {
                    type: "mrkdwn",
                    text: `*Reported by*\n ${reporterStr}`
                }
            );
        }

        const state = getIssueState(this.ticket, this.config);
        //const userStr = actor.getBestUserStringForSlack();

        if (state === RequestState.claimed) {
            const userStr = this.claimer.getBestUserStringForSlack();
            fields.push({
                type: "mrkdwn",
                text: `*Claimed by*\n ${userStr}`
            });
        } else if (state === RequestState.complete) {
            const userStr = this.closer.getBestUserStringForSlack();

            fields.push({
                type: "mrkdwn",
                text: `*Completed by*\n ${userStr}`
            });
        } else if (state === RequestState.cancelled) {
            const userStr = this.closer.getBestUserStringForSlack();

            fields.push({
                type: "mrkdwn",
                text: `*Cancelled by*\n ${userStr}`
            });
        }

        return fields;
    }


    public getRequestReplyMsgBlocks(params: IRequestParams): SlackPayload {

        const infoMsg = ":information_source: Use this thread to communicate about the request.  " +
            "Note that all of these comments will be recorded as comments on the associated Jira Ticket."

        const description = params.description ? "> " + ServiceRequest.getIndentedDescription(params.description) : "";
        const blocks: any = [{
            type: "section",
            block_id: "request_description",
            text: {
                type: "mrkdwn",
                text: description ? "*Request Description*\n" + description : "_No description given_"
            }
        }, {type: "divider"}];

        const priorityInfo = moduleInstance.lookupPriorityByJiraId(params.priority);
        if (priorityInfo && priorityInfo.triggersPagerDuty) {
            blocks.push({
                type: "section",
                block_id: "high_priority_warning",
                text: {
                    type: "mrkdwn",
                    text: this.config.REQUEST_HIGH_PRIORITY_MSG
                }
            })
            blocks.push({
                type: "actions",
                block_id: "infra_request_actions",
                elements: [{
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: this.config.REQUEST_ON_CALL_BUTTON_NAME
                    },
                    value: "page_request",
                    action_id: "page_request",
                    style: "danger"
                }]
            });
        } else {
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: infoMsg
                }
            })
        }

        return blocks;
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
