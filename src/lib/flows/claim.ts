import {
    ACTION_CANCEL_REQUEST,
    ACTION_CLAIM_REQUEST,
    ACTION_COMMENT_ON_REQUEST,
    ACTION_COMPLETE_REQUEST,
    ACTION_PAGE_REQUEST,
    FLOW_CONTINUE,
    FlowAction,
    FlowBehavior,
    FlowSource,
    FlowState,
    ServiceFlow
} from ".";

import {getNestedVal} from "@nexus-switchboard/nexus-extend";
import moduleInstance, {logger} from "../../index";
import ServiceRequest, {IRequestState, IssueAction} from "../request";

import Orchestrator from "./orchestrator";
import {Action} from "../actions";
import {ClaimAction} from "../actions/claim";
import {CancelAction} from "../actions/cancel";
import {CompleteAction} from "../actions/complete";
import {CommentAction} from "../actions/comment";

export const STATE_CLAIMED: FlowState = "claimed";
export const STATE_COMPLETED: FlowState = "completed";
export const STATE_CANCELLED: FlowState = "cancelled";

export const claimButton: IssueAction = {
    code: "claim_request",
    name: "Claim",
    style: "primary"
};

export const cancelButton: IssueAction = {
    code: "cancel_request",
    name: "Cancel",
    style: "danger"
};

export const completeButton: IssueAction = {
    code: "complete_request",
    name: "Complete",
    style: "primary"
};

/**
 * CLAIM FLOW
 *
 * The claim flow handles the following flow after a ticket has been created (it's expected that the Intake flow
 * is part of the orchestration):
 *
 *  ACTIONS HANDLED:
 *  > CLAIM - A user has pressed the claim button -> forwards to ClaimAction
 *  > COMPLETE - A user has pressed the complete button -> forwards to CompleteAction
 *  > CANCEL - A user has pressed the cancel button -> forwards to CancelAction
 *  > COMMENT - A user has posted a comment on slack -> forwards to CommentAction
 *
 *  UPDATES MADE:
 *  > Buttons: Adds the Claim and Complete Button
 *  > Fields: Adds the Claimed By, Completed By and Cancelled By fields
 *  > icons: Sets the icon for CLAIMED, CANCELLED and COMPLETED states.
 *  > state: Sets the STATE_CLAIMED, STATE_CANCELLED and STATE_COMPLETED states.
 */
export class ClaimFlow extends ServiceFlow {

    protected _getFlowActions(_payload: any, _additionalData: any): FlowAction[] {
        return [ACTION_CLAIM_REQUEST, ACTION_CANCEL_REQUEST,
            ACTION_COMPLETE_REQUEST, ACTION_COMMENT_ON_REQUEST,
            ACTION_PAGE_REQUEST]
    }

    protected async _handleEventResponse(source: FlowSource, request: ServiceRequest, action: FlowAction, payload: any, additionalData: any): Promise<ServiceRequest> {

        if (!request || !request.ticket) {
            return request;
        }

        let actionOb: Action = undefined;

        if (action === ACTION_CLAIM_REQUEST) {
            actionOb = new ClaimAction(source, payload, additionalData);
        } else if (action == ACTION_CANCEL_REQUEST) {
            actionOb = new CancelAction(source, payload, additionalData);
        } else if (action == ACTION_COMPLETE_REQUEST) {
            actionOb = new CompleteAction(source, payload, additionalData);
        } else if (action == ACTION_COMMENT_ON_REQUEST) {
            actionOb = new CommentAction(source, payload, additionalData);
        } else {
            logger("An unrecognized action was triggered in the Flow Orchestrator: " + action);
        }

        if (actionOb) {

            try {
                Orchestrator.setControlFlow(request.ticket.key, action, "deny");

                request = actionOb.preRun(request);
                request = await actionOb.run(request);
                request = await actionOb.postRun(request);

            } finally {
                Orchestrator.setControlFlow(request.ticket.key, action, "allow");
            }
        }

        return request;
    }

    public _getImmediateResponse(_source: FlowSource, action: FlowAction, payload: any, _additionalData: any): FlowBehavior {

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

    public async updateState(request: ServiceRequest): Promise<IRequestState> {

        if (request.ticket) {
            let updatedState: IRequestState = {icon: "", state: "", actions: [], fields: []};
            const cat: string = getNestedVal(request.ticket, "fields.status.statusCategory.name");

            if (["undefined", "to do", "new"].indexOf(cat.toLowerCase()) >= 0) {

                //
                // GET STATE FOR NOT STARTED REQUEST
                //
                // we only need to add the actions specific to this flow.  Since the "new" state is not
                // natively part of this flow, we expect another flow to handle the other state properties.
                updatedState.actions.push(claimButton, cancelButton);

            } else if (["indeterminate", "in progress"].indexOf(cat.toLowerCase()) >= 0) {

                //
                // GET STATE FOR IN CLAIMED REQUEST
                //
                updatedState.state = STATE_CLAIMED;
                updatedState.actions.push(completeButton, cancelButton);
                updatedState.fields.push({
                    title: "Claimed By",
                    value: request.claimer.getBestUserStringForSlack()
                });
                updatedState.icon = this.config.REQUEST_WORKING_SLACK_ICON || ":clock1:";

            } else if (["complete", "done"].indexOf(cat.toLowerCase()) >= 0) {

                //
                // GET STATE FOR COMPLETED REQUEST
                //
                const resolution: string = getNestedVal(request.ticket, "fields.resolution.name");
                if (!resolution || resolution.toLowerCase() === this.config.REQUEST_JIRA_RESOLUTION_DONE.toLowerCase()) {
                    updatedState.state = STATE_COMPLETED;
                    updatedState.icon = this.config.REQUEST_COMPLETED_SLACK_ICON || ":white_circle:";
                    updatedState.fields.push({
                        title: "Completed By",
                        value: request.closer.getBestUserStringForSlack()
                    });
                } else {
                    updatedState.state = STATE_CANCELLED;
                    updatedState.icon = this.config.REQUEST_CANCELLED_SLACK_ICON || ":red_circle:";
                    updatedState.fields.push({
                        title: "Cancelled By",
                        value: request.closer.getBestUserStringForSlack()
                    });
                }
            }

            return updatedState;
        }

        return request.state;
    }
}
