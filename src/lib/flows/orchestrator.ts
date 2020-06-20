import ServiceRequest from "../request";
import {logger} from "../..";
import {FlowAction, ServiceFlow} from "./index";
import {SlackMessageId} from "../slack/slackMessageId";
import {getNestedVal} from "@nexus-switchboard/nexus-extend";
import {JiraPayload} from "@nexus-switchboard/nexus-conn-jira";
import {JiraIssueSidecarData, SlackThread} from "../slack/slackThread";

export class FlowOrchestrator {

    protected orderedFlows: ServiceFlow[];

    public constructor() {
        this.orderedFlows = [];
    }

    public addFlow(flow: ServiceFlow) {
        this.orderedFlows.push(flow);
    }

    /**
     * SLACK ENTRY POINT FOR ACTIONS
     * This is what is called when anything is done by the user (in slack) that should
     * trigger some activity within the module.
     * @param action
     * @param payload
     * @param additionalData
     */
    public async entryPoint(action: FlowAction, payload: any, additionalData?: any): Promise<void | boolean> {

        for (let i = 0; i < this.orderedFlows.length; i++) {
            const flow = this.orderedFlows[i];
            flow.handleAction(action, payload, additionalData).catch((e) => logger(`Failed to handle action ${action}: ${e.toString()}`))
        }

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

export default new FlowOrchestrator()
