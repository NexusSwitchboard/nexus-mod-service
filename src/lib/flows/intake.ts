import {
    ACTION_MODAL_REQUEST,
    ACTION_CREATE_REQUEST, ACTION_TICKET_CHANGED, FLOW_CONTINUE,
    FlowAction, FlowBehavior,
    ServiceFlow, FlowSource, FLOW_HALT, STATE_TODO, ACTION_PAGE_REQUEST
} from "./index";
import {findNestedProperty, getNestedVal} from "@nexus-switchboard/nexus-extend";
import moduleInstance, {logger} from "../../index";
import ServiceRequest, {
    IRequestParams,
    IRequestState, IssueAction
} from "../request";

import RequestModal from "../slack/requestModal";
import {getMessageFromSlackErr, noop} from "../util";
import {CreateAction} from "../actions/create";
import {Action} from "../actions";
import {ChangeAction} from "../actions/change";
import {PagerAction} from "../actions/pager";

const viewButton: IssueAction = {
    code: "view_request",
    name: "View Ticket",
    style: "primary",
    url: undefined
};

/**
 *
 * INTAKE FLOW
 *
 * Handles actions that involve receiving details about the request and saving them to Jira
 *
 * ACTIONS HANDLED:
 * > START - A user has initiated some type of request (probably through slack)
 *          -> Sends message to Slack to show the request details collection form. It  does this on the
 *              immediate response and does not use an action.
 * > CREATE - A user has submitted the collection modal -> forwards to CreateAction
 * > CHANGED - A user has made a change outside of slack -> forwards to ChangeAction
 * > PAGE - A user has pressed the Emergency Page button -> forwards to PagerAction
 *
 *  UPDATES MADE:
 *  > Buttons: Adds the View Ticket button
 *  > Fields: Adds the Reported By field
 *  > icons: Sets the icon for SUBMITTED (or OPEN).
 *  > state: Sets the STATE_TODO state
 */
export class IntakeFlow extends ServiceFlow {

    protected _getFlowActions(_payload: any, _additionalData: any): FlowAction[] {
        return [ACTION_MODAL_REQUEST, ACTION_CREATE_REQUEST, ACTION_TICKET_CHANGED, ACTION_PAGE_REQUEST]
    }

    protected async _handleEventResponse(source: FlowSource, request: ServiceRequest, action: FlowAction, payload: any, additionalData: any): Promise<ServiceRequest> {
        let actionOb: Action;

        if (action === ACTION_CREATE_REQUEST) {
            actionOb = new CreateAction({source, payload, additionalData, intent: this.intent});
        } else if (action === ACTION_TICKET_CHANGED) {
            actionOb = new ChangeAction({source, payload, additionalData, intent: this.intent});
        } else if (action == ACTION_PAGE_REQUEST) {
            actionOb = new PagerAction({source, payload, additionalData, intent: this.intent});
        }

        if (actionOb) {
            try {
                request = actionOb.preRun(request);
                request = await actionOb.run(request);
                request = await actionOb.postRun(request);
            } catch (e) {
                logger("Received an exception during IntakeFlow run sequence: " + e.toString())
            }
        }
        return request;

    }

    protected _getImmediateResponse(_source: FlowSource, action: FlowAction, payload: any, additionalData: any): FlowBehavior {
        if (action === ACTION_MODAL_REQUEST) {
            const text = additionalData ? additionalData.defaultText : undefined;
            this.beginRequestCreation(payload, text).then(noop);
            return FLOW_HALT;
        }

        return FLOW_CONTINUE
    }

    /**
     * This static method should be used  when there is no existing thread for the request.  This will
     * do the work of posting the top level message and displaying the modal that collects input from the user.
     *
     * @param payload
     * @param defaultText
     */
    public async beginRequestCreation(payload: any, defaultText?: string): Promise<boolean> {

        if (!defaultText) {
            defaultText = moduleInstance.getSlack().extractTextFromPayload(payload).join("");
        }

        const channel = this.intent.getSlackConfig().primaryChannel;
        const triggerId = getNestedVal(payload, 'trigger_id');

        if (channel) {
            const slackUserId = findNestedProperty(payload, "user", "id");
            await this.showCreateModal(triggerId, {
                slackUserId,
                title: defaultText,
                channelId: channel
            });
            return true;
        } else {
            logger("Unable to show the create modal because the originating channel could not be found");
            return false;
        }
    }

    /**
     * This will show the infra request modal and use the message that triggered it to prepopulate it.
     * @param triggerId
     * @param requestParams
     */
    protected async showCreateModal(triggerId: string, requestParams: IRequestParams): Promise<boolean> {

        try {

            const modal = new RequestModal({
                requestInfo: requestParams,
                intent: this.intent,
                contextIdentifier: requestParams.channelId
            });
            
            return modal.show(triggerId);

        } catch (e) {
            logger("Exception thrown: Trying to show the create modal: " + getMessageFromSlackErr(e));
            return false;
        }
    }

    public async updateState(request: ServiceRequest): Promise<IRequestState> {

        if (request) {

            if (request.ticket) {
                const cat: string = getNestedVal(request.ticket, "fields.status.statusCategory.name");

                let updatedState: IRequestState = {icon: "", state: "", actions: [], fields: []};
                if (["undefined", "to do", "new"].indexOf(cat.toLowerCase()) >= 0) {
                    updatedState.state = STATE_TODO;
                    updatedState.icon = this.intent.config.text.emojiSubmitted || ":black_circle:";
                    updatedState.fields.push(
                        {
                            title: "Reported By",
                            value: request.reporter.getBestUserStringForSlack()
                        }
                    );
                }

                const vb = Object.assign({}, viewButton);
                vb.url = this.jira.keyToWebLink(this.config.jira.hostname, request.ticket.key);
                updatedState.actions.push(vb)

                return updatedState;
            }

        }

        return undefined;
    }

}
