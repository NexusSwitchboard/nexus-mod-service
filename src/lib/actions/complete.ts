import {JiraTicket} from "@nexus-switchboard/nexus-conn-jira";

import {logger} from "../..";
import {ACTION_CLAIM_REQUEST, FlowAction} from "../flows";
import ServiceRequest from "../request";
import {Action} from "./index";
import {noop} from "../util";

/**
 * The CompleteAction will transition a ticket to complete with a positive resolution (such as "Done").
 * Here are the things it does:
 *
 *  * Transitioning the request to Complete with a resolution of "Done" in most cases
 *  * Posting of message to Notification Channel (if applicable)
 *  * Posting of message in Direct Message to Reporter (if applicable)
 *
 */
export class CompleteAction extends Action {
    public getType(): FlowAction {
        return ACTION_CLAIM_REQUEST
    }

    /**
     * This is called immediately after a request has changed to this state.  Expect it
     * to be called exactly once after each state change.
     */
    public async postRun(request: ServiceRequest): Promise<ServiceRequest> {
        const reporterStr = request.reporter.getBestUserStringForSlack();

        const notificationMsg = `Request <{{ticketLink}}|{{ticketKey}}> submitted by ${reporterStr} was completed.` +
            ` Follow progress <{{threadLink}}|here>`;
        request.postMsgToNotificationChannel(notificationMsg).then(noop);

        const userMsg = `:tada: Another one bites the dust!\nThe request you submitted (<{{ticketLink}}|` +
            `${request.ticket.key}>) has been marked complete.  <{{threadLink}}|Click here ` +
            `to visit the thread in Slack>`;
        request.postMsgToUser(request.reporter, userMsg).then(noop);

        return request;
    }

    /**
     * This is where the execution of the action happens
     */
    public async run(request: ServiceRequest): Promise<ServiceRequest> {
        try {
            // now let's try marking it as complete with the right resolution.
            const ticket = await this.completeTicket(request);
            if (ticket) {
                await request.setTicket(ticket);
            }
        } catch (e) {
            logger("Cancel failed with " + e.toString());
        }

        return request;
    }

    /**
     * Marks the given request as complete with  the  given resolution   value.
     */
    public async completeTicket(request: ServiceRequest): Promise<JiraTicket> {

        let resolutionId = await this.jira.getResolutionIdFromName(this.config.REQUEST_JIRA_RESOLUTION_DONE);
        if (!resolutionId) {
            logger(`Unable to find the resolution "${this.config.REQUEST_JIRA_RESOLUTION_DONE}" so defaulting to 'Done'`);
            resolutionId = 1; // Done
        }

        try {
            await this.jira.api.issues.transitionIssue({
                issueIdOrKey: request.ticket.key,
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

            await request.updateIssueProperties({
                closerSlackId: request.triggerActionUser.slackUserId
            });

            return await request.getJiraIssue(request.ticket.key);

        } catch (e) {
            logger("Unable to transition the given issue: " + e.toString());
            return undefined;
        }
    }

    public preRun(request: ServiceRequest): ServiceRequest {
        return request;
    }
}
