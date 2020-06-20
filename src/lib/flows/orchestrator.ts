import ServiceRequest, {IRequestParams} from "../request";
import moduleInstance, {logger} from "../..";
import {
    ACTION_CANCEL_REQUEST,
    ACTION_CLAIM_REQUEST, ACTION_COMPLETE_REQUEST,
    ACTION_MODAL_REQUEST,
    ACTION_MODAL_SUBMISSION,
    ACTION_COMMENT_ON_REQUEST,
    ACTION_PAGE_REQUEST,
    ACTION_TICKET_CHANGED,
    FlowAction
} from "./index";
import {SlackMessageId} from "../slack/slackMessageId";
import {findProperty, findNestedProperty, getNestedVal} from "@nexus-switchboard/nexus-extend";
import {JiraPayload} from "@nexus-switchboard/nexus-conn-jira";
import RequestModal from "../slack/requestModal";
import {getMessageFromSlackErr} from "../util";
import {ChannelAssignments, JiraIssueSidecarData, SlackThread} from "../slack/slackThread";

export class FlowOrchestrator {

    /**
     * SLACK ENTRY POINT FOR ACTIONS
     * This is what is called when anything is done by the user (in slack) that should
     * trigger some activity within the module.
     * @param action
     * @param payload
     * @param additionalData
     */
    public static async slackActionEntryPoint(action: FlowAction, payload: any, additionalData?: any): Promise<void | boolean> {

        if (action === ACTION_MODAL_REQUEST) {
            return await FlowOrchestrator.beginRequestCreation(payload, additionalData ? additionalData.defaultText : undefined);
        } else if (action === ACTION_MODAL_SUBMISSION) {
            return await FlowOrchestrator.finishRequestCreation(payload);
        } else {
            // THINGS THAT NEED TO BE DONE IMMEDIATELY ARE DONE IN THIS CALL
            // (NOTICE THAT IT COMES BEFORE ANY AWAIT CALLS)
            FlowOrchestrator.sendImmediateSlackResponse(action, payload).catch((e) => {
                logger(`Failure when attempting to send an immediate response to the action ${action}: ${e.toString()}`)
            });

            return FlowOrchestrator.buildRequestObFromSlackEvent(payload.user.id, payload.channel.id, payload.message.thread_ts)
                .then((request: ServiceRequest) => {
                    if (action === ACTION_CLAIM_REQUEST) {
                        return request.claim();
                    } else if (action == ACTION_CANCEL_REQUEST) {
                        return request.cancel();
                    } else if (action == ACTION_COMPLETE_REQUEST) {
                        return request.complete();
                    } else if (action == ACTION_COMMENT_ON_REQUEST) {
                        return request.commentFromSlack(payload);
                    } else if (action == ACTION_PAGE_REQUEST) {
                        return request.createPagerDutyAlert(payload).catch((e) => {
                            logger("Exception thrown when trying to send pager duty alert: " + e.toString());
                        });
                    } else {
                        logger("An unrecognized action was triggered in the Flow Orchestrator: " + action);
                        return false;
                    }
                })
                .catch((err: any) => {
                    logger(`Failed to claim request for message ${payload.message.thread_ts}` +
                        `Error: ${err.toString()}`);
                });
        }
    }

    public static async jiraActionEntryPoint(action: FlowAction, payload: any, additionalData?: any): Promise<void | boolean> {

        return FlowOrchestrator.buildRequestObFromJiraEvent(additionalData, payload)
            .then((request: ServiceRequest) => {

                if (action === ACTION_TICKET_CHANGED) {
                    request.updateSlackThread();
                }

            });
    }

    /**
     * Called each time an event is triggered by some slack action.  Depending on the action,
     * a different behavior is initiated here.
     * @param action
     * @param payload
     */
    public static async sendImmediateSlackResponse(action: FlowAction, payload: any) {

        if (action === ACTION_PAGE_REQUEST) {
            // This action is triggered by a user clicking on a button in a
            //  request thread.  The immediate response for this (before any action is attempted)
            //  is to remove the page button to ensure the user doesn't click it multiple
            //  times.
            const newBlocks = payload.message.blocks.filter((b: any) => {
                return (b.block_id === "request_description" ||
                    b.block_id === "high_priority_warning")
            });
            newBlocks.push({
                type: "section",
                block_id: "page_request_completed",
                text: {
                    type: "mrkdwn",
                    text: moduleInstance.getActiveModuleConfig().REQUEST_ON_CALL_PRESSED_MSG
                }
            })
            moduleInstance.getSlack().sendMessageResponse(payload, {
                replace_original: true,
                blocks: newBlocks
            });
        }
    }

    /**
     * This static method should be used  when there is no existing thread for the request.  This will
     * do the work of posting the top level message and displaying the modal that collects input from the user.
     *
     * @param payload
     * @param defaultText
     */
    public static async beginRequestCreation(payload: any, defaultText?: string): Promise<boolean> {

        if (!defaultText) {
            defaultText = moduleInstance.getSlack().extractTextFromPayload(payload).join("");
        }

        const modConfig = moduleInstance.getActiveModuleConfig();
        const channel = modConfig.SLACK_PRIMARY_CHANNEL;
        const triggerId = getNestedVal(payload, 'trigger_id');

        if (channel) {
            const slackUserId = findNestedProperty(payload, "user", "id");
            await FlowOrchestrator.showCreateModal(triggerId, {
                slackUserId,
                title: defaultText,
                channelId: channel
            });
            return true;
        } else {
            logger("Unable to show the create modal because the originating channel could not be found");
            return false;
        }
    }


