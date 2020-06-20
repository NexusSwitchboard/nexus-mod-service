import {logger} from "../../index";

export type FlowAction = string;
export const ACTION_MODAL_REQUEST: FlowAction = "modal_request";
export const ACTION_MODAL_SUBMISSION: FlowAction = "modal_submission";
export const ACTION_CLAIM_REQUEST: FlowAction = "claim_request";
export const ACTION_COMPLETE_REQUEST: FlowAction = "complete_request";
export const ACTION_CANCEL_REQUEST: FlowAction = "cancel_request";
export const ACTION_COMMENT_ON_REQUEST: FlowAction = "comment_on_request";
export const ACTION_PAGE_REQUEST: FlowAction = "page_request";
export const ACTION_TICKET_CHANGED: FlowAction = "jira_ticket_changed";

export abstract class ServiceFlow {

    /**
     * Handles the reaction to an action performed by the user through one of the flow clients (e.g. Slack).
     * @param action
     * @param payload
     * @param additionalData
     */
    public async handleAction(action: FlowAction, payload: any, additionalData: any): Promise<boolean> {

        if (this._getFlowActions(payload, additionalData).indexOf(action) > -1) {
            if (this._handleActionImmediateResponse(action, payload, additionalData)) {
                return this._handleActionSlowResponse(action, payload, additionalData).catch((e) => {
                    logger("Failed to handle slow response: " + e.toString());
                    return false;
                });
            }
        }

        return true;
    }

    /**
     * Gets a list of the actions that this flow supports.
     */
    protected abstract _getFlowActions(payload: any, additionalData: any): FlowAction[];

    /**
     * _handleAction is meant to be overridden to perform the necessary *post-response* steps.  That is, the
     * steps that can be taken without any significant restriction on time limits.  For example, trigger_id based
     * responses must happen within 3 seconds of initial trigger.  _handleAction is NOT where this should happen. Instead
     * it should happen within the _handleImmediateResponse method.
     *
     * Return true to continue with next action, false otherwise.
     *
     * @param action
     * @param payload
     * @param additionalData
     * @private
     */
    protected abstract async _handleActionSlowResponse(action: FlowAction, payload: any, additionalData: any): Promise<boolean>;

    /**
     * _handleActionImmediateResponse is meant to be overridden to perform the necessary actions that must be
     * performed within a very short time limit.  This can be assumed to be happening without any previous await calls
     * so that things that rely on short-lived triggers (for example) can be safely done here.
     *
     * Return true to continue with action, false otherwise.
     * @param action
     * @param payload
     * @param additionalData
     * @private
     */
    protected abstract _handleActionImmediateResponse(action: FlowAction, payload: any, additionalData: any): boolean;

}
