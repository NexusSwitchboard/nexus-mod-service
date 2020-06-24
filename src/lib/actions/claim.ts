import {getNestedVal} from "@nexus-switchboard/nexus-extend";
import {JiraTicket} from "@nexus-switchboard/nexus-conn-jira";

import {logger} from "../..";
import {ACTION_CLAIM_REQUEST, FlowAction} from "../flows";
import ServiceRequest from "../request";
import {Action} from "./index";
import {noop} from "../util";

/**
 * The ClaimAction will transition a ticket to in-progress.  Here are the things it does:
 *
 *  * Transitioning the request to In-Progress
 *  * Posting of message to Notification Channel (if applicable)
 *  * Posting of message in Direct Message to Reporter (if applicable)
 *
 */
export class ClaimAction extends Action {
    public getType(): FlowAction {return ACTION_CLAIM_REQUEST}

    /**
     * This is called immediately after a request has changed to this state.  Expect it
     * to be called exactly once after each state change.
     */
    public async postRun(request: ServiceRequest): Promise<ServiceRequest> {
        const reporterStr = request.reporter.getBestUserStringForSlack();

        const notificationMsg = `Request <{{ticketLink}}|{{ticketKey}}> submitted by ${reporterStr} was claimed`+
            ` and started. Follow progress <{{threadLink}}|here>`;
        request.postMsgToNotificationChannel(notificationMsg).then(noop);

        const userMsg = `:rocket: Guess what?\nThe request you submitted (<{{ticketLink}}|`+
            `${request.ticket.key}>) has been claimed!  <{{threadLink}}|Click here to visit the thread in Slack>`;

        request.postMsgToUser(request.reporter, userMsg).then(noop);

        return request;
    }

    /**
     * This is where the execution of the action happens
     */
    public async run(request: ServiceRequest): Promise<ServiceRequest> {
        try {
            // Now verify that the ticket is actually in a state where it can be claimed.
            const statusCategory: string = getNestedVal(request.ticket, "fields.status.statusCategory.name");
            if (!statusCategory) {
                logger("Warning: Unable to determine status category of the ticket.  This could be because the jira ticket object json is malformed.");
            }

            if (statusCategory && statusCategory.toLowerCase() === "to do") {
                const ticket = await this.claimJiraTicket(request);
                if (ticket) {
                    await request.setTicket(ticket);
                }
            }

        } catch (e) {
            logger("Claim failed with " + e.toString());
        }
        return request;
    }


    /**
     * Puts a request in progress using the given key to find the existing ticket and the given
     * email to set the assignee.
     */
    protected async claimJiraTicket(request: ServiceRequest): Promise<JiraTicket> {
        if (!request.ticket) {
            throw new Error("The jira ticket to claim has not yet been loaded.");
        }

        try {
            await request.triggerActionUser.loadBestRawObject();
            const jiraUser = await request.triggerActionUser.getRawJiraUser();
            if (jiraUser) {
                try {
                    await this.jira.api.issues.assignIssue({
                        issueIdOrKey: request.ticket.key,
                        accountId: jiraUser.accountId
                    });
                } catch (e) {
                    logger("Exception thrown: Unable to  assign issue to given user: " + e.toString());
                    return null;
                }
            }

            await this.jira.api.issues.transitionIssue({
                issueIdOrKey: request.ticket.key,
                transition: {
                    id: ServiceRequest.config.REQUEST_JIRA_START_TRANSITION_ID // Start Progress
                },
                fields: undefined,
                update: undefined,
                historyMetadata: undefined,
                properties: undefined
            });

            await request.updateIssueProperties({
                claimerSlackId: request.triggerActionUser.slackUserId
            });

            return await request.getJiraIssue(request.ticket.key);
        } catch (e) {
            logger("Exception thrown: Unable to transition the given issue: " + e.toString());
            return undefined;
        }
    }

    public preRun(request: ServiceRequest): ServiceRequest {
        return request;
    }

}
