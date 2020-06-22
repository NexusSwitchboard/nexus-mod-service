import {
    ACTION_MODAL_REQUEST,
    ACTION_MODAL_SUBMISSION, ACTION_TICKET_CHANGED, FLOW_CONTINUE, FLOW_LAST_STEP,
    FlowAction, FlowBehavior, FlowState,
    ServiceFlow, STATE_NO_TICKET, STATE_TODO
} from "./index";
import {findProperty, findNestedProperty, getNestedVal} from "@nexus-switchboard/nexus-extend";
import moduleInstance, {logger} from "../../index";
import ServiceRequest, {IRequestParams, ChannelAssignments} from "../request";
import {SlackMessageId} from "../slack/slackMessageId";
import RequestModal from "../slack/requestModal";
import {getMessageFromSlackErr, noop} from "../util";

/**
 *
 * INTAKE FLOW
 *
 * Handles actions that involve receiving details about the request.
 */
export class IntakeFlow extends ServiceFlow {

    protected _getFlowActions(_payload: any, _additionalData: any): FlowAction[] {
        return [ACTION_MODAL_REQUEST, ACTION_MODAL_SUBMISSION, ACTION_TICKET_CHANGED]
    }

    protected async _handleAsyncResponse(request: ServiceRequest, action: FlowAction, _payload: any, _additionalData: any): Promise<void> {
        if (action === ACTION_TICKET_CHANGED && request) {
            request.updateSlackThread().then(noop);
        }
        return Promise.resolve();
    }

    protected _handleSyncResponse(action: FlowAction, payload: any, additionalData: any): FlowBehavior {
        if (action === ACTION_MODAL_REQUEST) {

            const text = additionalData ? additionalData.defaultText : undefined;
            IntakeFlow.beginRequestCreation(payload, text).then(noop);

            return FLOW_LAST_STEP

        } else if (action === ACTION_MODAL_SUBMISSION) {

            IntakeFlow.finishRequestCreation(payload).then((request) => {
                request.state = STATE_TODO;
            });

            return FLOW_LAST_STEP
        }

        return FLOW_CONTINUE
    }

    protected _setRequestState(request: ServiceRequest): FlowState {

        let state: FlowState;
        if (!request || !request.ticket) {
            state = STATE_NO_TICKET;
        } else {
            const cat: string = getNestedVal(request.ticket, "fields.status.statusCategory.name");
            if (["undefined", "to do", "new"].indexOf(cat.toLowerCase()) >= 0) {
                state = STATE_TODO;
            }
        }

        if (state) {
            request.state = state;
        }

        return undefined;
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
            await IntakeFlow.showCreateModal(triggerId, {
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
    public static async finishRequestCreation(payload: any): Promise<ServiceRequest> {

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
                const channels = IntakeFlow.identifyChannelAssignments(channelId);

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
                })
            } else {
                logger("Unable to show the create modal because the originating channel could not be found");
            }

        } catch (e) {
            logger("There was a problem finishing the infra request submission: " + e.toString());
        }

        return undefined;
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
        return ServiceRequest.determineConversationChannel(startingChannelId,
            moduleInstance.getActiveModuleConfig().SLACK_PRIMARY_CHANNEL,
            ServiceRequest.config.SLACK_CONVERSATION_RESTRICTION);
    }

}
