import {ModuleConfig} from "@nexus-switchboard/nexus-extend";
import {ServicePriority} from "../index";

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

export interface ServiceModuleConfig extends ModuleConfig {

    REQUEST_COMMAND_NAME: string;

    // Jira Project and Workflow Details
    REQUEST_JIRA_PROJECT: string;
    REQUEST_JIRA_ISSUE_TYPE_ID: string;
    REQUEST_JIRA_EPIC: string;
    REQUEST_JIRA_START_TRANSITION_ID: 0,
    REQUEST_JIRA_COMPLETE_TRANSITION_ID: 0,
    REQUEST_JIRA_EPIC_LINK_FIELD: string;
    REQUEST_JIRA_RESOLUTION_DISMISS: string;
    REQUEST_JIRA_RESOLUTION_DONE: string;
    REQUEST_JIRA_DEFAULT_COMPONENT_ID: string;
    REQUEST_JIRA_SERVICE_LABEL: string;
    REQUEST_JIRA_PRIORITY_PAGER_TRIGGERS: string[],

    // Slack Integration Options
    SLACK_PRIMARY_CHANNEL: string;
    SLACK_CONVERSATION_RESTRICTION: "invited" | "primary";

    // Slack Modal
    SUBMIT_MODAL_CONFIG: IModalConfig,

    // A list of all the priorities that will be available
    //  in the submission dialog along with properties associated
    //  with them.
    REQUEST_JIRA_PRIORITIES: ServicePriority[],

    // Slack Emoji
    REQUEST_COMPLETED_SLACK_ICON: string;
    REQUEST_CANCELLED_SLACK_ICON: string;
    REQUEST_CLAIMED_SLACK_ICON: string;
    REQUEST_SUBMITTED_SLACK_ICON: string;
    REQUEST_WORKING_SLACK_ICON: string;
    REQUEST_EDITING_SLACK_ICON: string;
    REQUEST_ERROR_SLACK_ICON: string;
    REQUEST_PRIORITY_LOW_SLACK_ICON: string;
    REQUEST_PRIORITY_MEDIUM_SLACK_ICON: string;
    REQUEST_PRIORITY_HIGH_SLACK_ICON: string;

    // Slack App Details
    SLACK_BOT_USERNAME: string;

    // Jira Credentials
    JIRA_ADDON_KEY: string;
    JIRA_ADDON_NAME: string;
    JIRA_ADDON_DESCRIPTION: string;

    // PagerDuty Credentials
    PAGERDUTY_FROM_EMAIL: ""

    // Secrets
    SLACK_APP_ID: "__env__",
    SLACK_CLIENT_ID: "__env__",
    SLACK_CLIENT_SECRET: "__env__",
    SLACK_SIGNING_SECRET: "__env__",
    SLACK_CLIENT_OAUTH_TOKEN: "__env__",
    SLACK_USER_OAUTH_TOKEN: "__env__",
    JIRA_HOST: "__env__",
    JIRA_USERNAME: "__env__",
    JIRA_API_KEY: "__env__",
    JIRA_ADDON_CACHE: "__env__",
    PAGERDUTY_TOKEN: "__env__",
    PAGERDUTY_SERVICE_DEFAULT: "__env__",
    PAGERDUTY_ESCALATION_POLICY_DEFAULT: "__env__",
}