import {logger} from "../..";
import {ACTION_COMPLETE_REQUEST, FlowAction, FlowSource} from "../flows";
import ServiceRequest from "../request";
import {Action} from "./index";
import {noop} from "../util";
import {PagerDutyConnection} from "@nexus-switchboard/nexus-conn-pagerduty";
import moduleInstance from "../.."
import {ServiceIntent} from "../intents";

/**
 * The PagerAction will create a new pager duty alert based on the contents of the ticket and the
 * current configuration for the module (which indicates where to create the alert). Here's what it does:
 *
 *  * Create a new Pager Duty alert
 *  * Update the reply message
 *  * Posting of message in Direct Message to Reporter (if applicable)
 *
 */
export class PagerAction extends Action {

    protected pagerDuty:PagerDutyConnection;

    public constructor(options: { source: FlowSource, payload: any, additionalData: any, intent: ServiceIntent }) {
        super(options);
        this.pagerDuty = moduleInstance.getPagerDuty();
    }

    public getType(): FlowAction {return ACTION_COMPLETE_REQUEST}

    /**
     * This is called immediately after a request has changed to this state.  Expect it
     * to be called exactly once after each state change.
     */
    public async postRun(request: ServiceRequest): Promise<ServiceRequest> {
        return request;
    }

    /**
     * This is where the execution of the action happens
     */
    public async run(request: ServiceRequest): Promise<ServiceRequest> {
        try {
            if (this.source === "slack"){
                this.createPagerDutyAlert(request).then(noop);
            }
        } catch (e) {
            logger("Comment handling failed: " + e.toString());
        }
        return request;
    }

    public preRun(request: ServiceRequest): ServiceRequest {
        return request;
    }


    /**
     * Creates a PagerDuty alert if priority is critical
     */
    public async createPagerDutyAlert(request: ServiceRequest) {

        if (!request || !request.ticket) {
            logger("Attempt to create a pager duty alert was made but request has no ticket");
            return;
        }

        try {
            const ticketLink = this.jira.keyToWebLink(this.config.jira.hostname, request.ticket.key);
            let description = `${request.ticket.key}\n${ticketLink}\n-----\n`;
            if (!request.ticket.fields.description) {
                description += "No description given";
            } else {
                description += request.ticket.fields.description;
            }

            // create an alert in pagerduty
            return await this.pagerDuty.api.incidents.createIncident(
                this.intent.getPagerDutyConfig().fromEmail,
                {
                    incident: {
                        type: "incident",
                        title: `${request.ticket.key} - ${request.ticket.fields.summary}`,
                        service: {
                            id: this.config.pagerDuty.serviceDefault,
                            type: "service_reference"
                        },
                        body: {
                            type: "incident_body",
                            details: description
                        },
                        escalation_policy: {
                            id: this.config.pagerDuty.escalationPolicyDefault,
                            type: "escalation_policy_reference"
                        }
                    }
                });
        } catch (e) {
            logger("PagerDuty alert failed: " + e.toString());
            return undefined;
        }
    }

}
