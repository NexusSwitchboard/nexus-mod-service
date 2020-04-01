import {
    SlackConnection,
    ISlackAckResponse,
    ISlackInteractionHandler,
    SlackInteractionType,
    SlackPayload
} from "@nexus-switchboard/nexus-conn-slack";

import assert from "assert";
import { findNestedProperty, findProperty, getNestedVal, ModuleConfig } from "@nexus-switchboard/nexus-extend";
import { logger } from "../..";
import ServiceRequest from "../../lib/request";
import moduleInstance from "../..";
import { RequestThread } from "../requestThread";
import { parseEncodedSlackData } from "../util";

export const interactions: ISlackInteractionHandler[] = [{
    /************
     * BLOCK BUTTON ACTION HANDLER: Claim, Cancel or Complete existing request
     * This is the handler for when the user clicks one of the buttons at the bottom of the created request
     * message that appears in the originating message's thread.
     */

    matchingConstraints: { blockId: "infra_request_actions" },
    type: SlackInteractionType.action,
    handler: async (conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
        assert(slackParams.actions && slackParams.actions.length > 0, "Received slack action event but actions array appears to be empty");

        const config = moduleInstance.getActiveModuleConfig();

        if (slackParams.actions[0].value === "view_request") {
            return {
                code: 200
            };
        }

        ////////// CLAIM
        if (slackParams.actions[0].value === "claim_request") {
            ServiceRequest.loadThreadFromSlackEvent(slackParams.user.id, slackParams.channel.id, slackParams.message.thread_ts)
                .then((request) => {
                    return request.claim();
                })
                .catch((err) => {
                    logger(`Failed to claim request for message ${slackParams.message.thread_ts}` +
                        `Error: ${err.toString()}`);
                });

            updateActionBar("Claiming request...", conn, slackParams, config);
        }

        ////////// CANCEL
        if (slackParams.actions[0].value === "cancel_request") {
            ServiceRequest.loadThreadFromSlackEvent(slackParams.user.id, slackParams.channel.id, slackParams.message.thread_ts)
                .then((request) => {
                    return request.cancel();
                })
                .then((_success) => {
                    logger(`Successfully cancelled request for message ${slackParams.message.thread_ts}`);
                })
                .catch((err) => {
                    logger(`Failed to cancel request for message ${slackParams.message.thread_ts}` +
                        `Error: ${err.toString()}`);
                });

            updateActionBar("Cancelling request...", conn, slackParams, config);
        }

        ////////// COMPLETE
        if (slackParams.actions[0].value === "complete_request") {
            ServiceRequest.loadThreadFromSlackEvent(slackParams.user.id, slackParams.channel.id, slackParams.message.thread_ts)
                .then((request) => {
                    return request.complete();
                })
                .catch((err: Error) => {
                    logger(`Failed to complete request for message ${slackParams.message.thread_ts}. ` +
                        `Error: ${err.toString()}`);
                });

            updateActionBar("Completing request...", conn, slackParams, config);
        }

        return {
            code: 200
        };
    }
}, {
    /************
     * MESSAGE ACTION HANDLER: Create Request
     * This is the handler for when the user right clicks on a message and chooses the submit request action
     */
    matchingConstraints: { callbackId: "submit_infra_request" },
    type: SlackInteractionType.action,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
        const slackUserId = findNestedProperty(slackParams, "user", "id");
        const channel = findNestedProperty(slackParams, "channel", "id");
        const text = _conn.extractTextFromPayload(slackParams).join("");

        ServiceRequest.startNewRequest(slackUserId, channel, text, slackParams.trigger_id)
            .catch((e) => {
                logger("Failed to start detail collection: " + e.toString());
            });

        return {
            code: 200
        };
    }
}, {
    /************
     * MESSAGE ACTION HANDLER: Submit Request
     * This is the handler for when the user presses the submit button the Create Request modal.
     */

    matchingConstraints: "infra_request_modal",
    type: SlackInteractionType.viewSubmission,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {

        const values = {
            summary: getNestedVal(slackParams, "view.state.values.title_input.title.value"),
            description: getNestedVal(slackParams, "view.state.values.description_input.description.value"),
            priority: getNestedVal(slackParams, "view.state.values.priority_input.priority.selected_option.value"),
            category: getNestedVal(slackParams, "view.state.values.category_input.category.selected_option.value")
        };

        const channelId = findProperty(slackParams, "private_metadata");
        if (channelId) {
            const userId = findNestedProperty(slackParams, "user", "id");

            ServiceRequest.finishRequestCreation(userId, channelId, values).catch((e) => {
                logger("Request creation failed: " + e.toString());
            });

            return {
                code: 200,
                response_action: "clear"
            };
        } else {
            logger("Unable to continue with infra request because there was a " +
                "problem finding the source channel and message that invoked the request.");

            return {
                code: 200
            };
        }
    }
}, {
    /************
     * MESSAGE ACTION HANDLER: Request modal dismissed
     * This is the handler for when the user dismissed the request dialog.
     */

    matchingConstraints: "infra_request_modal",
    type: SlackInteractionType.viewClosed,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {

        const modConfig = moduleInstance.getActiveModuleConfig();

        const metaData = findProperty(slackParams, "private_metadata");
        if (metaData) {
            const slackData = parseEncodedSlackData(metaData);
            const message = await _conn.getMessageFromChannelAndTs(
                slackData.conversationMsg.channel, slackData.conversationMsg.ts);

            if (ServiceRequest.isBotMessage(message, modConfig.SLACK_BOT_USERNAME)) {
                _conn.apiAsBot.chat.delete({
                    channel: slackData.conversationMsg.channel,
                    ts: slackData.conversationMsg.ts,
                    as_user: true
                })
                    .catch((e: any) => {
                        logger(`Error when trying to delete the generated message for a slash command invoked request: ${e.toString()}`);
                    });
            }
        }
        return {
            code: 200
        };
    }
}];

const updateActionBar = (msg: string, conn: SlackConnection, slackParams: SlackPayload, config: ModuleConfig) => {

    const blocks = RequestThread.buildActionBarHeader();
    blocks.push({
        type: "section",
        text: {
            type: "mrkdwn",
            text: `${config.REQUEST_WORKING_SLACK_ICON} ${msg}`
        }
    });

    // Message responses can be sent for up to 30 minutes after the action took place.
    conn.sendMessageResponse(slackParams, {
        replace_original: "true",
        blocks
    }).catch((e) => {
        logger("Exception thrown: Unable to send message response after action: "
            + e.toString());
    });
};
