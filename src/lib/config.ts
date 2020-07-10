import {IConfigGroupRule} from "@nexus-switchboard/nexus-extend";

export const moduleConfigurationRules: IConfigGroupRule[] = [
    {
        name: 'secrets.jiraUsername',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Username (in email form) of the Jira account to use for API access"
    },
    {
        name: 'secrets.jiraPassword',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Password (in API Key form) of the Jira account to use for API access"
    },
    {
        name: 'secrets.jiraAddonCache',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Password (in API Key form) of the Jira account to use for API access"
    },
    {
        name: 'secrets.pagerDutyToken',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Token used to access the PagerDuty API"
    },
    {
        name: 'secrets.slackAppId',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "App ID for the integrated slack app"
    },
    {
        name: 'secrets.slackClientId',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Client ID for the integrated slack app"
    },
    {
        name: 'secrets.slackClientSecret',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Client secret for the integrated slack app"
    },
    {
        name: 'secrets.slackSigningSecret',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Signing secret for the integrated slack app"
    },
    {
        name: 'secrets.slackClientOauthToken',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Bot token used for API access as an app entity."
    },
    {
        name: 'secrets.slackUserOauthToken',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "Bot token used for API access as a user entity."
    },

];

export const jiraConfigurationRules: IConfigGroupRule[] = [
    {
        name: 'jira.project',
        required: true,
        type: ["string"],
        regex: /[A-Za-z0-9]{1,10}/i,
        level: "error",
        reason: "Needed to integrate with Jira APIs"
    },
    {
        name: 'jira.issueTypeId',
        required: true,
        type: ["string"],
        level: "error",
        reason: "This should be the ID of the issue type in Jira.  Expect a stringified number like '12800'"
    },
    {
        name: 'jira.epicKey',
        required: true,
        type: ["string"],
        level: "error",
        regex: /((?<!([A-Z]{1,10})-?)[A-Z]+-\d+)/i,
        reason: "All new tickets will go into this Epic."
    },
    {
        name: 'jira.transitionStart',
        required: true,
        type: ["string", "number"],
        regex: /\d+/,
        level: "error",
        reason: "This should be a stringified number that represents the ID of the transition entity that should be used to transition a request from ToDo to In Progress."
    },
    {
        name: 'jira.transitionComplete',
        required: true,
        type: ["string", "number"],
        regex: /\d+/,
        level: "error",
        reason: "This should be a stringified number that represents the ID of the transition entity that should be used to transition a request from InProgress to Complete or Cancelled."
    },
    {
        name: 'jira.transitionCancel',
        required: true,
        type: ["string", "number"],
        regex: /\d+/,
        level: "error",
        reason: "This should be a stringified number that represents the ID of the transition entity that should be used to transition a request from InProgress to Complete or Cancelled."
    },
    {
        name: 'jira.resolutionCancel',
        required: true,
        type: ["string"],
        level: "error",
        reason: "'Resolution' is required when completing or cancelling a ticket. This should be the exact name used - for example, 'Won't Do' or 'Abandoned'"
    },
    {
        name: 'jira.resolutionDone',
        required: true,
        type: ["string"],
        level: "error",
        reason: "'Resolution' is required when completing or cancelling a ticket. This should be the exact name used - for example, 'Done' or 'Fixed'"
    },
    {
        name: 'jira.defaultComponentId',
        required: false,
        type: ["string"],
        level: "error",
        regex: /\d+/,
        reason: "If given, then this is the ID of the component that should be pre-selected in the request dialog.  This should be a stringified number."
    },
    {
        name: 'text.highPriorityReplyText',
        required: true,
        type: ["string"],
        level: "error",
        reason: "This is the message that is shown when a user chooses a priority that can trigger a pager duty alert."
    },
    {
        name: 'text.onCallButtonText',
        required: true,
        type: ["string"],
        level: "error",
        reason: "This is the text to show on the high priority emergency page button (shown when a user selects a high priority that is tied to a pager duty call)."
    },
    {
        name: 'text.onCallButtonPressedText',
        required: true,
        type: ["string"],
        level: "error",
        reason: "This is the text that's shown after a user has clicked the high priority emergency page button (it repalces the button in the message)."
    },
    {
        name: 'jira.serviceLabel',
        required: true,
        type: ["string"],
        level: "error",
        regex: /[A-Za-z]+/i,
        reason: "This is a string used for two things - first, to form the prefix of the label used to identify a ticket that is created by the module and second, to identify the custom property associated with each ticket."
    },
    {
        name: 'jira.epicLinkFieldId',
        required: false,
        type: ["string"],
        regex: /\d+/,
        level: "error",
        reason: "This is only required when the type of project being used is a 'Legacy' project type.  This is because original projects didn't have the notion of epics and it was added as a link field.  That link field could be different on different Jira instances which is why it needs to specified here.  Next-gen projects do not need this and it can be left empty."
    },
    {
        name: 'jira.priorities',
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
]

export const slackConfigurationRules: IConfigGroupRule[] = [
    {
        name: 'slack.primaryChannel',
        required: true,
        type: ["string"],
        regex: /[C][A-Z0-9]{5,15}/,
        level: "error",
        reason: "This must be an actual channel ID and not a group or DM ID.  It should started with a C and have somewhere between 5 and 15 alphanumeric characters after it."
    },
    {
        name: 'slack.conversationRestriction',
        required: true,
        type: ["string"],
        regex: /(primary|invited)/,
        level: "error",
        reason: "This must be set to either primary (indicating that all conversations will happen in the indicated primary channel, or invited meaning that the request conversation can happen in any channel that the bot has been invited to."
    },
    {
        name: 'modal',
        required: false,
        type: ["object", "function"],
        level: "error",
        reason: "This is a complex object that, by default, will have the standard fields but can be either specified here as an object that will replace the default or a function that is passed the default object and will return the new object."
    },
    {
        name: 'slack.botUsername',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "This is the username to look for when validating that a message is coming from the associated request module's bot."
    },
];

export const contentConfigurationRules: IConfigGroupRule[] = [
    {
        name: 'text.highPriorityReplyText',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.onCallButtonText',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.onCallButtonPressedText',
        required: true,
        type: ["string"],
        regex: /[\w]+/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.emojiCompleted',
        required: true,
        type: ["string"],
        regex: /:[a-z0-9\-_]+:/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.emojiCancelled',
        required: true,
        type: ["string"],
        regex: /:[a-z0-9\-_]+:/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.emojiClaimed',
        required: true,
        type: ["string"],
        regex: /:[a-z0-9\-_]+:/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.emojiSubmitted',
        required: true,
        type: ["string"],
        regex: /:[a-z0-9\-_]+:/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.emojiWorking',
        required: true,
        type: ["string"],
        regex: /:[a-z0-9\-_]+:/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.emojiEditing',
        required: true,
        type: ["string"],
        regex: /:[a-z0-9\-_]+:/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    },
    {
        name: 'text.emojiError',
        required: true,
        type: ["string"],
        regex: /:[a-z0-9\-_]+:/,
        level: "error",
        reason: "The emoji to use for a request that is in this state.  This must be formatted as you would format an emoji in slack (e.g. :rofl:)"
    }
];
