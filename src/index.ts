import createDebug from "debug";
import {Application} from 'express';
import {JiraConnection} from "@nexus-switchboard/nexus-conn-jira";
import {SlackConnection} from "@nexus-switchboard/nexus-conn-slack";
import {PagerDutyConnection} from "@nexus-switchboard/nexus-conn-pagerduty";
import {
    ConnectionRequest,
    NexusModule,
    checkConfig,
    ModuleConfig, INexusActiveModule
} from "@nexus-switchboard/nexus-core";
import {IntentManager} from "./lib/intents/manager";
import {moduleConfigurationRules} from "./lib/config";

export {IServiceApproval, IServiceApprovalConfig} from "./lib/approval";
export * as request from "./lib/request";

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
    public intentManager: IntentManager

    public getIntentManager() {
        return this.intentManager;
    }

    /**
     * By the time initialize has been called, all of the loaders for the config, connections, jobs and routes
     * has been called.  In this initialize, we are calling initialize all the intents so that they can properly
     * cache needed data or do anything else that needs to be done before active use starts.
     * @param active
     */
    public async initialize(active: INexusActiveModule): Promise<boolean> {

        if (await super.initialize(active)) {
            await this.intentManager.initialize();
            return true;
        }

        return false;
    }

    /**
     * This will check to make sure that all the APIs are functioning properly with the right
     * credentials by making a simple API call to each.
     * @param active
     */
    public async validate(active: INexusActiveModule): Promise<boolean> {
        try {
            const configDebugger = createDebug("nexus:service:config-check");

            //
            // Check top level configuration
            //
            let configErrorCount = 0;
            if (moduleConfigurationRules) {
                configErrorCount = checkConfig(this.activeModule.config,
                    {'Module': moduleConfigurationRules}, configDebugger);
            }

            // Check intent level configuration
            this.intentManager.intents.every((intent) => {
                configErrorCount += checkConfig(intent.config, intent.getConfigRules(), configDebugger)
            })

            if (configErrorCount > 0) {
                logger(`❌ Validation failed to validate module and intent configs.  There were ${configErrorCount} errors found.  See log above for more`)
            } else {
                logger("✅ Validated module and intent configs")
            }

            //
            // Check Jira Connection

            const locale = await this.getJira().api.myself.getLocale();
            if (locale.locale) {
                logger("✅ Validated connection with Jira")
            }

            //
            // Check Slack Connection

            const users = await this.getSlack().apiAsBot.users.list({limit: 10});
            if (users.ok) {
                logger("✅ Validated connection with Slack")
            }

            //
            // Check PagerDuty Connection (if being used)
            //
            if (active.config.secrets.pagerDutyToken) {
                // Only check here if pagerduty has been setup as as possible
                const vendors = await this.getPagerDuty().api.vendors.listVendors();
                if (vendors.statusCode === 200) {
                    logger("✅ Validated connection with PagerDuty")
                }
            }

            return true;

        } catch (e) {
            logger(`❌ Validation failed: ${e.toString()}`);
            return false;
        }
    }

    /**
     * This will use the intents in the configuration to generate the intent objects that are
     * used throughout the rest of the initialization process.
     * @param config
     */
    public loadConfig(config?: ModuleConfig): ModuleConfig {
        if (!this.intentManager) {
            this.intentManager = new IntentManager();
        }

        Object.keys(config.intents).forEach((key) => {
            this.intentManager.addIntentFromConfig(config.intents[key], this);
        });

        return config;
    }

    public getJiraConnectionData(config: ModuleConfig, subApp: Application): ConnectionRequest {
        return {
            name: "nexus-conn-jira",
            config: {
                host: config.jira.hostname,
                username: config.secrets.jiraUsername,
                apiToken: config.secrets.jiraPassword,

                subApp,

                addon: {
                    key: config.jira.addon.key,
                    name: config.jira.addon.name,
                    description: config.jira.addon.description,
                    vendor: {
                        name: config.jira.addon.vendorName,
                        url: config.jira.addon.vendorUrl
                    }
                },

                baseUrl: `${this.globalConfig.baseUrl}${this.moduleRootPath}`,
                webhooks: this.intentManager.getJiraEventHandlers(),
                connectionString: config.secrets.jiraAddonCache
            }
        }
    }

    public getSlackConnectionData(config: ModuleConfig, subApp: Application): ConnectionRequest {
        return {
            name: "nexus-conn-slack",
            config: {
                appId: config.secrets.slackAppId,
                clientId: config.secrets.slackClientId,
                clientSecret: config.secrets.slackClientSecret,
                signingSecret: config.secrets.slackSigningSecret,
                clientOAuthToken: config.secrets.slackClientOauthToken,
                botUserOAuthToken: config.secrets.slackUserOauthToken,
                eventListeners: this.intentManager.getSlackEventsConfig(),
                commands: this.intentManager.getSlashCommandsConfig(),
                interactionListeners: this.intentManager.getSlackInteractionsConfig(),
                subApp,
            }
        }
    }

    public getPagerDutyConnectionData(config: ModuleConfig, _subApp: Application): ConnectionRequest {
        return {
            name: "nexus-conn-pagerduty",
            config: {
                token: config.secrets.pagerDutyToken,
                serviceDefault: config.pagerDuty.serviceDefault,
                escalationPolicyDefault: config.pagerDuty.escalationPolicyDefault
            }
        }
    }

    // most modules will use at least one connection.  This will allow the user to instantiate the connections
    //  and configure them using configuration that is specific to this module.
    public loadConnections(config: ModuleConfig, subApp: Application): ConnectionRequest[] {
        return [
            this.getJiraConnectionData(config, subApp),
            this.getSlackConnectionData(config, subApp),
            this.getPagerDutyConnectionData(config, subApp)];
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
}

export default new ServiceModule();
