import createDebug from "debug";
import {Router} from "express";
import {JiraConnection} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection} from "@nexus-switchboard/nexus-conn-slack";
import {
    ConnectionRequestDefinition,
    NexusModule,
    NexusModuleConfig
} from "@nexus-switchboard/nexus-extend";
import {requestSubcommands} from "./lib/slack/commands";
import {events} from "./lib/slack/events";
import {interactions} from "./lib/slack/interactions";

export const logger = createDebug("nexus:service");

class ServiceModule extends NexusModule {
    public name = "service";

    public loadConfig(overrides?: NexusModuleConfig): NexusModuleConfig {
        const defaults = {

            REQUEST_JIRA_PROJECT: "",
            REQUEST_JIRA_ISSUE_TYPE_ID: "",
            REQUEST_JIRA_EPIC: "",
            REQUEST_JIRA_START_TRANSITION_ID: 0,
            REQUEST_JIRA_COMPLETE_TRANSITION_ID: 0,
            REQUEST_JIRA_EPIC_LINK_FIELD: "",
            REQUEST_JIRA_RESOLUTION_DISMISS: "",
            REQUEST_JIRA_RESOLUTION_DONE: "",

            SLACK_APP_ID: "__env__",
            SLACK_CLIENT_ID: "__env__",
            SLACK_CLIENT_SECRET: "__env__",
            SLACK_SIGNING_SECRET: "__env__",
            SLACK_CLIENT_OAUTH_TOKEN: "__env__",
            SLACK_USER_OAUTH_TOKEN: "__env__",

            JIRA_HOST: "__env__",
            JIRA_USERNAME: "__env__",
            JIRA_API_KEY: "__env__",

            REQUEST_COMMAND_NAME: ""
        };

        return overrides ? Object.assign({}, defaults, overrides) : {...defaults};
    }

    // most modules will use at least one connection.  This will allow the user to instantiate the connections
    //  and configure them using configuration that is specific to this module.
    public loadConnections(config: NexusModuleConfig,
                           router: Router): ConnectionRequestDefinition[] {
        return [
            {
                name: "nexus-conn-jira",
                config: {
                    host: config.JIRA_HOST,
                    username: config.JIRA_USERNAME,
                    apiToken: config.JIRA_API_KEY

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
                    router,
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
