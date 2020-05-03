
export default (data: any) => {
    return {
        type: "modal",
        callback_id: "infra_request_modal",
        private_metadata: data.context,
        notify_on_close: true,
        title: {
            type: "plain_text",
            text: data.config.title,
            emoji: true
        },
        submit: {
            type: "plain_text",
            text: data.config.fields.submit.label,
            emoji: true
        },
        close: {
            type: "plain_text",
            text: data.config.fields.cancel.label,
            emoji: true
        },
        blocks: [
            {
                type: "section",
                text: {
                    type: "plain_text",
                    text: data.config.description,
                    emoji: true
                }
            },
            {
                type: "divider"
            },
            {
                block_id: "title_input",
                type: "input",
                hint: {
                    type: "plain_text",
                    text: data.config.fields.summary.hint
                },
                label: {
                    type: "plain_text",
                    text: data.config.fields.summary.label,
                    emoji: true
                },
                element: {
                    action_id: "title",
                    type: "plain_text_input",
                    multiline: false,
                    initial_value: data.initialValues.title
                }
            },
            {
                block_id: "category_input",
                type: "input",
                label: {
                    type: "plain_text",
                    text: data.config.fields.type.label,
                    emoji: true
                },
                element: {
                    action_id: "category",
                    type: "static_select",
                    placeholder: {
                        type: "plain_text",
                        text: data.config.fields.type.hint,
                        emoji: true
                    },
                    options: data.components
                }
            },
            {
                block_id: "priority_input",
                type: "input",
                label: {
                    "type": "plain_text",
                    "text": data.config.fields.priority.label,
                    "emoji": true
                },
                element: {
                    action_id: "priority",
                    type: "static_select",
                    placeholder: {
                        type: "plain_text",
                        text: data.config.fields.priority.hint,
                        emoji: true
                    },
                    options: data.priorities
                }
            },
            {
                block_id: "description_input",
                type: "input",
                optional: true,
                hint: {
                    type: "plain_text",
                    text: data.config.fields.description.hint
                },
                label: {
                    type: "plain_text",
                    text: data.config.fields.description.label,
                    emoji: true
                },
                element: {
                    action_id: "description",
                    type: "plain_text_input",
                    multiline: true,
                    initial_value: data.initialValues.description
                }
            }
        ]
    }
}
