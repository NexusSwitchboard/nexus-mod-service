import {IConfigGroups} from "@nexus-switchboard/nexus-extend";

const ConfigRules: IConfigGroups = {
    'Jira Connection': [
        {name: 'JIRA_USERNAME', required: true, level: "error", reason: "Needed to integrate with Jira APIs"},
        {name: 'JIRA_API_KEY', required: true, level: "error", reason: "Needed to integrate with Jira APIs"},
        {
            name: 'JIRA_ADDON_CACHE',
            required: true,
            level: "error",
            reason: "Needed to store addon client data to properly decode host events and requests."
        },
        {name: 'JIRA_ADDON_KEY', required: true, level: "error", reason: "Needed to uniquely identify this add-on."},
        {
            name: 'JIRA_ADDON_NAME',
            required: true,
            level: "warning",
            reason: "Needed as a friendly name to display in the Jira Add-On UI"
        },
        {
            name: 'JIRA_ADDON_DESCRIPTION',
            required: true,
            level: "error",
            reason: "Needed as a description of the purpose of the add on in the Jira Add-On UI"
        }
    ],
    'Jira Integration': [
        {
            name: 'REQUEST_JIRA_PROJECT',
            required: true,
            type: ["string"],
            regex: /[A-Za-z0-9]{1,10}/i,
            level: "error",
            reason: "Needed to integrate with Jira APIs"
        },
        {
            name: 'REQUEST_JIRA_ISSUE_TYPE_ID',
            required: true,
            type: ["string"],
            level: "error",
            reason: "This should be the ID of the issue type in Jira.  Expect a stringified number like '12800'"
        },
        {
            name: 'REQUEST_JIRA_EPIC',
            required: true,
            type: ["string"],
            level: "error",
            regex: /((?<!([A-Z]{1,10})-?)[A-Z]+-\d+)/i,
            reason: "All new tickets will go into this Epic."
        },
        {
            name: 'REQUEST_JIRA_START_TRANSITION_ID',
            required: true,
            type: ["string", "number"],
            regex: /\d+/,
            level: "error",
            reason: "This should be a stringified number that represents the ID of the transition entity that should be used to transition a request from ToDo to In Progress."
        },
        {
            name: 'REQUEST_JIRA_COMPLETE_TRANSITION_ID',
            required: true,
            type: ["string", "number"],
            regex: /\d+/,
            level: "error",
            reason: "This should be a stringified number that represents the ID of the transition entity that should be used to transition a request from InProgress to Complete or Cancelled."
        },
        {
            name: 'REQUEST_JIRA_RESOLUTION_DISMISS',
            required: true,
            type: ["string"],
            level: "error",
            reason: "'Resolution' is required when completing or cancelling a ticket. This should be the exact name used - for example, 'Won't Do' or 'Abandoned'"
        },
        {
            name: 'REQUEST_JIRA_RESOLUTION_DONE',
            required: true,
            type: ["string"],
            level: "error",
            reason: "'Resolution' is required when completing or cancelling a ticket. This should be the exact name used - for example, 'Done' or 'Fixed'"
        },
        {
            name: 'REQUEST_JIRA_DEFAULT_COMPONENT_ID',
            required: false,
            type: ["string"],
            level: "error",
            regex: /\d+/,
            reason: "If given, then this is the ID of the component that should be pre-selected in the request dialog.  This should be a stringified number."
        },
        {
            name: 'REQUEST_JIRA_SERVICE_LABEL',
            required: true,
            type: ["string"],
            level: "error",
            regex: /[A-Za-z]+/i,
            reason: "This is a string used for two things - first, to form the prefix of the label used to identify a ticket that is created by the module and second, to identify the custom property associated with each ticket."
        },
        {
            name: 'REQUEST_JIRA_EPIC_LINK_FIELD',
            required: false,
            type: ["string"],
            regex: /\d+/,
            level: "error",
            reason: "This is only required when the type of project being used is a 'Legacy' project type.  This is because original projects didn't have the notion of epics and it was added as a link field.  That link field could be different on different Jira instances which is why it needs to specified here.  Next-gen projects do not need this and it can be left empty."
        },
        {
            name: 'REQUEST_JIRA_PRIORITIES',
            required: true,
            type: ["list"],
            keys: {
                "name": "string",
                "jiraName": "string",
                "triggersPagerDuty": "boolean",
                "description": "string",
                "slackEmoji": "string"
            },
            regex: /\d+/,
            level: "error",
            reason: "This maps a customized priority with a Jira priority and metadata surrounding it including whether or not there should be a PagerDuty trigger as a result of selecting one."
        }
    ],
    'Slack Credentials': [
        {
            name: 'SLACK_APP_ID',
            required: true,
            type: ["string"],
            regex: /[A][A-Z0-9]+/,
            level: "error",
            reason: "The app ID is expected to start with an A followed by uppercase alphanumeric characters."
        },
        {
            name: 'SLACK_CLIENT_ID',
            required: true,
            type: ["string"],
            level: "error",
            reason: "The client ID for your slack app is available in the configuration settings for the app."
        },
        {
            name: 'SLACK_CLIENT_SECRET',
            required: true,
            type: ["string"],
            level: "error",
            reason: "The client secret for your slack app is available in the configuration settings for the app."
        },
        {
            name: 'SLACK_SIGNING_SECRET',
            required: true,
            type: ["string"],
            level: "error",
            reason: "The signing secret for your slack app is available in the configuration settings for the app."
        },
        {
            name: 'SLACK_CLIENT_OAUTH_TOKEN',
            required: true,
            type: ["string"],
            regex: /xoxp-[A-Za-z0-9\-]+/,
            level: "error",
            reason: "Used by the bot to represent itself as an app when engaging with the slack client."
        },
        {
            name: 'SLACK_USER_OAUTH_TOKEN',
            required: true,
            type: ["string"],
            regex: /xoxb-[A-Za-z0-9\-]+/,
            level: "error",
            reason: "Used by the bot to represent itself as a user when engaging with the slack client."
        },
    ],
    'Slack Integration': [
        {
            name: 'SLACK_PRIMARY_CHANNEL',
            required: true,
            type: ["string"],
            regex: /[C][A-Z0-9]{5,15}/,
            level: "error",
            reason: "This must be an actual channel ID and not a group or DM ID.  It should started with a C and have somewhere between 5 and 15 alphanumeric characters after it."
        },
        {
            name: 'SLACK_CONVERSATION_RESTRICTION',
            required: true,
            type: ["string"],
            regex: /(primary|invited)/,
            level: "error",
            reason: "This must be set to either primary (indicating that all conversations will happen in the indicated primary channel, or invited meaning that the request conversation can happen in any channel that the bot has been invited to."
        },
        {
            name: 'SUBMIT_MODAL_CONFIG',
            required: false,
            type: ["object", "function"],
            level: "error",
            reason: "This is a complex object that, by default, will have the standard fields but can be either specified here as an object that will replace the default or a function that is passed the default object and will return the new object."
        },
        {
            name: 'REQUEST_COMPLETED_SLACK_ICON',
            required: true,
            type: ["string"],
            regex: /:[a-z0-9\-_]+:/,
            level: "error",
            reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
        },
        {
            name: 'REQUEST_CANCELLED_SLACK_ICON',
            required: true,
            type: ["string"],
            regex: /:[a-z0-9\-_]+:/,
            level: "error",
            reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
        },
        {
            name: 'REQUEST_CLAIMED_SLACK_ICON',
            required: true,
            type: ["string"],
            regex: /:[a-z0-9\-_]+:/,
            level: "error",
            reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
        },
        {
            name: 'REQUEST_SUBMITTED_SLACK_ICON',
            required: true,
            type: ["string"],
            regex: /:[a-z0-9\-_]+:/,
            level: "error",
            reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
        },
        {
            name: 'REQUEST_WORKING_SLACK_ICON',
            required: true,
            type: ["string"],
            regex: /:[a-z0-9\-_]+:/,
            level: "error",
            reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
        },
        {
            name: 'REQUEST_EDITING_SLACK_ICON',
            required: true,
            type: ["string"],
            regex: /:[a-z0-9\-_]+:/,
            level: "error",
            reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
        },
        {
            name: 'REQUEST_ERROR_SLACK_ICON',
            required: true,
            type: ["string"],
            regex: /:[a-z0-9\-_]+:/,
            level: "error",
            reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
        },
        {
            name: 'SLACK_BOT_USERNAME',
            required: true,
            type: ["string"],
            regex: /[\w]+/,
            level: "error",
            reason: "This is the username to look for when validating that a message is coming from the associated request module's bot."
        },
    ],
    'PagerDuty Credentials': [
        {
            name: 'PAGERDUTY_TOKEN',
            required: true,
            type: ["string"],
            level: "warning",
            reason: "Required if any of the priorities are intended to trigger a pagerduty alert."
        },
        {
            name: 'PAGERDUTY_SERVICE_DEFAULT',
            required: true,
            type: ["string"],
            level: "warning",
            reason: "The ID of the service in PagerDuty associated with the generated incident."
        },
        {
            name: 'PAGERDUTY_ESCALATION_POLICY_DEFAULT',
            required: true,
            type: ["string"],
            level: "warning",
            reason: "The ID of the escalation policy to use for the created incident."
        },
        {
            name: 'PAGERDUTY_FROM_EMAIL',
            required: true,
            type: ["string"],
            level: "warning",
            reason: "The email address to use as the user who created the incident."
        }
    ]
}

export default ConfigRules;
