import createDebug from "debug";
import {Application} from 'express';
import {JiraConnection, JiraPayload} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection} from "@nexus-switchboard/nexus-conn-slack";
import {PagerDutyConnection} from "@nexus-switchboard/nexus-conn-pagerduty";
import {
    ConnectionRequest,
    NexusModule,
    ModuleConfig, INexusActiveModule,
    IConfigGroups
} from "@nexus-switchboard/nexus-extend";
import {requestSubcommands} from "./lib/slack/commands";
import {events} from "./lib/slack/events";
import {interactions} from "./lib/slack/interactions";
import loadWebhooks from "./lib/jira/webhooks";
import configRules from "./lib/config";
import assert from "assert";


export {IServiceApproval, IServiceApprovalConfig} from "./lib/approval";

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

    protected getConfigRules(): IConfigGroups {
        return configRules;
    }

    public async initialize(active: INexusActiveModule): Promise<boolean> {

        if (await super.initialize(active)) {
            await this.loadJiraProjectComponents();
            await this.loadJiraPriorities();
            return true;
        }

        return false;
    }

    /**
     * This will check to make sure that all the APIs are functioning properly with the right
     * credentials by making a simple API call to each.
     * @param _active
     */
    public async validate(_active: INexusActiveModule): Promise<boolean> {

        let phase: ("jira"|"slack"|"pagerduty");

        try {
            // Check Jira Connection
            phase = "jira";
            const locale = await this.getJira().api.myself.getLocale();
            assert(locale.locale);

            // Check Slack Connection
            phase = "slack";
            const users = await this.getSlack().apiAsBot.users.list({limit:10});
            assert(users.ok);

            // Check PagerDuty Connection (if being used)
            phase = "pagerduty";
            if (this.getActiveModuleConfig().PAGERDUTY_TOKEN) {
                // Only check here if pagerduty has been setup as as possible
                const vendors = await this.getPagerDuty().api.vendors.listVendors();
                assert (vendors.statusCode === 200);
            }

            return true;

        } catch(e) {
            logger(`Validation failed during the "${phase}" check: ${e.toString()}`);
            return false;
        }
    }

    public get jiraComponents() {
        return this.cachedComponents;
    }

    /**
     * These are the priorities that were retrieved from Jira (as-is).  We keep
     * these in a separate cache for posterity but most of the time we will
     * be referencing the preparedPriorities.
     */
    public get jiraPriorities() {
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
        this.cachedPreparedPriorities = priorities.map((p: ServicePriority) => {
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
    public lookupPriorityByJiraId(jiraPriorityId: string): ServicePriority {
        return this.preparedPriorities.find((p) => {
            return p.jiraId === jiraPriorityId;
        });
    }

    public loadConfig(config?: ModuleConfig): ModuleConfig {
        return config;
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
                        description: config.JIRA_ADDON_DESCRIPTION,
                        vendor: {
                            name: config.JIRA_ADDON_VENDOR_NAME,
                            url: config.JIRA_ADDON_VENDOR_URL
                        }
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

        if (this.cachedComponents
        ) {
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
    protected async loadJiraPriorities(): Promise<Record<string, JiraPayload>> {

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
