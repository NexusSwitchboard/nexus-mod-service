import {ACTION_TICKET_CHANGED, FlowAction} from "../flows";
import ServiceRequest from "../request";
import {Action} from "./index";
import Orchestrator from "../flows/orchestrator";

export class ChangeAction extends Action {
    public getType(): FlowAction {return ACTION_TICKET_CHANGED}

    public async postRun(request: ServiceRequest): Promise<ServiceRequest> {
        return request;
    }

    public async run(request: ServiceRequest): Promise<ServiceRequest> {
        // Determine which action occurred in Jira and trigger the same action here.
        if (!request) {
            return request;
        }

        await Orchestrator.updateState(request);

        return request;
    }

    public preRun(request: ServiceRequest): ServiceRequest {
        return request;
    }
}
