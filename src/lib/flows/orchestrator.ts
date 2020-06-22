import ServiceRequest from "../request";
import moduleInstance, {logger} from "../..";
import {FLOW_CONTINUE, FLOW_HALT, FlowAccessType, FlowAction, FlowSource, ServiceFlow} from "./index";
import {SlackMessageId} from "../slack/slackMessageId";
import {getNestedVal} from "@nexus-switchboard/nexus-extend";
import {JiraPayload} from "@nexus-switchboard/nexus-conn-jira";
import {SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import serviceMod from "../../index";

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

    public constructor() {
        this.orderedFlows = [];
    }

    public addFlow(flow: ServiceFlow) {
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
     * @param additionalData
     */
    public entryPoint(source: FlowSource, action: FlowAction, payload: any, additionalData?: any) {

        for (let i = 0; i < this.orderedFlows.length; i++) {
            const flow = this.orderedFlows[i];
            const behavior = flow.handleSyncAction(source, action, payload, additionalData);
            if (behavior != FLOW_HALT) {
                // THIS PART IS ASYNCHRONOUS - DO NOT USE AWAIT OR USE THE RETURN VALUE.
                flow.handleAsyncAction(source, action,payload, additionalData).catch(
                    (e) => logger(`Failed to handle action ${action}: ${e.toString()}`));
            }

            if (behavior != FLOW_CONTINUE) {
                break;
            }
        }

    }

    /**
     * Factory method to create a new Request object.  This should be called when a Jira webhook has been called
     * because a registered event was triggered.
     * @param webhookPayload
     */
    public static async buildRequestObFromJiraEvent(webhookPayload: JiraPayload): Promise<ServiceRequest> {

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
            prop = await jiraApi.issueProperties.getIssueProperty({
                issueIdOrKey: webhookPayload.issue.key,
                propertyKey: moduleInstance.getActiveModuleConfig().REQUEST_JIRA_SERVICE_LABEL
            });

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

        const jiraAccountId = getNestedVal(webhookPayload, "user.accountId");
        if (!jiraAccountId) {
            logger("Couldn't identify the Jira user that triggered the webhook event so skipping creation of service request object");
            return undefined;
        }

        const request = new ServiceRequest(new SlackMessageId(prop.channelId, prop.threadId),
            prop.notificationChannelId, undefined, webhookPayload);
        await request.init();
        return request;
    }


    /**
     * Factory method to create a new Request object.  This should be called when you expect to have the ticket
     * already setup as a thread in the Slack channel.  This will attach to it and return the new ServiceRequest object
     * filled in with all the right values.
     * @param payload
     */
    public static async buildRequestObFromSlackEvent(payload: SlackPayload): Promise<ServiceRequest> {
        const ts = getNestedVal(payload, 'message.thread_ts') || getNestedVal(payload, 'thread_ts');
        const channelId = getNestedVal(payload, 'channel.id') || getNestedVal(payload, 'channel');
        const slackUserId = getNestedVal(payload, 'user.id') || getNestedVal(payload, 'user');

        const channels = ServiceRequest.determineConversationChannel(channelId, ServiceRequest.config.SLACK_PRIMARY_CHANNEL,
            ServiceRequest.config.SLACK_CONVERSATION_RESTRICTION);

        const request = new ServiceRequest(new SlackMessageId(channels.conversationChannelId, ts),
            channels.notificationChannelId, slackUserId);

        await request.init();
        return request;
    }
}

export default new FlowOrchestrator()
