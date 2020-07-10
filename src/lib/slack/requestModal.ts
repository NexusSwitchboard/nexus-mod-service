import {prepTitleAndDescription} from '../util';
import _ from "lodash"
import SlackModal, {IModalConfig, IModalField, IModalFieldOption} from "./slackModal";
import {KnownBlock} from "@slack/types";

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
            placeholder: "Short summary of your request",
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
            placeholder: "Choose a category/component that makes the most sense",
            required: true,
            position: 3,
            type: "components",
            ticketFieldId: "components"
        },
        {
            id: "priority_input",
            actionId: "priority",
            label: "Priority",
            hint: "Please be as objective as possible when choosing a priority",
            placeholder: "Choose a priority",
            required: true,
            position: 3,
            type: "priorities",
            ticketFieldId: "priority"
        },
        {
            id: "description_input",
            actionId: "description",
            label: "Additional Information",
            hint: "This populates the 'description' field in the created Jira Ticket (optional)",
            placeholder: "Enter a detailed description",
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

    protected getSlackBlockFromFieldConfig(f: IModalField): KnownBlock {

        if (f.type === "priorities") {
            const uf = _.cloneDeep(f);
            uf.type = "dropdown";
            uf.options = this.loadPriorities();
            return super.getSlackBlockFromFieldConfig(uf);
        } else if (f.type === "components") {
            const uf = _.cloneDeep(f);
            uf.type = "dropdown";
            uf.options = this.loadComponents();
            return super.getSlackBlockFromFieldConfig(uf);
        } else {
            return super.getSlackBlockFromFieldConfig(f);
        }

    }


    /**
     * Pulls in the prepped priorities - note that we can't wait until now to load priorities from Jira
     * since this is expected to be a synchronous call (because we can't wait too long to show a modal once
     * a trigger has been fired)
     */
    protected loadPriorities (): IModalFieldOption[] {
        return this.intent.preparedPriorities.map((p) => {
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
     */
    protected loadComponents (): IModalFieldOption[] {
        return this.intent.jiraComponents.map((c) => {
            return {
                value: c.id,
                name: c.name,
                description: c.description
            }
        });
    }

};
