import {SlackConnection, ISlackAckResponse, SlackEventList, SlackPayload} from "@nexus-switchboard/nexus-conn-slack";
import {logger} from "../..";
import { SlackHomeTab } from "./homeTab";
import Orchestrator from "../flows/orchestrator";
import {SlackThread} from "./slackThread";
import {ACTION_COMMENT_ON_REQUEST} from "../flows";

/**
 * General handler for thread posts made in threads that are part of an open request.
 * @param _conn
 * @param slackParams The params past to the event handler
 */
const handlePostedThreadMessage = async (_conn: SlackConnection,
                                         slackParams: SlackPayload): Promise<ISlackAckResponse> => {

    // ignore any message that is posted by a bot.
    if (!SlackThread.isBotMessage(slackParams.message || slackParams)) {
        // first determine if this is a threaded message.  If it's not there's nothing to do.
        Orchestrator.entryPoint(ACTION_COMMENT_ON_REQUEST, slackParams).catch((e) => {
            logger("Comment transfer failed: " + e.toString());
        });
    }

    return {
        code: 200
    };

};

export const events: SlackEventList = {
    message: async (conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
        return handlePostedThreadMessage(conn, slackParams);
    },
    app_home_opened: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
        const home = new SlackHomeTab(slackParams.user);
        home.publish().catch((e) => {
            logger("Failed to publish new home page after `app_home_opened` event received: " + e.toString());
        });

        return {
            code: 200
        }
    }
};
