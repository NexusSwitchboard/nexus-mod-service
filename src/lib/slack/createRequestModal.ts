import { View } from '@slack/web-api';
import { IRequestParams, ServiceComponent } from '../request';
import { prepTitleAndDescription } from '../util';

/**
 * Represents the modal that is shown when the user initially
 */
export const getCreateRequestModalView = (defaults: IRequestParams,
                                          components: ServiceComponent[],
                                          metadata?: string): View => {
    const { title, description } = prepTitleAndDescription(defaults.title, defaults.description);

    return {
        type: 'modal',
        callback_id: 'infra_request_modal',
        private_metadata: metadata,
        notify_on_close: true,
        title: {
            type: 'plain_text',
            text: 'Submit Infra Request',
            emoji: true
        },
        submit: {
            type: 'plain_text',
            text: 'Submit',
            emoji: true
        },
        close: {
            type: 'plain_text',
            text: 'Cancel',
            emoji: true
        },
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'plain_text',
                    text: 'This will create a ticket for you and alert the Infrastructure team.  You  can following progress either in the associated thread or the ticket itself.',
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
                    text: 'This field cannot be more than 255 characters'
                },
                label: {
                    type: 'plain_text',
                    text: 'Summary',
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
                    text: 'Type of Request',
                    emoji: true
                },
                element: {
                    action_id: 'category',
                    type: 'static_select',
                    placeholder: {
                        type: 'plain_text',
                        text: 'Select the type of request this is',
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
                    text: 'This populates the \'description\' field in the created Jira Ticket (optional)'
                },
                label: {
                    type: 'plain_text',
                    text: 'Additional Information',
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
