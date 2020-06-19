import ServiceRequest from "../request";
import {
    FlowState,
    ServiceFlow,
    STATE_COMPLETED_FAILED,
    STATE_COMPLETED_SUCCESS,
    STATE_NO_TICKET,
    STATE_NOT_STARTED,
    STATE_UNKNOWN
} from ".";
import {getNestedVal} from "@nexus-switchboard/nexus-extend";

const STATE_CLAIMED = "claimed";

export class ClaimFlow extends ServiceFlow {
    protected _changeState(_previousState: FlowState, _newState: FlowState): boolean {
        return false;
    }
    protected _getStateFromRequest(request: ServiceRequest): FlowState {
        if (!request.ticket) {
            return STATE_NO_TICKET;
        }

        const cat: string = getNestedVal(request.ticket, "fields.status.statusCategory.name");

        if (["undefined", "to do", "new"].indexOf(cat.toLowerCase()) >= 0) {
            return STATE_NOT_STARTED;
        } else if (["indeterminate", "in progress"].indexOf(cat.toLowerCase()) >= 0) {
            return STATE_CLAIMED;
        } else if (["complete", "done"].indexOf(cat.toLowerCase()) >= 0) {
            const resolution: string = getNestedVal(this.request.ticket, "fields.resolution.name");
            if (resolution) {
                if (resolution.toLowerCase() === ServiceRequest.config.REQUEST_JIRA_RESOLUTION_DONE.toLowerCase()) {
                    return STATE_COMPLETED_SUCCESS;
                } else {
                    return STATE_COMPLETED_FAILED;
                }
            }
            return STATE_COMPLETED_SUCCESS;
        } else {
            return STATE_UNKNOWN;
        }
    }
}
