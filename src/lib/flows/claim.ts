import ServiceRequest from "../request";
import {
    ACTION_CANCEL_REQUEST,
    ACTION_CLAIM_REQUEST,
    ACTION_COMMENT_ON_REQUEST,
    ACTION_COMPLETE_REQUEST,
    ACTION_PAGE_REQUEST, FLOW_CONTINUE,
    FlowAction, FlowBehavior,
    ServiceFlow
} from ".";

import moduleInstance, {logger} from "../../index";
import {FlowOrchestrator} from "./orchestrator";
import {getNestedVal} from "@nexus-switchboard/nexus-extend";

export class ClaimFlow extends ServiceFlow {

    protected _getFlowActions(_payload: any, _additionalData: any): FlowAction[] {
        return [ACTION_CLAIM_REQUEST, ACTION_CANCEL_REQUEST,
            ACTION_COMPLETE_REQUEST, ACTION_COMMENT_ON_REQUEST,
            ACTION_PAGE_REQUEST]
    }

    protected _handleAsyncResponse(action: FlowAction, payload: any, _additionalData: any) {

        // The location of the timestamp, channel and user data vary depending on whether a regular event
        //  was received (as in a message was posted to a channel) or an interaction event occurred (as in a user
        //  pressed a button)
        const ts = getNestedVal(payload, 'message.thread_ts') || getNestedVal(payload, 'thread_ts');
        const channel = getNestedVal(payload, 'channel.id') || getNestedVal(payload, 'channel');
        const user = getNestedVal(payload, 'user.id') || getNestedVal(payload, 'user');

        return FlowOrchestrator.buildRequestObFromSlackEvent(user, channel, ts)
            .then((request: ServiceRequest) => {
                if (action === ACTION_CLAIM_REQUEST) {
                    return request.claim();
                } else if (action == ACTION_CANCEL_REQUEST) {
                    return request.cancel();
                } else if (action == ACTION_COMPLETE_REQUEST) {
                    return request.complete();
                } else if (action == ACTION_COMMENT_ON_REQUEST) {
                    return request.commentFromSlack(payload);
                } else if (action == ACTION_PAGE_REQUEST) {
                    return request.createPagerDutyAlert(payload);
                } else {
                    logger("An unrecognized action was triggered in the Flow Orchestrator: " + action);
                    return false;
                }
            })
            .catch((err: any) => {
                logger(`Failed to claim request for message ${payload.message.thread_ts}` +
                    `Error: ${err.toString()}`);
            });
    }

    public _handleSyncResponse(action: FlowAction, payload: any, _additionalData: any): FlowBehavior {

        if (action === ACTION_PAGE_REQUEST) {
            // This action is triggered by a user clicking on a button in a
            //  request thread.  The immediate response for this (before any action is attempted)
            //  is to remove the page button to ensure the user doesn't click it multiple
            //  times.
            const newBlocks = payload.message.blocks.filter((b: any) => {
                return (b.block_id === "request_description" ||
                    b.block_id === "high_priority_warning")
            });
            newBlocks.push({
                type: "section",
                block_id: "page_request_completed",
                text: {
                    type: "mrkdwn",
                    text: moduleInstance.getActiveModuleConfig().REQUEST_ON_CALL_PRESSED_MSG
                }
            })
            moduleInstance.getSlack().sendMessageResponse(payload, {
                replace_original: true,
                blocks: newBlocks
            });
        }

        return FLOW_CONTINUE;
    }

}
