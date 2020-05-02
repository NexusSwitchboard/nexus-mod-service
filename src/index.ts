import createDebug from "debug";
import { Application } from 'express';
import { JiraConnection, JiraPayload } from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection} from "@nexus-switchboard/nexus-conn-slack";
import {PagerDutyConnection} from "@nexus-switchboard/nexus-conn-pagerduty";
import {
    ConnectionRequest,
    NexusModule,
    ModuleConfig, INexusActiveModule
} from "@nexus-switchboard/nexus-extend";
import {requestSubcommands} from "./lib/slack/commands";
import {events} from "./lib/slack/events";
import {interactions} from "./lib/slack/interactions";
import loadWebhooks from "./lib/jira/webhooks";
import {join} from "path"
import { IModalConfig } from "./lib/slack/createRequestModal";

export const TEMPLATE_DIR = join(__dirname, "views");

export interface ServiceComponent {
    id: string,
    name: string,
    description: string
}

export interface ServicePriority {
    name: string;
    jiraId: string;
    jiraName: string;
    description: string;
    slackEmoji?: string;
    triggersPagerDuty?: boolean;
}

export const logger = createDebug("nexus:service");

export class ServiceModule extends NexusModule {
    public name = "service";
    public cachedComponents: ServiceComponent[];
    public cachedPriorities: Record<string, JiraPayload>;
    public cachedPreparedPriorities: ServicePriority[];

    public async initialize(active: INexusActiveModule) {
        super.initialize(active);

        await this.loadJiraProjectComponents();
        await this.loadJiraPriorities();
    }

    public get jiraComponents () {
        return this.cachedComponents;
    }

    /**
     * These are the priorities that were retrieved from Jira (as-is).  We keep
     * these in a separate cache for posterity but most of the time we will
     * be referencing the preparedPriorities.
     */
    public get jiraPriorities () {
        return this.cachedPriorities;
    }

    /**
     * This will return the set of priorities that is a mix of what was configured and what
     * was available in Jira.  All configured priorities have to refer to a valid priority in the user's
     * instance of Jira. If an unknown priority is specified in the config under `jiraName` then config
     * initialization will fail.
     */
    public get preparedPriorities() {
        if (this.cachedPreparedPriorities) {
            return this.cachedPreparedPriorities
        }

        const priorities = this.getActiveModuleConfig().REQUEST_JIRA_PRIORITIES || [];
        this.cachedPreparedPriorities = priorities.map((p: ServicePriority)=> {
            const sp = p.name.toLowerCase();
            if (sp in this.jiraPriorities) {
                return {...p, jiraId: this.jiraPriorities[sp].id}
            } else {
                throw new Error("A priority was specified in the service module config that is not available in Jira.")
            }
        });

        if (this.cachedPreparedPriorities.length === 0) {
            throw new Error("No priorities were configured - at least one must be configured.")
        }

        return this.cachedPreparedPriorities;
    }

    /**
     * Finds the first prepped priority details in the cached list that has the jira ID that matches
     * the one given.
     * @param jiraPriorityId
     */
    public lookupPriorityByJiraId(jiraPriorityId:string): ServicePriority {
        return this.preparedPriorities.find((p) => {
            return p.jiraId === jiraPriorityId;
        });
    }

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
            REQUEST_JIRA_PRIORITY_PAGER_TRIGGERS: undefined as string[],

            // Slack Integration Options
            SLACK_PRIMARY_CHANNEL: "",
            SLACK_CONVERSATION_RESTRICTION: "", // [invited, primary]

            // Slack Modal
            SUBMIT_MODAL_CONFIG: undefined as IModalConfig,

            // A list of all the priorities that will be available
            //  in the submission dialog along with properties associated
            //  with them.
            REQUEST_JIRA_PRIORITIES: undefined as ServicePriority[],

