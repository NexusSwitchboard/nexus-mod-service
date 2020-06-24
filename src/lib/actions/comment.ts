import {logger} from "../..";
import {ACTION_COMMENT_ON_REQUEST, FlowAction} from "../flows";
import {findProperty} from "@nexus-switchboard/nexus-extend";
import ServiceRequest from "../request";
import {Action} from "./index";
import {noop, replaceSlackUserIdsWithNames} from "../util";

/**
 * The CommentAction handles the case where a user has submitted a comment on a platform and
 * we need to distribute that comment to other platforms.  Here's what it does:
 *
 *  * When a payload is received from slack, it assumes that the comment was submitted on slack - it posts
 *      that comment to the Jira ticket (with a bit at the bottom about who actually said it in slack - since
 *      you can't post a comment as another user).
 *  * FUTURE: Receive comments from Jira and post them in the slack thread.
 */
export class CommentAction extends Action {
    public getType(): FlowAction {return ACTION_COMMENT_ON_REQUEST}

    /**
     * This is called immediately after a request has changed to this state.  Expect it
     * to be called exactly once after each state change.
     */
    public async postRun(request: ServiceRequest): Promise<ServiceRequest> {
        return request;
    }

    /**
     * This is where the execution of the action happens
     */
    public async run(request: ServiceRequest): Promise<ServiceRequest> {
        try {
            if (this.source === "slack"){
                this.commentFromSlack(request).then(noop);
            }
        } catch (e) {
            logger("Comment handling failed: " + e.toString());
        }
        return request;
    }

    public preRun(request: ServiceRequest): ServiceRequest {
        return request;
    }


    public async commentFromSlack(request:ServiceRequest): Promise<boolean> {
        try {
            logger("Received thread comment - sending to Jira...");
            const messageTs = findProperty(this.payload, "ts");
            const text = findProperty(this.payload, "text");
            const permaLink = await this.slack.apiAsBot.chat.getPermalink({
                channel: request.channel,
                message_ts: messageTs
            });

            const slackUser = await request.triggerActionUser.getRawSlackUser();
            const slackDisplayName =
                findProperty(slackUser, "display_name") ||
                findProperty(slackUser, "real_name");

            const nameReplacementText = await replaceSlackUserIdsWithNames(text);
            const finalText = `\n${nameReplacementText}\n~Comment posted in [Slack|${permaLink.permalink}] by ${slackDisplayName}~`;

            const jiraPayload = await this.jira.api.issueComments.addComment({
                issueIdOrKey: request.ticket.key,
                body: this.jira.transformDescriptionText(finalText, 2)
            });

            return !!jiraPayload;

        } catch (e) {
            logger("Exception thrown: During an attempt to post a comment to Jira: " + e.toString());
            return false;
        }
    }
}
