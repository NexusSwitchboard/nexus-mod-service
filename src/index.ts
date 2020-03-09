import createDebug from "debug";
import { Application } from 'express';
import {JiraConnection} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection} from "@nexus-switchboard/nexus-conn-slack";
import {
    ConnectionRequest,
    NexusModule,
    ModuleConfig
} from "@nexus-switchboard/nexus-extend";
import {requestSubcommands} from "./lib/slack/commands";
import {events} from "./lib/slack/events";
import {interactions} from "./lib/slack/interactions";
import loadWebhooks from "./lib/jira/webhooks";

export const logger = createDebug("nexus:service");

export class ServiceModule extends NexusModule {
    public name = "service";

    public loadConfig(overrides?: ModuleConfig): ModuleConfig {
        const defaults = {
            REQUEST_COMMAND_NAME: "",

            // Jira Project and Workflow Details
            REQUEST_JIRA_PROJECT: "",
            REQUEST_JIRA_ISSUE_TYPE_ID: "",
            REQUEST_JIRA_EPIC: "",
            REQUEST_JIRA_START_TRANSITION_ID: 0,
            REQUEST_JIRA_COMPLETE_TRANSITION_ID: 0,
            REQUEST_JIRA_EPIC_LINK_FIELD: "",
            REQUEST_JIRA_RESOLUTION_DISMISS: "",
            REQUEST_JIRA_RESOLUTION_DONE: "",
            REQUEST_JIRA_DEFAULT_COMPONENT_ID: "",
            REQUEST_JIRA_SERVICE_LABEL: "",

            // Slack Emoji
            REQUEST_COMPLETED_SLACK_ICON: "",
            REQUEST_CANCELLED_SLACK_ICON: "",
            REQUEST_CLAIMED_SLACK_ICON: "",
            REQUEST_SUBMITTED_SLACK_ICON: "",
            REQUEST_WORKING_SLACK_ICON: "",
            REQUEST_EDITING_SLACK_ICON: "",
            REQUEST_ERROR_SLACK_ICON: "",

            // Slack App Details
            SLACK_BOT_USERNAME: "",
            SLACK_APP_ID: "__env__",
            SLACK_CLIENT_ID: "__env__",
            SLACK_CLIENT_SECRET: "__env__",
            SLACK_SIGNING_SECRET: "__env__",
            SLACK_CLIENT_OAUTH_TOKEN: "__env__",
            SLACK_USER_OAUTH_TOKEN: "__env__",

            // Jira Credentials
            JIRA_HOST: "__env__",
            JIRA_USERNAME: "__env__",
            JIRA_API_KEY: "__env__"
        };

        return overrides ? Object.assign({}, defaults, overrides) : {...defaults};
    }

    // most modules will use at least one connection.  This will allow the user to instantiate the connections
    //  and configure them using configuration that is specific to this module.
    public loadConnections(config: ModuleConfig,
                           subApp: Application): ConnectionRequest[] {
        return [
            {
                name: "nexus-conn-jira",
                config: {
                    host: config.JIRA_HOST,
                    username: config.JIRA_USERNAME,
                    apiToken: config.JIRA_API_KEY,

                    subApp,

                    addon: {
                        key: "service-addon",
                        name: "Service Jira Addon"
                    },

                    baseUrl: `${this.globalConfig.baseUrl}${this.moduleRootPath}`,

                    webhooks: loadWebhooks(config)
                }
            },
            {
                name: "nexus-conn-slack",
                config: {
                    appId: config.SLACK_APP_ID,
                    clientId: config.SLACK_CLIENT_ID,
                    clientSecret: config.SLACK_CLIENT_SECRET,
                    signingSecret: config.SLACK_SIGNING_SECRET,
                    clientOAuthToken: config.SLACK_CLIENT_OAUTH_TOKEN,
                    botUserOAuthToken: config.SLACK_USER_OAUTH_TOKEN,
                    eventListeners: events,
                    commands: [{
                        command: config.REQUEST_COMMAND_NAME,
                        subCommandListeners: requestSubcommands,
                        defaultSubCommand: "default"
                    }],
                    interactionListeners: interactions,
                    subApp,
                }
            }];
    }

    public getJira(): JiraConnection {
        return this.getActiveConnection("nexus-conn-jira") as JiraConnection;
    }

    public getSlack(): SlackConnection {
        return this.getActiveConnection("nexus-conn-slack") as SlackConnection;
    }
}

export default new ServiceModule();
