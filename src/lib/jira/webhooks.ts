import {IWebhookPayload, WebhookConfiguration} from "atlassian-addon-helper";
import {ModuleConfig} from "@nexus-switchboard/nexus-extend";
import {logger} from "../../index";
import Orchestrator from "../flows/orchestrator";
import {ACTION_TICKET_CHANGED} from "../flows";

export default (config: ModuleConfig): WebhookConfiguration[] => {

    let filter: string;
    const label = config.REQUEST_JIRA_SERVICE_LABEL;
    if (config.REQUEST_JIRA_PROJECT) {
        filter = `project="${config.REQUEST_JIRA_PROJECT}" and labels in ("${label}-request")`
    } else {
        logger("Webhooks could not be setup because there was no Jira project specified in the config");
        return []
    }

    return [
        {
            definition: {
                event: "jira:issue_updated",
                filter,
                propertyKeys: [config.REQUEST_JIRA_SERVICE_LABEL]

            },
            handler: async (payload: IWebhookPayload): Promise<boolean> => {

                // Only handle this change if one of the relevant fields changed.  Iterate through
                //  the changes and as soon a relevant one is encountered, notify the orchestrator
                //  and exit the loop.
                for (let change of payload.changelog.items) {
                    if (["status", "summary", "description", "assignee"].indexOf(change.field) >= 0) {
                        Orchestrator.entryPoint("jira", ACTION_TICKET_CHANGED, payload);
                        break;
                    }
                }

                return Promise.resolve(true);
            }
        }
    ]

};
