import {findNestedProperty, getNestedVal, findProperty} from "@nexus-switchboard/nexus-core";
import {JiraTicket} from "@nexus-switchboard/nexus-conn-jira";
import {SlackPayload} from "@nexus-switchboard/nexus-conn-slack";

import {logger} from "../..";
import {ACTION_CREATE_REQUEST, FlowAction} from "../flows";
import ServiceRequest, {ChannelAssignments, IRequestParams} from "../request";
import {Action} from "./index";
import {prepTitleAndDescription} from "../util";
import moduleInstance from "../../index";
import {SlackMessageId} from "../slack/slackMessageId";


/**
 * The CreateAction will take care of the creation of a request in Jira and the subsequent initialization
 * of the Slack Thread that will come to represent that request in Slack.  Here's what it includes:
 *  * Creation of Jira Request
 *  * Posting of Notification to Notification Channel (if applicable)
 *  * Posting of Response in Direct Message to Reporter (if applicable)
 *  * Posting the initial reply with additional details about the issue as well as additional actions if there are any.
 */
export class CreateAction extends Action {
    public getType(): FlowAction {
        return ACTION_CREATE_REQUEST
    }

    /**
     * This is called immediately after a request has changed to this state.  Expect it
     * to be called exactly once after each state change.
     */
    public async postRun(request: ServiceRequest): Promise<ServiceRequest> {


        //
        // POST A REPLY IN THE REQUEST THREAD
        //
        await request.addReply({
            blocks: this.getRequestReplyMsgBlocks(request)
        });

        //
        // Parse user's request and respond with something useful
        //
        if ( typeof this.intent.getSlackConfig().autoRespondRules != "undefined" ) {

            const autoRespondRules = this.intent.getSlackConfig().autoRespondRules
            const requesterName    = request.triggerActionUser.realName;
            const summary          = request.ticket.fields.summary;
            const description      = request.ticket.fields.description ? request.ticket.fields.description : "";
            const fullText         = summary.concat(" ", description);

            for ( let item in autoRespondRules ) {
                if ( autoRespondRules[item].enabled && fullText.search(autoRespondRules[item].regex) != -1 ) {
                    await request.addReply({
                        blocks: [{
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `Hey, ${requesterName}! ${autoRespondRules[item].respondText}`
                            }
                        }]
                    });
                    break;
                }
            }
        }

        //
        // POST A MESSAGE IN THE NOTIFICATION CHANNEL
        //      (if request came from a non-primary channel)
        //
        const reporterStr = request.reporter.getBestUserStringForSlack();
        request.postMsgToNotificationChannel(
            `Request <{{ticketLink}}|{{ticketKey}}> submitted by ${reporterStr} was ` +
            `created successfully. Follow progress <{{threadLink}}|here>`
        )
            .catch((e) => {
                logger("Exception thrown while posting to notification channel: " + e.toString());
            });

        //
        // POST A DM TO THE REPORTER
        //      (if reporter slack ID is known)
        //
        const userMsg = `:star: Nicely done!\nTicket <{{ticketLink}}|${request.ticket.key}> has been created and ` +
            `a <{{threadLink}}|thread has been started>. Next steps are for someone on the team to claim ` +
            `your request and start work on it.  Use the slack thread referenced here to chat with your ` +
            `friendly helper.`
        request.postMsgToUser(request.reporter, userMsg).catch((e) => {
            logger("Exception thrown while posting direct message to reporter: " + e.toString());
        });


