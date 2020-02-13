import {ISlackAckResponse, SlackSubCommandList} from "@nexus-switchboard/nexus-conn-slack";
import {findProperty} from "@nexus-switchboard/nexus-extend";
import ServiceRequest from "../../lib/request";
import {logger} from "../..";

// Reference: Slack Slash Commands: https://api.slack.com/interactivity/slash-commands

export const requestSubcommands: SlackSubCommandList = {

    default: async (_conn, textWithoutAction, slackParams): Promise<ISlackAckResponse> => {

        try {
            const channel = findProperty(slackParams, "channel_id");
            const slackUserId = findProperty(slackParams, "user_id");

            // first, post a message that we can use as an anchor
            ServiceRequest.createNewThread(slackUserId, channel, textWithoutAction, slackParams.trigger_id)
                .catch((e) => {
                    logger("Failed to start detail collection: " + e.toString());
                });

        } catch (e) {
            logger(`There was a problem in handling the ${slackParams.command} command: ${e.toString()}`);
        }

        return {
            code: 200
        };
    }
};
