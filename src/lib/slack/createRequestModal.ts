import { View } from '@slack/web-api';
import { IRequestParams } from '../request';
import { prepTitleAndDescription } from '../util';
import moduleInstance, { ServicePriority } from "../..";

export interface IModalText {
    label?: string,
    hint?: string
}

export interface IModalConfig {
    title?: string,
    description?: string,
    fields?: {
        summary?: IModalText,
        description?: IModalText,
        type?: IModalText,
        priority?: IModalText,
        submit?: IModalText,
        cancel?: IModalText
    }
}

const defaultModalConfig = {
    title: "Submit Request",
    description: "Once submitted, you can follow progress either in Slack or in Jira.\n",
    fields: {
        summary: {
            label: "Summary",
            hint: "This field cannot be more than 255 characters"
        },
        description: {
            label: "Additional Information",
            hint: "This populates the 'description' field in the created Jira Ticket (optional)"
        },
        priority: {
            label: "Priority",
            hint: "Some priorities will trigger a PagerDuty incident"
        },
        type: {
            label: "Type of Request",
            hint: "Choose the category of request you are making"
        },
        submit: {
            label: "Submit",
        },
        cancel: {
            label: "Cancel",
        }
    }
}

/**
 * Represents the modal that is shown when the user initially
 * @param defaults: The default values to use
 * @param modalConfig: Configuration for text in the modal.  Any values that are not defined in the
 *              given object will use the default values defined in defaultModalConfig.
 * @param metadata: A way to pass through data to the event handlers
 */
export const getCreateRequestModalView = (defaults: IRequestParams,
                                          modalConfig: IModalConfig,
                                          metadata?: string): View => {

    const mc:IModalConfig = Object.assign({}, defaultModalConfig, modalConfig);
    const { title, description } = prepTitleAndDescription(defaults.title, defaults.description);
    const components = moduleInstance.jiraComponents;
    const priorities = moduleInstance.preparedPriorities;
    const triggerMsg = "Selecting this will generate a PagerDuty alert";

    return {
        type: 'modal',
        callback_id: 'infra_request_modal',
        private_metadata: metadata,
        notify_on_close: true,
        title: {
            type: 'plain_text',
            text: mc.title,
            emoji: true
        },
        submit: {
            type: 'plain_text',
            text: mc.fields.submit.label,
            emoji: true
        },
        close: {
            type: 'plain_text',
            text: mc.fields.cancel.label,
            emoji: true
        },
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'plain_text',
                    text: mc.description,
                    emoji: true
                }
            },
            {
                type: 'divider'
            },
            {
                block_id: 'title_input',
                type: 'input',
                hint: {
                    type: 'plain_text',
                    text: mc.fields.summary.hint
                },
                label: {
                    type: 'plain_text',
                    text: mc.fields.summary.label,
                    emoji: true
                },
                element: {
                    action_id: 'title',
                    type: 'plain_text_input',
                    multiline: false,
                    initial_value: title || ''
                }
            },
            {
                block_id: 'category_input',
                type: 'input',
                label: {
                    type: 'plain_text',
                    text: mc.fields.type.label,
                    emoji: true
                },
                element: {
                    action_id: 'category',
                    type: 'static_select',
                    placeholder: {
                        type: 'plain_text',
                        text: mc.fields.type.hint,
                        emoji: true
                    },
                    options: components.map((c) => {
                            return {
                                text: {
                                    type: 'plain_text',
                                    text: c.name
                                },
                                value: c.id
                            };
                        }
                    )
                }
            },
            {
                block_id: 'priority_input',
                type: "input",
                label: {
                    "type": "plain_text",
                    "text": mc.fields.priority.label,
                    "emoji": true
                },
                element: {
                    action_id: 'priority',
                    type: 'static_select',
                    placeholder: {
                        type: 'plain_text',
                        text: mc.fields.priority.hint,
                        emoji: true
                    },
                    options: priorities.map((p: ServicePriority) => {
                            return {
                                text: {
                                    type: 'plain_text',
                                    text: p.name
                                },
                                value: p.jiraId,
                                description: {
                                    type: "plain_text",
                                    text: p.triggersPagerDuty ? triggerMsg : p.description
                                }
                            };
                        }
                    )
                }
            },
            {
                block_id: 'description_input',
                type: 'input',
                optional: true,
                hint: {
                    type: 'plain_text',
                    text: mc.fields.description.hint
                },
                label: {
                    type: 'plain_text',
                    text: mc.fields.description.label,
                    emoji: true
                },
                element: {
                    action_id: 'description',
                    type: 'plain_text_input',
                    multiline: true,
                    initial_value: description || ''
                }
            }
        ]
    };
};
