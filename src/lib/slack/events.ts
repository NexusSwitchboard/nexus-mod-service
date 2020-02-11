import {SlackConnection, ISlackAckResponse, SlackEventList, SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import {findNestedProperty, findProperty} from "@nexus-switchboard/nexus-extend";
import moduleInstance from "../..";
import ServiceRequest from "../../lib/request";

/**
 * General handler for thread posts made in threads that are part of an open request.
 * @param conn The connection past to the event handler
 * @param slackParams The params past to the event handler
 */
const handlePostedThreadMessage = async (conn: SlackConnection,
                                         slackParams: SlackPayload): Promise<ISlackAckResponse> => {

    const config = moduleInstance.getActiveConfig();

    // ignore any message that is posted by a bot.
    if (!ServiceRequest.isBotMessage(slackParams.message || slackParams, config.SLACK_BOT_USERNAME)) {

        // then see if this is associated with a request ticket.
        const channel = findProperty(slackParams, "channel");
        const messageTs = findProperty(slackParams, "ts");
        const threadTs = findProperty(slackParams, "thread_ts");
        const slackUserId = findNestedProperty(slackParams, "user", "id");

        // first determine if this is a threaded message.  If it's not there's nothing to do.
        if (threadTs && threadTs !== messageTs) {

            // note that we don't block on requests in the main flow because slack is expecting a response of some
            //  kind within a very short period.
            const request = new ServiceRequest(channel, threadTs);
            request.loadRequest().then(async (found) => {
                if (found) {
                    // now get the user information so we can ensure that the comment has a reference
                    //  to the originating user (you cannot add a comment AS another user in Jira.
                    const userInfo = await request.getUserInfoFromSlackUserId(slackUserId);

                    const permaLink = await conn.apiAsBot.chat.getPermalink({
                        channel,
                        message_ts: messageTs
                    });

                    const text = findProperty(slackParams, "text");
                    const slackDisplayName = findProperty(userInfo.slack, "display_name") ||
                        findProperty(userInfo.slack, "real_name");
                    const commentText = `\n${text}\n----\n??Comment posted in [Slack|${permaLink.permalink}] by ${slackDisplayName}??`;

                    // now add the message as a comment on the original ticket.
                    return await request.addComment(commentText);

                } else {
                    return undefined;
                }
            });
        }
    }

    return {
        code: 200
    };

};

export const events: SlackEventList = {
    message: async (conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
        return handlePostedThreadMessage(conn, slackParams);
    },
    // "message.groups": async (conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
    //     return handlePostedThreadMessage(conn, slackParams);
    // },
    // "message.im": async (conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
    //     return handlePostedThreadMessage(conn, slackParams);
    // },
    // "message.mpim": async (conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
    //     return handlePostedThreadMessage(conn, slackParams);
    // },
};