    /**
     * Factory method to create a new Request object.  This should be called when you expect to have the ticket
     * already setup as a thread in the Slack channel.  This will attach to it and return the new ServiceRequest object
     * filled in with all the right values.
     *          occurred.  This could be the primary channel or another channel in which infrabot was invited.
     * @param payload
     */
    public static async finishRequestCreation(payload: any): Promise<boolean> {

        try {
            const channelId = findProperty(payload, "private_metadata");
            if (channelId) {
                const slackUserId = findNestedProperty(payload, "user", "id");
                const values = {
                    summary: getNestedVal(payload, "view.state.values.title_input.title.value"),
                    description: getNestedVal(payload, "view.state.values.description_input.description.value"),
                    priority: getNestedVal(payload, "view.state.values.priority_input.priority.selected_option.value"),
                    category: getNestedVal(payload, "view.state.values.category_input.category.selected_option.value")
                };

                const slack = moduleInstance.getSlack();

                // Determine which channel should be the notification channel and which should be the
                //   conversation channel.
                const channels = FlowOrchestrator.identifyChannelAssignments(channelId);

                // Now post a message in the conversation channel - this message will serve as the root of the request
                //  in slack and all further conversation will happen here.
                const message = await slack.apiAsBot.chat.postMessage({
                        channel: channels.conversationChannelId,
                        text: `:gear: Creating a ticket for <@${slackUserId}> `
                    }
                );

                const messageTs = findProperty(message, "ts");

                // Now we have all the info we need to create a service request object.
                const request = new ServiceRequest(new SlackMessageId(channels.conversationChannelId, messageTs), channels.notificationChannelId, slackUserId);

                // And use the service request object to create the ticket.
                return await request.create({
                    slackUserId,
                    title: values.summary,
                    description: values.description,
                    priority: values.priority,
                    components: [values.category]
                });
            } else {
                logger("Unable to show the create modal because the originating channel could not be found");
                return false;
            }

        } catch (e) {
            logger("There was a problem finishing the infra request submission: " + e.toString());
            return false;
        }
    }

    /**
     * This will show the infra request modal and use the message that triggered it to prepopulate it.
     * @param triggerId
     * @param requestParams
     */
    protected static async showCreateModal(triggerId: string, requestParams: IRequestParams): Promise<boolean> {

        try {

            // Note: It's okay if modal config is not set - there are defaults for this.
            const modalConfig = ServiceRequest.config.SUBMIT_MODAL_CONFIG;

            const modal = new RequestModal(requestParams, modalConfig, requestParams.channelId);
            return modal.show(triggerId);

        } catch (e) {
            logger("Exception thrown: Trying to show the create modal: " + getMessageFromSlackErr(e));
            return false;
        }
    }


    /**
     * Given a starting channel (where a user initiated a request), this will return what should be
     * the primary channel (where future request conversations go) and which should be considered
     * the "notification" channel.
     * @param startingChannelId
     */
    protected static identifyChannelAssignments(startingChannelId: string): ChannelAssignments {
        return SlackThread.determineConversationChannel(startingChannelId,
            moduleInstance.getActiveModuleConfig().SLACK_PRIMARY_CHANNEL,
            ServiceRequest.config.SLACK_CONVERSATION_RESTRICTION);
    }

    /**
     * Factory method to create a new Request object.  This should be called when a Jira webhook has been called
     * because a registered event was triggered.
     * @param sideCardData
     * @param webhookPayload
     */
    public static async buildRequestObFromJiraEvent(
        sideCardData: JiraIssueSidecarData,
        webhookPayload: JiraPayload): Promise<ServiceRequest> {

        const jiraAccountId = getNestedVal(webhookPayload, "user.accountId");
        if (!jiraAccountId) {
            logger("Couldn't identify the Jira user that triggered the webhook event so skipping creation of service request object");
            return undefined;
        }

        const request = new ServiceRequest(new SlackMessageId(sideCardData.channelId, sideCardData.threadId),
            sideCardData.notificationChannelId, undefined, webhookPayload);
        await request.init();
        return request;
    }


    /**
     * Factory method to create a new Request object.  This should be called when you expect to have the ticket
     * already setup as a thread in the Slack channel.  This will attach to it and return the new ServiceRequest object
     * filled in with all the right values.
     * @param slackUserId
     * @param channelId
     * @param ts
     */
    public static async buildRequestObFromSlackEvent(slackUserId: string, channelId: string, ts: string): Promise<ServiceRequest> {
        const channels = SlackThread.determineConversationChannel(channelId, ServiceRequest.config.SLACK_PRIMARY_CHANNEL,
            ServiceRequest.config.SLACK_CONVERSATION_RESTRICTION);

        const request = new ServiceRequest(new SlackMessageId(channels.conversationChannelId, ts),
            channels.notificationChannelId, slackUserId);

        await request.init();
        return request;
    }


}