            // Slack Emoji
            REQUEST_COMPLETED_SLACK_ICON: "",
            REQUEST_CANCELLED_SLACK_ICON: "",
            REQUEST_CLAIMED_SLACK_ICON: "",
            REQUEST_SUBMITTED_SLACK_ICON: "",
            REQUEST_WORKING_SLACK_ICON: "",
            REQUEST_EDITING_SLACK_ICON: "",
            REQUEST_ERROR_SLACK_ICON: "",
            REQUEST_PRIORITY_LOW_SLACK_ICON: "",
            REQUEST_PRIORITY_MEDIUM_SLACK_ICON: "",
            REQUEST_PRIORITY_HIGH_SLACK_ICON: "",

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
            JIRA_API_KEY: "__env__",
            JIRA_ADDON_CACHE: "__env__",
            JIRA_ADDON_KEY: "",
            JIRA_ADDON_NAME: "",
            JIRA_ADDON_DESCRIPTION: "",

            // PagerDuty Credentials
            PAGERDUTY_TOKEN: "__env__",
            PAGERDUTY_SERVICE_DEFAULT: "__env__",
            PAGERDUTY_ESCALATION_POLICY_DEFAULT: "__env__",
            PAGERDUTY_FROM_EMAIL: ""
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
                        key: config.JIRA_ADDON_KEY,
                        name: config.JIRA_ADDON_NAME,
                        description: config.JIRA_ADDON_DESCRIPTION
                    },

                    baseUrl: `${this.globalConfig.baseUrl}${this.moduleRootPath}`,

                    webhooks: loadWebhooks(config),

                    connectionString: config.JIRA_ADDON_CACHE
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
            }, {
                name: "nexus-conn-pagerduty",
                config: {
                    token: config.PAGERDUTY_TOKEN,
                    serviceDefault: config.PAGERDUTY_SERVICE_DEFAULT,
                    escalationPolicyDefault: config.PAGERDUTY_ESCALATION_POLICY_DEFAULT
                }
            }];
    }

    public getJira(): JiraConnection {
        return this.getActiveConnection("nexus-conn-jira") as JiraConnection;
    }

    public getSlack(): SlackConnection {
        return this.getActiveConnection("nexus-conn-slack") as SlackConnection;
    }

    public getPagerDuty(): PagerDutyConnection {
        return this.getActiveConnection("nexus-conn-pagerduty") as PagerDutyConnection
    }

    /**
     * Retrieves all the components for the configured service project.  If the components have already
     * been retrieved for this instance of the request, then return them without making a request to jira.
     */
    protected async loadJiraProjectComponents(): Promise<ServiceComponent[]> {

        if (this.cachedComponents) {
            return this.cachedComponents;
        }

        try {
            const components = await this.getJira().api.projectComponents.getProjectComponents({
                projectIdOrKey: this.activeModule.config.REQUEST_JIRA_PROJECT
            });

            this.cachedComponents = components.map((c: JiraPayload) => {
                return {
                    id: c.id,
                    name: c.name,
                    description: c.description
                };
            });

            return this.cachedComponents;

        } catch (e) {
            logger("Exception thrown: Cannot retrieve components from Jira: " + e.toString());
            return [];
        }
    }

    /**
     * Retrieves all the components for the configured service project.  If the components have already
     * been retrieved for this instance of the request, then return them without making a request to jira.
     */
    protected async loadJiraPriorities(): Promise<Record<string,JiraPayload>> {

        if (this.cachedPriorities) {
            return this.cachedPriorities;
        }

        try {
            const priorities = await this.getJira().api.issuePriorities.getPriorities();

            this.cachedPriorities = {};
            priorities.forEach((p: JiraPayload) => {
                this.cachedPriorities[p.name.toLowerCase()] = {
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    color: p.statusColor
                };
            });

            return this.cachedPriorities;

        } catch (e) {
            logger("Exception thrown: Cannot retrieve priorities from Jira: " + e.toString());
            return {};
        }
    }
}

export default new ServiceModule();
