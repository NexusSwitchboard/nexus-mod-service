import { View } from '@slack/web-api';
import { IRequestParams, ServiceComponent } from '../request';
import { prepTitleAndDescription } from '../util';

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
        submit?: IModalText,
        cancel?: IModalText
    }
}

const defaultModalConfig = {
    title: "Submit Request",
    description: "This will create a ticket for you and alert a system administrator.  You  can following progress either in the associated thread or the ticket itself.\n",
    fields: {
        summary: {
            label: "Summary",
            hint: "This field cannot be more than 255 characters"
        },
        description: {
            label: "Additional Information",
            hint: "This populates the 'description' field in the created Jira Ticket (optional)"
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
 * @param components: The components to use in the type dropdown
 * @param metadata: A way to pass through data to the event handlers
 */
export const getCreateRequestModalView = (defaults: IRequestParams,
                                          modalConfig: IModalConfig,
                                          components: ServiceComponent[],
                                          metadata?: string): View => {

    const mc:IModalConfig = Object.assign({}, defaultModalConfig, modalConfig);
    const { title, description } = prepTitleAndDescription(defaults.title, defaults.description);

    const modal:View = {
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

        return modal;
};
