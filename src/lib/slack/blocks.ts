import {View} from "@slack/web-api";
import {IRequestParams} from "../request";
import {JiraTicket} from "@nexus-switchboard/nexus-conn-jira";
import moduleInstance, {logger} from "../..";

export interface ITopLevelMessageInput {
    status: string,
    jiraTicket?: JiraTicket,
    slackUserId?: string,
    message?: string,
    errorMsg?: string
}

export const msgRequestSubmitted = (info: ITopLevelMessageInput) => {

    if (!info.jiraTicket && !info.message) {
        logger("An attempt to change the top level message was made but there was no message or ticket given");
        return undefined;
    }

    const config = moduleInstance.getActiveConfig();

    const statusToIconMap: Record<string,any> = {
        "communicating": {
            icon: config.REQUEST_COMMS_SLACK_ICON || ":zap:",
            text: `*Communicating with Jira*`
        },
        "error": {
            icon: config.REQUEST_ERROR_SLACK_ICON || ":x:",
            text: `*Error Occurred in Infrabot*`
        },
        "completed": {
            icon: config.REQUEST_COMPLETED_SLACK_ICON || ":white_circle:",
            text: `*Completed* by <@${info.slackUserId}>`
        },
        "submitting": {
            icon: config.REQUEST_SUBMITTING_SLACK_ICON || ":clock1:",
            text: `<@${info.slackUserId}> is *Entering Request Details*`
        },
        "submitted": {
            icon: config.REQUEST_SUBMITTED_SLACK_ICON || ":black_circle:",
            text: `*Submitted* by <@${info.slackUserId}>`
        },
        "cancelled": {
            icon: config.REQUEST_CANCELLED_SLACK_ICON || ":red_circle:",
            text: `*Cancelled* by <@${info.slackUserId}>`
        },
        "claimed": {
            icon: config.REQUEST_CLAIMED_SLACK_ICON || ":large_blue_circle",
            text: `*Claimed* by <@${info.slackUserId}>`
        },
        "_default": {
            icon: ":red_circle",
            text: `*Last Action Performed* by <@${info.slackUserId}`
        }
    };

    const props = statusToIconMap.hasOwnProperty(info.status) ? statusToIconMap[info.status] : statusToIconMap._default;

    let textMsg:string;
    if (info.jiraTicket) {
        const jiraLink = moduleInstance.getJira().keyToWebLink(config.JIRA_HOST, info.jiraTicket.key);
        textMsg = `<${jiraLink}|${info.jiraTicket.key}: ${info.jiraTicket.fields.summary}>`;
    } else {
        textMsg = info.message;
    }

    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `Request: *${textMsg}*`
            }
        },
        {
            type: "context",
            elements: [
                {
                    type: "mrkdwn",
                    text: `${props.icon} ${props.text}`
                }
            ]
        }
    ];
};

/**
 * Represents the modal that is shown when the user initially
 */
export const dlgServiceRequest = (defaults: IRequestParams, metadata?: string): View => ({
    type: "modal",
    callback_id: "infra_request_modal",
    private_metadata: metadata,
    notify_on_close: true,
    title: {
        type: "plain_text",
        text: "Submit Infra Request",
        emoji: true
    },
    submit: {
        type: "plain_text",
        text: "Submit",
        emoji: true
    },
    close: {
        type: "plain_text",
        text: "Cancel",
        emoji: true
    },
    blocks: [
        {
            type: "section",
            text: {
                type: "plain_text",
                text: "This will create a ticket for you and alert the Infrastructure team.  You  can following progress either in the associated thread or the ticket itself.",
                emoji: true
            }
        },
        {
            type: "divider"
        },
        {
            block_id: "title_input",
            type: "input",
            label: {
                type: "plain_text",
                text: "Summary",
                emoji: true
            },
            element: {
                action_id: "title",
                type: "plain_text_input",
                multiline: false,
                initial_value: defaults.title || ""
            }
        },
        // {
        //     block_id: "priority_input",
        //     type: "input",
        //     label: {
        //         type: "plain_text",
        //         text: "Priority",
        //         emoji: true
        //     },
        //     element: {
        //         action_id: "priority",
        //         type: "static_select",
        //         placeholder: {
        //             type: "plain_text",
        //             text: "Select an item",
        //             emoji: true
        //         },
        //         options: [
        //             {
        //                 text: {
        //                     type: "plain_text",
        //                     text: "High",
        //                     emoji: true
        //                 },
        //                 value: "high"
        //             },
        //             {
        //                 text: {
        //                     type: "plain_text",
        //                     text: "Medium",
        //                     emoji: true
        //                 },
        //                 value: "low"
        //             },
        //             {
        //                 text: {
        //                     type: "plain_text",
        //                     text: "Emergency",
        //                     emoji: true
        //                 },
        //                 value: "blocker"
        //             }
        //         ]
        //     }
        // },
        {
            block_id: "category_input",
            type: "input",
            label: {
                type: "plain_text",
                text: "Type of Request",
                emoji: true
            },
            element: {
                action_id: "category",
                type: "static_select",
                placeholder: {
                    type: "plain_text",
                    text: "Select the type of request this is",
                    emoji: true
                },
                options: [
                    {
                        text: {
                            type: "plain_text",
                            text: "Access Request",
                            emoji: true
                        },
                        value: "type-access"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Cluster Troubleshooting",
                            emoji: true
                        },
                        value: "type-cluster"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Tool Troubleshooting",
                            emoji: true
                        },
                        value: "type-tools"
                    },
                    {
                        text: {
                            type: "plain_text",
                            text: "Something else",
                            emoji: true
                        },
                        value: "type-other"
                    }
                ]
            }
        },
        {
            block_id: "description_input",
            type: "input",
            optional: true,
            hint: {
                type: "plain_text",
                text: "This populates the 'description' field in the created Jira Ticket (optional)"
            },
            label: {
                type: "plain_text",
                text: "Additional Information",
                emoji: true
            },
            element: {
                action_id: "description",
                type: "plain_text_input",
                multiline: true,
                initial_value: defaults.description || ""
            }
        }
    ]
});
