import ServiceRequest, {IRequestState} from "../request";
import {logger} from "../..";
import {FLOW_HALT, FLOW_LAST_STEP, FlowAccessType, FlowAction, FlowSource, ServiceFlow} from "./index";
import {SlackMessageId} from "../slack/slackMessageId";
import {getNestedVal} from "@nexus-switchboard/nexus-core";
import {JiraPayload} from "@nexus-switchboard/nexus-conn-jira";
import {SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import serviceMod from "../../index";
import {mergeRequestStates} from "../util";
import {ServiceIntent} from "../intents";

/**
 * A single instance of the flow orchestrator manages all the active requests.  When an external event occurs,
 * the orchestrator's entrypoint is called. In that entrypoint, information about the request this event is tied to
 * is extracted from the payload (and other sources), the necessary actions are performed and, in most cases, the
 * clients are updated with new data.
 *
 * The orchestrator manages flows which are units of workflows.  Multiple ordered flows are contained within the
 * orchestrator and their order dictates priority.  Flows accept actions which are translated into behavior.  Flows
 * with high priority have an opportunity to handle an action before the next flow and can even stop further processing
 * of that action.
 *
 * ServiceRequest objects are passed through flows and are acted upon as actions are processed.  A service request
 * could change multiple times as a result of a single action - especially if multiple flows are handling that action.
 *
 * About Control Flows
 * Control flows are blocks on handling certain actions for certain requests (or all actions for all requests).  There
 * are cases where we need to block access temporarily for performing an action - for example, if we are already
 * performing the action and need to block further attempts to start the action again (because the UI is not updating
 * fast enough).
 *
 * You can set control on a flow by specifying the ticket key and the action.  Both can be replaced with a "*" to
 * indicate all keys or all actions.  So, if * is given for both and "deny" is specified that will effectively stop
 * all actions from being processed.
 */
export class FlowOrchestrator {

    protected orderedFlows: ServiceFlow[];
    protected intent: ServiceIntent;

    public constructor(intent: ServiceIntent) {
        this.orderedFlows = [];
        this.intent = intent;
    }

    public addFlow(flow: ServiceFlow) {
        flow.setIntent(this.intent);
        this.orderedFlows.push(flow);
    }

    /**
     * Allow or deny actions from being handled by all of the regisetered flows.
     * @param key The ticket key or * to mean all tickets
     * @param action The action (e.g. ACTION_CLAIM_REQUEST) or * for all actions.
     * @param access The access type (either "allow" or "deny")
     */
    public setControlFlow(key: string, action: string, access: FlowAccessType) {
        for (let i = 0; i < this.orderedFlows.length; i++) {
            this.orderedFlows[i].setControlFlow(key, action, access);
        }
    }

    /**
     * This is what is called when anything is done by the user (in slack or Jira) that should
     * trigger some activity within the module.
     * @param source
     * @param action
     * @param payload
     * @param intent
     * @param additionalData
     */
    public async entryPoint(source: FlowSource, action: FlowAction, payload: any, intent: ServiceIntent, additionalData?: any) {

        // First handle the syncrhonous actions being taken by each flow.  For each flow that
        //  prevents further flows from acting, carry that forward to the async actions
        let stopAtFlow = -1;
        let fullStop = false;
        for (let i = 0; i < this.orderedFlows.length; i++) {
            const flow = this.orderedFlows[i];
            const behavior = flow.getImmediateResponse(source, action, payload, intent, additionalData);
            if (behavior === FLOW_HALT) {
                fullStop = true;
                break;
            } else if (behavior == FLOW_LAST_STEP) {
                stopAtFlow = i;
            }
        }

        if (fullStop) {
            return;
        }

        //
        // RUN THE ASYNC HANDLERS
        //

        let request: ServiceRequest = null;
        if (source === "jira") {
            // We build a request from a jira event (which has to be done differently
            //  than with slack events).
            request = await FlowOrchestrator.buildRequestObFromJiraEvent(payload, intent);
        } else if (source === "slack") {
            // We build a request from a slack event (which has to be done differently
            //  than with jira events).
            request = await FlowOrchestrator.buildRequestObFromSlackEvent(payload, intent);
        }

        // Once we have the request object, now iterate through the flows to handle the event.
        //  The request object is modified
        for (let i = 0; i < this.orderedFlows.length; i++) {
            const flow = this.orderedFlows[i];
            if (stopAtFlow == -1 || stopAtFlow >= i) {
                request = await flow.handleEventResponse(request, source, action, payload, intent, additionalData);
            }
        }

        //
        // RUN THE STATE UPDATER AFTER ALL THE ACTIONS HAVE EXECUTED
        //
        await this.updateState(request);
    }

    /**
     * Factory method to create a new Request object.  This should be called when a Jira webhook has been called
     * because a registered event was triggered.
     * @param webhookPayload
     * @param intent
     */
    public static async buildRequestObFromJiraEvent(webhookPayload: JiraPayload, intent: ServiceIntent): Promise<ServiceRequest> {

        // The only issues that we should receive here are those that match
        //  the filter above so there shouldn't be a need to reverify that these
        //  are of the right project and have the right labels.

        // Hopefully, custom the properties were returned along with the rest of the ticket info.  If
        //  not we have to make a separate request to get them.
        let prop = getNestedVal(webhookPayload, "issue.properties");
        if (!prop) {

            //
            // MAKE JIRA REQUEST TO GET CUSTOM PROPERTIES
            //
            const jiraApi = serviceMod.getJira().api;
            const propKey = intent.getJiraConfig().serviceLabel;
            prop = await jiraApi.issueProperties.getIssueProperty({
                issueIdOrKey: webhookPayload.issue.key,
                propertyKey: propKey
            });

            // Now add the properties to the issue for future reference (some of the
            //  actions that follow might expect the properties to be part of the webhook payload).
            webhookPayload.properties = [prop];

            if (prop) {
                prop = prop.value;
            }

        } else {

            //
            // USE GIVEN CUSTOM PROPERTIES
            //
            if (prop.infrabot) {
                prop = prop.infrabot;
            } else {
                prop = undefined;
            }
        }

        if (!prop) {
            // Probably an older infrabot request ticket.  Skip
            return undefined;
        }

        let jiraAccountId = getNestedVal(webhookPayload, "user.accountId");
        if (!jiraAccountId) {
            jiraAccountId = getNestedVal(webhookPayload, "comment.author.accountId");
            if (!jiraAccountId) {
                logger("Couldn't identify the Jira user that triggered the webhook event " +
                                "so skipping creation of service request object");
                return undefined;
            }
        }

        const request = new ServiceRequest({
            intent: intent,
            conversationMsg: new SlackMessageId(prop.channelId, prop.threadId),
            notificationChannelId: prop.notificationChannelId,
            jiraWebhookPayload: webhookPayload
        });
        await request.init();
        return request;
    }


    /**
     * Factory method to create a new Request object.  This should be called when you expect to have the ticket
     * already setup as a thread in the Slack channel.  This will attach to it and return the new ServiceRequest object
     * filled in with all the right values.
     * @param payload
     * @param intent
     */
    public static async buildRequestObFromSlackEvent(payload: SlackPayload, intent: ServiceIntent): Promise<ServiceRequest> {
        const ts = getNestedVal(payload, 'message.thread_ts') || getNestedVal(payload, 'thread_ts');
        const channelId = getNestedVal(payload, 'channel.id') || getNestedVal(payload, 'channel');
        const slackUserId = getNestedVal(payload, 'user.id') || getNestedVal(payload, 'user');

        const channels = ServiceRequest.determineConversationChannel(
            channelId,
            intent.getSlackConfig().primaryChannel,
            intent.getSlackConfig().conversationRestriction);

        const request = new ServiceRequest({
            intent: intent,
            conversationMsg: new SlackMessageId(channels.conversationChannelId, ts),
            notificationChannelId: channels.notificationChannelId,
            slackUserId: slackUserId
        });

        await request.init();
        return request;
    }

    /**
     * This will give each flow an opportunity to modify the state of the given request.
     * Each flow should only modify those things that are specific to the flow.  For example, the Intake flow
     * should not do anything with claims.
     */
    public async updateState(request: ServiceRequest) {
        let lastState: IRequestState = {
            icon: "",
            state: "",
            fields: [],
            actions: []
        }

        for (let i = 0; i < this.orderedFlows.length; i++) {
            const currentState = await this.orderedFlows[i].updateState(request);
            lastState = mergeRequestStates(currentState, lastState);
        }

        request.state = lastState;

        // this should only be called from the orchestrator level to avoid multiple updates per event.
        await request.updateSlackThread();
    }
}
