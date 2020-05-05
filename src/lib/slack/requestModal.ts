import {prepTitleAndDescription} from '../util';
import moduleInstance from "../..";
import SlackModal, {IModalConfig, IModalField, IModalFieldOption} from "./slackModal";

/**
 * Pulls in the prepped priorities - note that we can't wait until now to load priorities from Jira
 * since this is expected to be a synchronous call (because we can't wait too long to show a modal once
 * a trigger has been fired)
 * @param _modal unused
 * @param _field unused
 */
const loadPriorities = (_modal: IModalConfig, _field: IModalField): IModalFieldOption[] => {
    return moduleInstance.preparedPriorities.map((p) => {
        return {
            name: p.name,
            value: p.jiraId,
            description: p.description
        }
    })
}

/**
 * Pulls in the prepped priorities - note that we can't wait until now to load priorities from Jira
 * since this is expected to be a synchronous call (because we can't wait too long to show a modal once
 * a trigger has been fired)
 * @param _modal unused
 * @param _field unused
 */
const loadComponents = (_modal: IModalConfig, _field: IModalField): IModalFieldOption[] => {
    return moduleInstance.jiraComponents.map((c) => {
        return {
            value: c.id,
            name: c.name,
            description: c.description
        }
    });
}

/**
 * This is the prebuilt modal for requests.
 */
export const DefaultRequestModalConfig: IModalConfig = {
    title: "Submit Request",
    description: "Once submitted, you can follow progress either in Slack or in Jira.\n",
    actionButtons: {
        submit: {
            label: "Submit",
        },
        cancel: {
            label: "Cancel",
        }
    },
    configurableFields: [
        {
            id: "title_input",
            actionId: "title",
            label: "Summary",
            hint: "This field cannot be more than 255 characters",
            required: true,
            position: 1,
            type: "text",
            ticketFieldId: "summary"
        },
        {
            id: "category_input",
            actionId: "category",
            label: "Components",
            hint: "Choose the category of request you are making",
            required: true,
            position: 3,
            type: "dropdown",
            ticketFieldId: "components",
            options: loadComponents
        },
        {
            id: "priority_input",
            actionId: "priority",
            label: "Priority",
            hint: "Some priorities will trigger a PagerDuty incident",
            required: true,
            position: 3,
            type: "dropdown",
            ticketFieldId: "priority",
            options: loadPriorities
        },
        {
            id: "description_input",
            actionId: "description",
            label: "Additional Information",
            hint: "This populates the 'description' field in the created Jira Ticket (optional)",
            required: false,
            position: 4,
            type: "big_text",
            ticketFieldId: "summary"
        }
    ]
}

/**
 * Generates and shows the issue request Modal shown when a user starts the process of
 * submitting a request.
 */
export default class RequestModal extends SlackModal {

    protected _init() {
        const {title, description} = prepTitleAndDescription(this.requestInfo.title, this.requestInfo.description);
        this.initialValues = {
            "title_input": title,
            "description_input": description
        }
    }
};