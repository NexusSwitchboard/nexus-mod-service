import {
    SlackConnection,
    ISlackAckResponse,
    ISlackInteractionHandler,
    SlackInteractionType,
    SlackPayload
} from "@nexus-switchboard/nexus-conn-slack";

import assert from "assert";
import { logger } from "../..";
import {
    ACTION_MODAL_SUBMISSION,
    ACTION_MODAL_REQUEST,
    ACTION_CANCEL_REQUEST,
    ACTION_COMPLETE_REQUEST,
    ACTION_PAGE_REQUEST, ACTION_CLAIM_REQUEST
} from "../flows";
import Orchestrator from "../flows/orchestrator";

export const interactions: ISlackInteractionHandler[] = [{
    /************
     * BLOCK BUTTON ACTION HANDLER: Claim, Cancel or Complete existing request
     * This is the handler for when the user clicks one of the buttons at the bottom of the created request
     * message that appears in the originating message's thread.
     */

    matchingConstraints: { blockId: "infra_request_actions" },
    type: SlackInteractionType.action,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {
        assert(slackParams.actions && slackParams.actions.length > 0, "Received slack action event but actions array appears to be empty");

        if (slackParams.actions[0].value === "view_request") {
            return {
                code: 200
            };
        }

        ////////// CLAIM
        if (slackParams.actions[0].value === "claim_request") {
            Orchestrator.entryPoint(ACTION_CLAIM_REQUEST, slackParams)
                .catch((err) => {
                    logger(`Failed to claim request for message ${slackParams.message.thread_ts}` +
                        `Error: ${err.toString()}`);
                });
        }

        ////////// CANCEL
        if (slackParams.actions[0].value === "cancel_request") {
            Orchestrator.entryPoint(ACTION_CANCEL_REQUEST, slackParams)
                .catch((err) => {
                    logger(`Failed to cancel request for message ${slackParams.message.thread_ts}` +
                        `Error: ${err.toString()}`);
                });

            // ServiceRequest.postTransitionMessage(slackParams, "Cancelling request...");
        }

        ////////// COMPLETE
        if (slackParams.actions[0].value === "complete_request") {
            Orchestrator.entryPoint(ACTION_COMPLETE_REQUEST, slackParams)
                .catch((err) => {
                    logger(`Failed to complete request for message ${slackParams.message.thread_ts}` +
                        `Error: ${err.toString()}`);
                });

            // ServiceRequest.postTransitionMessage(slackParams, "Completing request...");
        }

        ////////// PAGE ON-CALL BUTTON
        if (slackParams.actions[0].value === "page_request") {

            Orchestrator.entryPoint(ACTION_PAGE_REQUEST, slackParams)
                .catch((err: Error) => {
                    logger(`Failed to send pager duty request for message ${slackParams.message.thread_ts}. ` +
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
    matchingConstraints: { callbackId: "submit_request" },
    type: SlackInteractionType.action,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {

        Orchestrator.entryPoint(ACTION_MODAL_REQUEST, slackParams)
            .catch((e) => {
                logger("Failed to start detail collection: " + e.toString());
            });

        return {
            code: 200
        };
    }
}, {
    /************
     * GLOBAL SHORTCUT HANDLER: Create Request
     * This is the handler for when uses a global shortcut (meaning it's not tied to a message or a channel)
     */
    matchingConstraints: { callbackId: "submit_request" },
    type: SlackInteractionType.shortcut,
    handler: async (_conn: SlackConnection, slackParams: SlackPayload): Promise<ISlackAckResponse> => {

        Orchestrator.entryPoint(ACTION_MODAL_REQUEST, slackParams)
            .catch(e=>logger(`Failed to start detail collection: ${e.toString()}`))

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
        Orchestrator.entryPoint(ACTION_MODAL_SUBMISSION, slackParams).catch((e) => {
            logger("Request creation failed: " + e.toString());
        });

        return {
            code: 200,
            response_action: "clear"
        };
    }
}, {
    /************
     * MESSAGE ACTION HANDLER: Request modal dismissed
     * This is the handler for when the user dismissed the request dialog.
     */

    matchingConstraints: "infra_request_modal",
    type: SlackInteractionType.viewClosed,
    handler: async (_conn: SlackConnection, _slackParams: SlackPayload): Promise<ISlackAckResponse> => {

        // NOTE: This is no longer necessary because we don't show a message before the dialog
        //  is displayed.  Leaving here for posterity in case we change the way that is handled in the future.
        // const modConfig = moduleInstance.getActiveModuleConfig();
        //
        // const metaData = findProperty(slackParams, "private_metadata");
        // if (metaData) {
        //     const slackData = parseEncodedSlackData(metaData);
        //     const message = await _conn.getMessageFromChannelAndTs(
        //         slackData.conversationMsg.channel, slackData.conversationMsg.ts);
        //
        //     if (ServiceRequest.isBotMessage(message, modConfig.SLACK_BOT_USERNAME)) {
        //         _conn.apiAsBot.chat.delete({
        //             channel: slackData.conversationMsg.channel,
        //             ts: slackData.conversationMsg.ts,
        //             as_user: true
        //         })
        //             .catch((e: any) => {
        //                 logger(`Error when trying to delete the generated message for a slash command invoked request: ${e.toString()}`);
        //             });
        //     }
        // }
        return {
            code: 200
        };
    }
}];