        return request;


    }


    /**
     * Given a starting channel (where a user initiated a request), this will return what should be
     * the primary channel (where future request conversations go) and which should be considered
     * the "notification" channel.
     * @param startingChannelId
     */
    protected identifyChannelAssignments(startingChannelId: string): ChannelAssignments {
        return ServiceRequest.determineConversationChannel(
            startingChannelId,
            this.intent.getSlackConfig().primaryChannel,
            this.intent.getSlackConfig().conversationRestriction);
    }


    /**
     * This is where the execution of the action happens
     */
    public async run(request: ServiceRequest): Promise<ServiceRequest> {
        logger(`\t\tAction Run Begin: Action 'create'`);
        // check to see if there is already a request associated with this.
        if (request.ticket) {
            logger("There is already a request associated with this message: " + request.ticket.key);
            return null;
        }

        try {
            const channelId = findProperty(this.payload, "private_metadata");
            if (channelId) {
                const slackUserId = findNestedProperty(this.payload, "user", "id");
                const values = {
                    summary: getNestedVal(this.payload, "view.state.values.title_input.title.value"),
                    description: getNestedVal(this.payload, "view.state.values.description_input.description.value"),
                    priority: getNestedVal(this.payload, "view.state.values.priority_input.priority.selected_option.value"),
                    category: getNestedVal(this.payload, "view.state.values.category_input.category.selected_option.value")
                };

                const slack = moduleInstance.getSlack();

                // Determine which channel should be the notification channel and which should be the
                //   conversation channel.
                const channels = this.identifyChannelAssignments(channelId);

                // Now post a message in the conversation channel - this message will serve as the root of the request
                //  in slack and all further conversation will happen here.
                const message = await slack.apiAsBot.chat.postMessage({
                        channel: channels.conversationChannelId,
                        text: `:gear: Creating a ticket for <@${slackUserId}> `
                    }
                );

                const messageTs = findProperty(message, "ts");

                // Now we have all the info we need to create a service request object.
                const request = new ServiceRequest({
                    conversationMsg: new SlackMessageId(channels.conversationChannelId, messageTs),
                    notificationChannelId: channels.notificationChannelId,
                    slackUserId,
                    intent: this.intent
                });

                const params: any = {
                    slackUserId,
                    title: values.summary,
                    description: values.description,
                    priority: values.priority,
                    components: [values.category]
                }

                // Now we will construct the ticket parameter starting with the labels.  We submit the
                //  encoded form of the slack message id in order to connect the jira ticket with the
                //  message which started it all.
                const requiredLabels = [`${this.intent.getJiraConfig().serviceLabel}-request`, request.serializeId()];
                params.labels = params.labels ? requiredLabels.concat(params.labels) : requiredLabels;

                request.reporter = request.triggerActionUser;

                const ticket = await this.createTicket(request, params);
                if (ticket) {
                    await request.setTicket(ticket);
                }

                logger(`\t\t\tAction Run End:Success, Action 'create'`);

                return request;
            }
        } catch (e) {
            logger("Exception thrown: During ticket creation:  " + e.toString());
        }

        logger(`\t\t\tAction Run End:Failure, Action 'create'`);
        return null;
    }


    /**
     * Creates a request ticket in Jira.
     */
    protected async createTicket(request: ServiceRequest, params: IRequestParams): Promise<JiraTicket> {
        try {

            // Note: In ticket creation, we remove invalid characters from title -
            //  jira will reject any summary that has a newline in it, for example
            // tslint:disable-next-line:prefer-const
            let {title, description} = prepTitleAndDescription(params.title, params.description);

            // Check to see if we need to show the name of the reporter.  We do this in the case
            //  where the reporter has a slack user but not a jira user.  In the latter case,
            //  we put the user's name in the description for reference.
            await request.triggerActionUser.loadBestRawObject();
            const fromName = request.triggerActionUser.realName;

            if (fromName) {
                description += `\nSubmitted by ${fromName}`;
            }

            const ticketCreationParams = {
                fields: {
                    summary: title,
                    description: this.jira.transformDescriptionText(description, 2),
                    project: {
                        key: this.intent.getJiraConfig().project
                    },
                    issuetype: {
                        id: this.intent.getJiraConfig().issueTypeId
                    },
                    priority: {
                        id: params.priority
                    },
                    labels: params.labels || [],
                    components: params.components ? params.components.map((c) => {
                        return {id: c};
                    }) : []
                },
                properties: [
                    {
                        key: this.intent.getJiraConfig().serviceLabel,
                        value: {
                            channelId: request.channel,
                            threadId: request.ts,
                            actionMsgId: request.actionMessageId ? request.actionMessageId.ts : "",
                            notificationChannelId: request.notificationChannelId,
                            reporterSlackId: request.triggerActionUser.slackUserId,
                            claimerSlackId: "",
                            closerSlackId: ""
                        }
                    }
                ]
            };

            // first create the issue
            const result = await this.jira.api.issues.createIssue(ticketCreationParams);

            // we purposely set the epic after the ticket is created to avoid an epic setting error from
            //  preventing  ticket creation.  Sometimes, depending on the configuration of the project, this may
            //  fail while the basic values in the initial ticket creation will almost always succeed.
            if (this.intent.getJiraConfig().epicKey) {
                await request.setEpic(result.key, this.intent.getJiraConfig().epicKey);
            }

            // we purposely set the reporter after the ticket is created to avoid a reporter setting error from
            //  preventing  ticket creation.  Sometimes, depending on the configuration of the project, this may
            //  fail while the basic values in the initial ticket creation will almost always succeed.
            const jiraUser = await request.triggerActionUser.getRawJiraUser();
            if (jiraUser) {
                await request.setReporter(result.key, jiraUser);
            }

            return await request.getJiraIssue(result.key);

        } catch (e) {
            logger("JIRA createIssue failed: " + e.toString());
            return undefined;
        }
    }

    public preRun(request: ServiceRequest): ServiceRequest {
        return request;
    }


    public getRequestReplyMsgBlocks(request: ServiceRequest): SlackPayload {

        const infoMsg = ":information_source: Use this thread to communicate about the request.  " +
            "Note that all of these comments will be recorded as comments on the associated Jira Ticket."

        const description = request.ticket.fields.description ? "> " +
            ServiceRequest.getIndentedDescription(request.ticket.fields.description) : "";

        const blocks: any = [{
            type: "section",
            block_id: "request_description",
            text: {
                type: "mrkdwn",
                text: description ? "*Request Description*\n" + description : "_No description given_"
            }
        }, {type: "divider"}];

        const priorityInfo = this.intent.lookupPriorityByJiraId(request.ticket.fields.priority.id);
        if (priorityInfo && priorityInfo.triggersPagerDuty) {
            blocks.push({
                type: "section",
                block_id: "high_priority_warning",
                text: {
                    type: "mrkdwn",
                    text: this.intent.config.text.highPriorityReplyText
                }
            })
            blocks.push({
                type: "actions",
                block_id: "infra_request_actions",
                elements: [{
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: this.intent.config.text.onCallButtonText
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
}
