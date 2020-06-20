import ServiceRequest from "../request";

export type FlowAction = string;
export const ACTION_MODAL_REQUEST: FlowAction = "modal_request";
export const ACTION_MODAL_SUBMISSION: FlowAction = "modal_submission";
export const ACTION_CLAIM_REQUEST: FlowAction = "claim_request";
export const ACTION_COMPLETE_REQUEST: FlowAction = "complete_request";
export const ACTION_CANCEL_REQUEST: FlowAction = "cancel_request";
export const ACTION_COMMENT_ON_REQUEST: FlowAction = "comment_on_request";
export const ACTION_PAGE_REQUEST: FlowAction = "page_request";
export const ACTION_TICKET_CHANGED: FlowAction = "jira_ticket_changed";

export type FlowState = string;
export const STATE_UNKNOWN: FlowState = "unknown";
export const STATE_NO_TICKET: FlowState = "no_ticket";
export const STATE_MID_TICKET_SUBMISSION: FlowState = "mid_ticket_submission";
export const STATE_NOT_STARTED: FlowState = "not_started";
export const STATE_COMPLETED_SUCCESS: FlowState = "completed_successfully";
export const STATE_COMPLETED_FAILED: FlowState = "completed_with_failure";

export abstract class ServiceFlow {

    lastState: FlowState;
    currentState: FlowState;
    request: ServiceRequest;

    public constructor(request: ServiceRequest) {
        this.currentState = this._getStateFromRequest(request);
        this.request = request;
    }

    /**
     * Call this to move the state of the flow from one to another. This will
     * call a derived class version of the function but will handle the state
     * setting once the change has been completed successfully.
     * @param previousState
     * @param newState
     */
    public changeState(previousState: FlowState, newState: FlowState) {
        if (this._changeState(previousState, newState)) {
            this.lastState = this.currentState;
            this.currentState = newState;
        }
    }

    /**
     * Override this to do the work of changing state (without actually altering the
     * state variables (this.lastState and this.currentState) - that will be taken care of by
     * this base class.
     * @param previousState
     * @param newState
     * @private
     */
    protected abstract _changeState (previousState: FlowState, newState: FlowState): boolean;

    /**
     * Override this to set the starting state of the class based on the state of the given
     * request.  The base class will handle the setting of the class's state variables - this just needs
     * to return the state based on the information gathered in the request object.
     * @param request
     * @private
     */
    protected abstract _getStateFromRequest(request: ServiceRequest): FlowState;
}
