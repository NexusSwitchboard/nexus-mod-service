import {IConfigGroups} from "@nexus-switchboard/nexus-extend";
import {SlackPayload, SlackSubCommandList, ISlackInteractionHandler} from "@nexus-switchboard/nexus-conn-slack";
import {JiraPayload} from "@nexus-switchboard/nexus-conn-jira";
import {WebhookConfiguration} from "atlassian-addon-helper";

import {IModalConfig} from "../slack/slackModal";
import {FlowOrchestrator} from "../flows/orchestrator";
import {noop} from "../util";
import {logger, ServiceComponent, ServiceModule, ServicePriority} from "../../index";

interface IJiraIntentConfig {
    // The project key for the project in which new request tickets are created.
    project: string,

    // The issue type to use when creating new issues
    issueTypeId: string,

    // The epic to associate every request with
    epicKey: string,

    // If using a "classic" project, then you have to use the "Epic Link" field to identify which
    //  epic a new ticket is associated with.  Because Jira did not have the concept of Epics when
    //  it was first created, epics are implemented as custom fields.  But every instance could have
    //  a different ID.  Specify your ID here.  Note that if you are using a "next-gen" project then
    //  this field can be left empty.
    epicLinkFieldId: string,

    // An ID of a transition that leads from "Open" to an "In Progress" state.
    transitionStart: number,

    // An ID of a transition that leads from "In Progress" to a Done state.
    transitionComplete: number,

    // An ID of a transition that leads from "In Progress" to a Cancelled state.
    transitionCancel: number,

    // In Jira, you often have to set a resolution, in the case that you did, this is the
    //  resolution used when the request was completed successfully.
    resolutionDone: string,

    // In Jira, you often have to set a resolution, in the case that you did, this is the
    //  resolution used when the request was cancelled.
    resolutionCancel: string,

    // The key name for the jira issue property used to store
    //  information about the bot.
    serviceLabel: string,

    // Add-on Configuration
    addonKey: string,
    addonName: string,
    addonDescription: string,
    addonVendorName: string,
    addonVendorUrl: string,

    // Configuration of priorities should match priorities in Jira instance.  Use the
    //  "jiraName" to link this priority to the right Jira priority.
    priorities: ServicePriority[]
}

export interface IPagerDutyIntentConfig {
    // The email that alerts that will appear to originate from
    fromEmail: string,

    // A six-digit alphanumeric string that indicates which service this
    // alert will be representing (by default)
    serviceDefault: string,

    // A six-digit alphanumeric string that indicates which escalation policy
    //  to use by default.
    escalationPolicyDefault: string
}

export interface ISlackIntentConfig {

    // This is the channel where the actionable requests are rendered as threads assuming you have
    //  set the "conversationRestriction" to "primary".  Other channel will get notified of changes
    //  if applicable but only the primary channel will have the full converstation and action buttons.
    primaryChannel: string,

    // If set to primary then the main request thread will happen in the primary channel regardless
    //  of where the initial request was triggered.  Otherwise, the request thread is established in
    //  the originating channel.
    conversationRestriction: "primary" | "originating",

    // The username of the bot associated with the slack app.
    botUsername: string
}

export interface IIntentConfig {

    // This is the friendly name given to this intent - it can be used
    //  to display to the user.
    name: string,

    // The type of behavior to expect.  In this case, claim
    //  refers to the create, claim, complete cycle.
    type: string,

    // The ID is used to discriminate which intent to use when
    // receiving events from external tools.  For example, this is
    //  the callbackId that should be used for global actions when
    //  setting up the app.
    id: string,

    // The full modal configuration (see modal definition for description
    //  of this.
    modal: IModalConfig,

    // If this can be triggered with a slash command, what is the
    //  slash command to use.
    slashCommand: string,

    // If this can be triggered by a message action, set to true.  The
    //  "id" will be used to look for the interaction event.
    messageAction: boolean,

    // If this can be triggered by a global action, set to true.  The
    //  "id" will be used to look for the interaction event.
    globalAction: boolean,

    jira: IJiraIntentConfig,
    pagerDuty: IPagerDutyIntentConfig,
    slack: ISlackIntentConfig,
    text: Record<string, string>
}

/**
 * The service intent class is used to represent an intent specified
 * in the module configuration.  Once the intent is understood, then
 * additional parameters can be
 */
export class ServiceIntent {
    readonly _config: IIntentConfig;
    readonly _module: ServiceModule;
    readonly _flowOrchestrator: FlowOrchestrator;
    public cachedComponents: ServiceComponent[];
    public cachedPriorities: Record<string, JiraPayload>;
    public cachedPreparedPriorities: ServicePriority[];

    public constructor(intentConfig: IIntentConfig, mod: ServiceModule) {
        this._config = intentConfig;
        this._flowOrchestrator = new FlowOrchestrator(this);
        this._module = mod;
    }

    public async initialize() {
        await this.loadJiraProjectComponents();
        await this.loadJiraPriorities();
    }

    public get config() {
        return this._config;
    }

    public get module() {
        return this._module;
    }

    public get orchestrator() {
        return this._flowOrchestrator;
    }

    public get modalConfig() {
        return this._config.modal;
    }

    public get jiraComponents() {
        return this.cachedComponents;
    }

    public get name() {
        return this._config.name;
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

        const priorities = this.getJiraConfig().priorities || [];
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

    public handleSlackEvent(_payload: SlackPayload) {
        // Override to handle event
        noop();
    }

    public getJql(_options: { limit?: number, statusCategories?: string[] }): string {
        return ""
    }

    public getSubCommandMap(): SlackSubCommandList {
        return {}
    }

    public getJiraEventHandlers(): WebhookConfiguration[] {
        return []
    }

    public getSlackInteractions(): ISlackInteractionHandler[] {
        return []
    }

    public getIntentId(): string {
        return this._config.id;
    }

    public getJiraConfig(): IJiraIntentConfig {
        return this._config.jira;
    }

    public getSlackConfig(): ISlackIntentConfig {
        return this._config.slack;
    }

    public getPagerDutyConfig(): IPagerDutyIntentConfig {
        return this._config.pagerDuty;
    }

    public getSlashCommandName(): string {
        return this._config.slashCommand || undefined;
    }

    protected getFlowOrchestrator(): FlowOrchestrator {
        return this._flowOrchestrator;
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
            const components = await this._module.getJira().api.projectComponents.getProjectComponents({
                projectIdOrKey: this._config.jira.project
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
            const priorities = await this._module.getJira().api.issuePriorities.getPriorities();

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

    public getConfigRules(): IConfigGroups {
        return undefined;
    }
}

