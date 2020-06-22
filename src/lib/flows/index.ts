import ServiceRequest from "../request";
import {FlowOrchestrator} from "./orchestrator";
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

export type FlowBehavior = string;
export const FLOW_CONTINUE = "flow_continue";
export const FLOW_HALT = "flow_halt";
export const FLOW_LAST_STEP = "flow_last_step";

export type FlowSource = "jira" | "slack"

export type FlowState = string;
export const STATE_NO_TICKET: FlowState = "no_ticket";
export const STATE_TODO: FlowState = "todo";
export const STATE_ERROR: FlowState = "error";
export const STATE_UNKNOWN: FlowState = "unknown";

export type FlowAccessType = "allow" | "deny";
type FlowControl = {
    [key: string]: {
        access: FlowAccessType
    }
}

export abstract class ServiceFlow {

    protected flowControl: FlowControl;

    public constructor() {
        this.flowControl = {
            "**": { access: "allow" }
        }
    }

    private static makeControlFlowKey(key: string, action: string) {
        return (key || "*") + (action || "*");
    }

    public setControlFlow(key: string, action: string, access: FlowAccessType) {
        this.flowControl[ServiceFlow.makeControlFlowKey(key,action)] = {access}
    }

    public getControlFlow(key: string, action: string) {
        let cf = this.flowControl[ServiceFlow.makeControlFlowKey(key,action)];
        if (!cf) {
            cf = this.flowControl[ServiceFlow.makeControlFlowKey(key,"*")]
            if (!cf) {
                cf = this.flowControl[ServiceFlow.makeControlFlowKey("*",action)]
                if (!cf) {
                    cf = this.flowControl[ServiceFlow.makeControlFlowKey("*","*")]

                }
            }
        }
        return cf ? cf.access : "allow";
    }

    /**
     * Handles the reaction to an action performed by the user through one of the flow clients (e.g. Slack).
     * @param source
     * @param action
     * @param payload
     * @param additionalData
     */
    public async handleAsyncAction(source: FlowSource, action: FlowAction, payload: any, additionalData: any): Promise<void> {

        // This function will call the derived async response handler but it
        //  will also ensure that you don't have multiple calls for the same action
        //  and the same request.
        const asyncHandler = (request: ServiceRequest) => {
            const key = request.ticket ? request.ticket.key : undefined;
            if (this.getControlFlow(key,action) === "allow") {
                this._handleAsyncResponse(request, action, payload, additionalData)
                    .finally(() => {});
            } else {
                logger(`Action ${action} being performed on ${request.ticket.key} was blocked due to a control flow rule`)
            }
        }

        if (this._getFlowActions(payload, additionalData).indexOf(action) > -1) {

            if (source === "jira") {
                // We build a request from a jira event (which has to be done differently
                //  than with slack events).
                FlowOrchestrator.buildRequestObFromJiraEvent(payload)
                    .then(asyncHandler);

            } else if (source === "slack") {
                // We build a request from a slack event (which has to be done differently
                //  than with jira events).
                FlowOrchestrator.buildRequestObFromSlackEvent(payload)
                    .then(asyncHandler);
            }
        }
    }

    /**
     * Handle the initial sync response - this must not return a Promise.
     * @param _source
     * @param action
     * @param payload
     * @param additionalData
     */
    public handleSyncAction(_source: FlowSource, action: FlowAction, payload: any, additionalData: any): FlowBehavior {
        if (this._getFlowActions(payload, additionalData).indexOf(action) > -1) {
            return this._handleSyncResponse(action, payload, additionalData);
        } else {
            return FLOW_CONTINUE;
        }
    }

    /**
     * Handled by the derived flow and interrogates the given request object to determine its state
     * in the flow.  If the state is not discernible then the state is not changed.
     */
    protected abstract _setRequestState(request: ServiceRequest): FlowState;

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
     * @param request
     * @param action
     * @param payload
     * @param additionalData
     * @private
     */
    protected abstract async _handleAsyncResponse(request: ServiceRequest, action: FlowAction, payload: any, additionalData: any): Promise<void>;

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
    protected abstract _handleSyncResponse(action: FlowAction, payload: any, additionalData: any): FlowBehavior;

}
