import { ChatPostMessageArguments, ChatUpdateArguments } from '@slack/web-api';
import assert from 'assert';

import { JiraConnection, JiraTicket } from '@nexus-switchboard/nexus-conn-jira';
import { SlackConnection, SlackPayload, SlackWebApiResponse } from '@nexus-switchboard/nexus-conn-slack';
import { findProperty, getNestedVal, hasOwnProperties, ModuleConfig } from '@nexus-switchboard/nexus-extend';

import { getCreateRequestModalView } from './slack/createRequestModal';
import moduleInstance from '..';
import { logger } from '..';
import { SlackMessageId } from './slackMessageId';
import { RequestThread } from './requestThread';
import { prepTitleAndDescription, replaceAll } from './util';

export enum RequestState {
    todo = 'todo',
    claimed = 'claimed',
    complete = 'complete',
    cancelled = 'cancelled',
    working = 'working',
    error = 'error',
    unknown = 'unknown'
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

type UserType = 'claimer' | 'reporter' | 'closer';

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
export type UsersInvolved = {
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
     * @param username
     */
    public static isBotMessage(msg: SlackPayload, username: string) {
        if (msg.subtype && msg.subtype === 'bot_message') {
            return msg.username.toLowerCase() === username.toLowerCase();
        } else {
            return false;
        }
    }

    // stored information about the slack thread associated with the request. You can use this
    //  to get things like the top level message, the first reply, and other useful utilities
    protected thread: RequestThread;

    // stores information about the user that performed the last action in the thread.  For example,
    //  if someone "claimed" a ticket, it will hold the slack and, if possible, the jira user information
    protected user: RequestUser;

    // stores the actual ticket associated with the thread.  This could be empty if the user is still entering
    //  information about the request and the jira ticket has not yet been created.
    protected _ticket: JiraTicket;

    // stores the configuration information for the module.
    protected config: ModuleConfig;
    protected slack: SlackConnection;
    protected jira: JiraConnection;

    protected components: ServiceComponent[];

    // this is necessary so that we can hold on to the user id that is passed into the constructor and then
    //  used automatically when the reset is called immediately afterwards.
    private readonly slackUserId: string;


    private constructor(channel: string, ts: string, slackUserId: string) {
        this.config = moduleInstance.getActiveModuleConfig();
        this.slack = moduleInstance.getSlack();
        this.jira = moduleInstance.getJira();
        this.thread = new RequestThread(ts, channel, this.slack, this.jira, this.config);
        this.slackUserId = slackUserId;
    }

    /**
     * Factory method to create a new Request object.  This should be called when you expect to have the ticket
     * already setup as a thread in the Slack channel.  This will attach to it and return the new ServiceRequest object
     * filled in with all the right values.
     * @param slackUserId
     * @param channelId
     * @param ts
     */
    public static async loadExistingThread(slackUserId: string, channelId: string, ts: string): Promise<ServiceRequest> {
        const request = new ServiceRequest(channelId, ts, slackUserId);
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
    public static async createNewThread(slackUserId: string, channelId: string, requestText: string, triggerId: string) {

        const slack = moduleInstance.getSlack();
        const config = moduleInstance.getActiveModuleConfig();

        slack.apiAsBot.chat.postMessage({
                channel: channelId,
                text: `${config.REQUEST_EDITING_SLACK_ICON} <@${slackUserId}> is working on a new request:\n*${requestText ? requestText : '_No info on the request yet..._'}*`
            }
        ).then(async (response: SlackPayload) => {
            const messageTs = findProperty(response, 'ts');
            const request = new ServiceRequest(channelId, messageTs, slackUserId);

            await request.reset();
            await request.showCreateModal(triggerId, {
                slackUserId,
                title: requestText
            });

            return request;
        });
    }

    public set ticket(ticket: JiraTicket) {
        this._ticket = ticket;
        this.thread.ticket = ticket;
    }

    public get ticket(): JiraTicket {
        return this._ticket;
    }

    /**
     * This is what should be called when someone has claimed an existing ticket (created with handleAddRequest
     */
    public async claim(): Promise<void> {
        try {
            // Now verify that the ticket is actually in a state where it can be claimed.
            const statusCategory: string = getNestedVal(this.ticket, 'fields.status.statusCategory.name');
            if (!statusCategory) {
                logger('Warning: Unable to determine status category of the ticket.  This could be because the jira ticket object json is malformed.');
            }

            if (statusCategory && statusCategory.toLowerCase() !== 'to do') {
                await this.addErrorReply('You can only claim tickets that haven\'t been started yet.');

            } else {
                const ticket = await this.claimJiraTicket();
                if (!ticket) {
                    await this.addErrorReply('Failed to claim this ticket ' +
                        'possibly because the email associated with your slack account is different than the ' +
                        'one in Jira.');

                } else {
                    await this.updateState(RequestState.claimed);
                }
            }
            // Now assign the user and set the ticket "in progress"
        } catch (e) {
            logger('Claim failed with ' + e.toString());
            await this.addErrorReply('The claim failed due to the following problem: ' + e.message);
        }
    }

    public async cancel(): Promise<void> {

        try {
            // now let's try marking it as complete with the right resolution.
            await this.markTicketComplete(this.ticket, this.config.REQUEST_JIRA_RESOLUTION_DISMISS);

            await this.updateState(RequestState.cancelled);

        } catch (e) {
            logger('Cancel failed with ' + e.toString());
            await this.addErrorReply('There was a problem closing the request: ' + e.toString());
        }
    }

    public async complete() {

        assert(this.thread, 'Service Mod: Attempting to complete a ticket without a valid thread set');

        try {
            await this.markTicketComplete(this.ticket, this.config.REQUEST_JIRA_RESOLUTION_DONE);
            await this.updateState(RequestState.complete);

            return true;
        } catch (e) {
            logger('Complete failed with ' + e.toString());
            await this.addErrorReply('There was a problem completing the request: ' + e.toString());

            return false;
        }
    }

    public async create(params: IRequestParams): Promise<boolean> {

        try {

            await this.updateState(RequestState.working, 'Working on your request...');

            // check to see if there is already a request associated with this.
            if (this.ticket) {
                await this.addErrorReply('There is already a request associated with this message: ' +
                    `<${this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key)}|` +
                    `${this.ticket.key} - ${this.ticket.fields.summary}>`);
                return false;
            }

            // Now we will construct the ticket parameter starting with the labels.  We submit the
            //  encoded form of the slack message id in order to connect the jira ticket with the
            //  message which started it all.
            const requiredLabels = ['infrabot-request', this.thread.serializeId()];
            params.labels = params.labels ? requiredLabels.concat(params.labels) : requiredLabels;

            const ticket = await this.createTicket(params);
            if (ticket) {
                this.thread.reporterSlackId = this.slackUserId;
                this.ticket = ticket;
                await this.updateState(RequestState.todo);
                return true;
            } else {
                await this.updateState(RequestState.error, 'There was a problem submitting the issue to Jira.');
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

            const messageTs = findProperty(slackEventPayload, 'ts');
            const text = findProperty(slackEventPayload, 'text');
            const permaLink = await this.slack.apiAsBot.chat.getPermalink({
                channel: this.thread.channel,
                message_ts: messageTs
            });

            const slackDisplayName =
                findProperty(this.user.slack, 'display_name') ||
                findProperty(this.user.slack, 'real_name');

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
     * Converts a slack user to a jira user object.
     * @param slackUserId
     */
    public async getUserInfoFromSlackUserId(slackUserId: string): Promise<RequestUser> {

        try {
            const slackUser = await this.getSlackUser(slackUserId);
            if (slackUser) {
                const jiraUser = await this.getJiraUser(slackUser.profile.email);
                return {
                    slack: slackUser,
                    jira: jiraUser
                };
            } else {
                return undefined;
            }
        } catch(e) {
            logger("Exception thrown: Trying to get information about a user from slack: " + e.toString());
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
            await this.loadTicketFromMessageId(this.thread.slackMessageId);

            if (!this.user || !this.user.slack || this.user.slack.id !== this.slackUserId) {
                this.user = await this.getUserInfoFromSlackUserId(this.slackUserId);
                if (!this.user.slack) {
                    throw new Error("There was a problem loading the slack user info for user with ID: " +
                        this.slackUserId);
                }
            }
        } catch (e) {
            logger(`Exception thrown: Unable to find to reset the request object:` + e.toString());
        }
    }

    protected async getJiraUser(email: string): Promise<Record<string, any>> {

        try {
            const users = await this.jira.api.userSearch.findUsers({
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

    protected async getSlackUser(userId: string): Promise<SlackPayload> {
        try {
            const userInfo = await this.slack.apiAsBot.users.info({ user: userId }) as SlackWebApiResponse;
            if (userInfo && userInfo.ok) {
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
    protected async loadTicketFromMessageId(message: SlackMessageId): Promise<any> {
        try {
            const jql = `labels in ("${message.buildRequestId()}") and labels in ("infrabot-request")`;
            const results = await this.jira.api.issueSearch.searchForIssuesUsingJqlPost({
                jql,
                fields: ['*all'],
                properties: ["infrabot"]
            });

            if (results.total >= 1) {
                this.ticket = results.issues[0];
                this.thread.loadJiraIssueProperties();
            } else {
                return undefined;
            }
        } catch (e) {
            logger('Exception thrown: Unable to search for tickets by slack ts field: ' + e.toString());
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
            const fromName = this.user.jira ? undefined : getNestedVal(this.user.slack, 'profile.real_name');

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
                        key: "infrabot",
                        value: {
                            channelId: this.thread.channel,
                            threadId: this.thread.ts,
                            actionMsgId: "",
                            reporterSlackId: this.slackUserId
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
            if (this.user.jira) {
                await this.setReporter(result.key, this.user.jira);
            }

            return await this.jira.api.issue.getIssue({ issueIdOrKey: result.key });

        } catch (e) {
            logger('JIRA createIssue failed: ' + e.toString());
            return undefined;
        }
    }

    /**
     * Puts a request in progress using the given key to find the existing ticket and the given
     * email to set the assignee.
     */
    protected async claimJiraTicket(): Promise<JiraTicket> {
        if (!this.ticket) {
            throw new Error('The jira ticket to claim has not yet been loaded.');
        }

        if (!this.config || !hasOwnProperties(this.config, [
            'REQUEST_JIRA_START_TRANSITION_ID'])) {
            throw Error('Necessary configuration values for infra module not found for this action');
        }

        try {
            if (this.user.jira) {
                try {
                    await this.jira.api.issues.assignIssue({
                        issueIdOrKey: this.ticket.key,
                        accountId: this.user.jira.accountId
                    });
                } catch (e) {
                    logger('Exception thrown: Unable to  assign issue to given user: ' + e.toString());
                    return null;
                }
            } else {
                try {
                    // verifies that  the  issue is there.
                    await this.jira.api.issue.getIssue({ issueIdOrKey: this.ticket.key });
                } catch (e) {
                    logger('Exception thrown: Unable to find the issue with ID' + this.ticket.key);
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

            return await this.jira.api.issue.getIssue({ issueIdOrKey: this.ticket.key });
        } catch (e) {
            logger('Exception thrown: Unable to transition the given issue: ' + e.toString());
            return undefined;
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
            'REQUEST_JIRA_COMPLETE_TRANSITION_ID'])) {
            throw Error('Necessary configuration values for infra module not found for this action');
        }

        try {
            await this.jira.api.issues.transitionIssue({
                issueIdOrKey: ticket.key,
                transition: {
                    id: this.config.REQUEST_JIRA_COMPLETE_TRANSITION_ID // Start Progress
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

            return await this.jira.api.issue.getIssue({ issueIdOrKey: ticket.key });

        } catch (e) {
            logger('Unable to transition the given issue: ' + e.toString());
            return undefined;
        }
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
            ids[m.groups.id] = '';
        }

        const replacements: Record<string, any> = {};
        if (Object.keys(ids).length > 0) {
            await Promise.all(Object.keys(ids).map(async (id) => {
                return this.getSlackUser(id)
                    .then((user) => {
                        replacements[`<@${id}>`] = getNestedVal(user, 'real_name');
                    })
                    .catch((e) => {
                        logger('Unable to get slack user for ID ' + id + ': ' + e.toString());
                    });
            }));

            return replaceAll(msg, replacements);
        }

        return msg;
    }

    /**
     * Maps an issue's status to a request state.
     */
    // @ts-ignore
    private getIssueState(): RequestState {

        const cat: string = getNestedVal(this.ticket, 'fields.status.statusCategory.name');
        const config = moduleInstance.getActiveModuleConfig();

        if (cat.toLowerCase() === 'to do') {
            return RequestState.todo;
        } else if (cat.toLowerCase() === 'in progress') {
            return RequestState.claimed;
        } else if (cat.toLowerCase() === 'done') {
            const resolution: string = getNestedVal(this.ticket, 'fields.resolution.name');
            if (resolution) {
                if (resolution.toLowerCase() === config.REQUEST_JIRA_RESOLUTION_DONE.toLowerCase()) {
                    return RequestState.complete;
                } else {
                    return RequestState.cancelled;
                }
            }
            return RequestState.complete;
        } else {
            return RequestState.unknown;
        }
    };

    /**
     * Posts a message to the right slack thread with a standard error format
     * @param msg
     * @param messageToUpdateTs If given, it will try and replace the given message
     */
    public async addErrorReply(msg: string, messageToUpdateTs?: string) {
        await this.addReply({ text: `:x: ${msg}` }, messageToUpdateTs);
    }

    /**
     * This will add or replace a post to the right channel.  The slack payload given is the same as the payload
     * you would use when posting a message but it will handle replace an exisiting message if a `ts` is given.  It
     * then will return the created or updated ts if successful
     * @param messageParams
     * @param ts
     */
    public async addReply(messageParams: SlackPayload, ts?: string): Promise<string> {
        if (ts) {
            const options: ChatUpdateArguments = Object.assign(
                {}, {
                    text: '',
                    channel: this.thread.channel,
                    ts
                }, messageParams);


            try {
                const result = await this.slack.apiAsBot.chat.update(options);
                if (result.ok) {
                    return result.ts as string;
                }
            } catch (e) {
                logger('Exception thrown: Failed to update the top reply in the thread: ' + e.toString());
            }

        } else {
            const options: ChatPostMessageArguments = Object.assign({}, {
                text: '',
                channel: this.thread.channel,
                thread_ts: this.thread.ts
            }, messageParams);

            try {
                const result = await this.slack.apiAsBot.chat.postMessage(options);
                if (result.ok) {
                    return result.ts as string;
                }
            } catch (e) {
                logger('Exception thrown: Unable to create a reply in the thread: ' + e.toString());
            }
        }

        return undefined;
    }

    public async updateState(state: RequestState, msg?: string) {
        if  (!!this.thread.ticket !== !!this.ticket) {
            assert(false);
        }
        await this.updateTopLevelMessage(state, msg);
        await this.updateActionBar(state);
    }

    /**
     * This will add the buttons at the top of the thread in the form of a
     * reply in the thread.  If there are no messages in the thread then it will add one.
     * If there is somehow already a message in the thread then it will either overwrite or, if it doesn't
     * have sufficient permissions will fail.
     * @param state
     */
    public async updateActionBar(state: RequestState) {
        const header = await this.thread.getThreadHeaderMessageId();

        let jiraLink: string;
        if (this.ticket) {
            jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
        }

        try {
            const ts = await this.addReply({
                text: 'Action Bar',
                blocks: this.thread.buildActionBlocks(state, this.ticket, jiraLink)
            }, header ? header.ts : undefined);

            if (ts) {
                await this.thread.setActionThread(ts);
            }
        } catch (e) {
            logger('Exception thrown: Unable to add the action bar probably because there\'s already a first ' +
                'message in the thread that has been added by someone other than the bot');
        }
    }

    public async updateTopLevelMessage(state: RequestState, msg?: string) {

        let jiraLink: string;
        if (this.ticket) {
            jiraLink = this.jira.keyToWebLink(this.config.JIRA_HOST, this.ticket.key);
        }

        // the source request was an APP post which means we can update it without extra permissions.
        await this.slack.apiAsBot.chat.update({
            channel: this.thread.channel,
            ts: this.thread.ts,
            as_user: true,
            text: this.thread.buildPlainTextString(this.ticket, state, msg),
            blocks: this.thread.buildTextBlocks(this.ticket, state,
                jiraLink, msg, this.user.slack ? this.user.slack.id : undefined)
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
            logger('Unable to set the reporter possibly because the API key given ' +
                'does not have \'Modify Reporter\' permissions: ' + e.toString());
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
            logger('Unable to set the epic possibly because the project is not setup properly: ' +
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
            logger('Exception thrown: Cannot retrieve components from Jira: ' + e.toString());
            return [{
                id: this.config.REQUEST_JIRA_DEFAULT_COMPONENT_ID,
                name: 'Generic',
                description: 'This component is here because other components could not be retrieved.'
            }];
        }
    }
}
