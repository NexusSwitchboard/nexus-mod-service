import {View} from '@slack/web-api';
import {IRequestParams} from '../request';
import {prepTitleAndDescription} from '../util';
import moduleInstance, {ServicePriority} from "../..";
import {IModalConfig} from "../config";
import template from "../../views/requestModal.view";

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
 * Generates and shows the issue request Modal shown when a user starts the process of submitting a request.
 */
export default class RequestModal {

    modalConfig: IModalConfig;
    requestInfo: IRequestParams;
    contextIdentifier: string;

    constructor(
        requestInfo: IRequestParams,
        modalConfig: IModalConfig,
        contextIdentifier?: string) {

        this.requestInfo = requestInfo;
        this.modalConfig = Object.assign({}, defaultModalConfig, modalConfig);
        this.contextIdentifier = contextIdentifier;
    }

    /**
     * Sends a message to Slack to show the modal as configured by the input parameters given in the constructor.
     * @param triggerId The slack ID of the trigger that allows this modal to be shown.  This trigger had to have been
     *          generated in the last second (or less).
     */
    public async show(triggerId: string): Promise<boolean> {
        const modal = await moduleInstance.getSlack().apiAsBot.views.open({
            trigger_id: triggerId,
            view: this.generate()
        });
        return modal.ok;
    }

    /**
     * Generates the View JSON required to be passed to the view open call.
     */
    protected generate(): View {
        const {title, description} = prepTitleAndDescription(this.requestInfo.title, this.requestInfo.description);
        const components = moduleInstance.jiraComponents;
        const priorities = moduleInstance.preparedPriorities;
        const triggerMsg = "Selecting this will generate a PagerDuty alert";

        const data = {
            context: this.contextIdentifier,
            config: this.modalConfig,
            initialValues: {
                title,
                description
            },
            components: components.map((c) => {
                return {
                    text: {
                        type: 'plain_text',
                        text: c.name
                    },
                    value: c.id
                };
            }),
            priorities: priorities.map((p: ServicePriority) => {
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

        const ob = template(data) as View;
        return ob;
    }
};
