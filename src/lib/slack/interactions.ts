import {
    SlackConnection,
    ISlackAckResponse,
    ISlackInteractionHandler,
    SlackInteractionType,
    SlackPayload
} from "@nexus-switchboard/nexus-conn-slack";

import assert from "assert";
import {findNestedProperty, findProperty, getNestedVal} from "@nexus-switchboard/nexus-extend";
import {SlackMessageId} from "../slackMessageId";
import {logger} from "../..";
import ServiceRequest from "../../lib/request";
import moduleInstance from "../..";

export const interactions: ISlackInteractionHandler[] = [{
    /************
     * BLOCK BUTTON ACTION HANDLER: Claim, Cancel or Complete existing request
     * This is the handler for when the user clicks one of the buttons at the bottom of the created request
     * message that appears in the originating message's thread.
     */

    matchingConstraints: {blockId: "infra_request_actions"},
    type: SlackInteractionType.action,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
        assert(slackParams.actions && slackParams.actions.length > 0, "Received slack action event but actions array appears to be empty");

        ////////// CLAIM
        if (slackParams.actions[0].value === "claim_request") {
            const request = new ServiceRequest(slackParams.channel.id, slackParams.message.thread_ts);
            request.claim(slackParams.user.id)
                .then((_success) => {
                    logger(`Successfully claimed request for message ${slackParams.message.thread_ts}`);
                })
                .catch((err) => {
                    logger(`Failed to claim request for message ${slackParams.message.thread_ts}` +
                        `Error: ${err.toString()}`);
                });
        }

        ////////// CANCEL
        if (slackParams.actions[0].value === "cancel_request") {
            const request = new ServiceRequest(slackParams.channel.id, slackParams.message.thread_ts);
            request.cancel(slackParams.user.id)
                .then((_success) => {
                    logger(`Successfully cancelled request for message ${slackParams.message.thread_ts}`);
                })
                .catch((err) => {
                    logger(`Failed to cancel request for message ${slackParams.message.thread_ts}` +
                        `Error: ${err.toString()}`);
                });
        }

        ////////// COMPLETE
        if (slackParams.actions[0].value === "complete_request") {
            const request = new ServiceRequest(slackParams.channel.id, slackParams.message.thread_ts);
            request.complete(slackParams.user.id)
                .then((_success: boolean) => {
                    logger(`Successfully completed request for message ${slackParams.message.thread_ts}`);
                })
                .catch((err: Error) => {
                    logger(`Failed to complete request for message ${slackParams.message.thread_ts}. ` +
                        `Error: ${err.toString()}`);
                });
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
    matchingConstraints: {callbackId: "submit_infra_request"},
    type: SlackInteractionType.action,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
        const slackUserId = findNestedProperty(slackParams, "user", "id");
        let ts = findProperty(slackParams, "thread_ts");
        if (!ts) {
            ts = findProperty(slackParams, "ts");
        }
        const channel = findNestedProperty(slackParams, "channel", "id");
        const text = _conn.extractTextFromPayload(slackParams).join("");

        const request = new ServiceRequest(channel, ts);

        request.startDetailCollection(slackUserId, text, slackParams.trigger_id)
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
            category: getNestedVal(slackParams, "view.state.values.category_input.category.selected_option.value"),
        };

        const errors: string[] = [];
        if (!values.summary) {
            errors.push("You must provide a summary for the request");
        }
        if (!values.category) {
            errors.push("You must specify a category");
        }

        if (errors.length > 0) {
            return {
                code: 200,
                response_action: "errors",
                errors
            };
        } else {
            const metaData = findProperty(slackParams, "private_metadata");
            if (metaData) {
                const userId = findNestedProperty(slackParams, "user", "id");
                const messageId = SlackMessageId.fromEncodedId(metaData);
                const request = new ServiceRequest(messageId.channel, messageId.ts);
                request.create({
                    slackUserId: userId,
                    title: values.summary,
                    description: values.description,
                    priority: "medium",
                    labels: [values.category]
                }).catch((err) => {
                    logger("There was a problem processing the infra request submission: " + err.toString());
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

    }
}, {
    /************
     * MESSAGE ACTION HANDLER: Request modal dismissed
     * This is the handler for when the user dismissed the request dialog.
     */

    matchingConstraints: "infra_request_modal",
    type: SlackInteractionType.viewClosed,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {

        const modConfig = moduleInstance.getActiveConfig();

        const metaData = findProperty(slackParams, "private_metadata");
        if (metaData) {
            const messageId = SlackMessageId.fromEncodedId(metaData);
            const message = await _conn.getMessageFromChannelAndTs(messageId.channel, messageId.ts);

            if (ServiceRequest.isBotMessage(message, modConfig.SLACK_BOT_ID)) {
                _conn.apiAsBot.chat.delete({
                    channel: messageId.channel,
                    ts: messageId.ts,
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
