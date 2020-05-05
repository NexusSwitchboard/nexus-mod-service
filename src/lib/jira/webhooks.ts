import { IWebhookPayload, WebhookConfiguration } from "atlassian-addon-helper";
import { getNestedVal, ModuleConfig } from "@nexus-switchboard/nexus-extend";
import ServiceRequest from "../request";
import { JiraIssueSidecarData } from "../slack/slackThread";
import serviceMod, { logger } from "../../index";

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
                // The only issues that we should receive here are those that match
                //  the filter above so there shouldn't be a need to reverify that these
                //  are of the right project and have the right labels.

                // Hopefully, custom the properties were returned along with the rest of the ticket info.  If
                //  not we have to make a separate request to get them.
                let prop = getNestedVal(payload, "issue.properties");
                if (!prop) {
                    const jiraApi = serviceMod.getJira().api;
                    prop = await jiraApi.issueProperties.getIssueProperty({
                        issueIdOrKey: payload.issue.key,
                        propertyKey: config.REQUEST_JIRA_SERVICE_LABEL
                    });

                    if (prop) {
                        prop = prop.value;
                    }

                } else {
                    if (prop.infrabot) {
                        prop = prop.infrabot;
                    } else {
                        prop = undefined;
                    }
                }

                if (!prop) {
                    // Probably an older infrabot request ticket.  Skip
                    return false;
                }

                // Figure out what changed
                const changes = payload.changelog.items;
                let doUpdate = false;
                changes.forEach((c: any) => {
                    if (["status", "summary","description", "assignee"].indexOf(c.field) >= 0) {
                        doUpdate = true;
                    }
                });

                if (!doUpdate) {
                    return false;
                }

                const info:JiraIssueSidecarData = prop;
                const request = await ServiceRequest.loadThreadFromJiraEvent(info,payload);
                if (request) {
                    await request.updateSlackThread();
                    return true;
                }

                logger("Unable to create a request thread object from the event data");
                return false;
            }
        }
    ]

};
